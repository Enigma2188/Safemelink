package com.tiziano.safemelink.sms

import android.app.Activity
import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.telephony.SmsManager
import android.telephony.SubscriptionManager
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat

/** Read-only device checks. No SIM enumeration, phone identifiers, privileged APIs or SMS. */
internal object SmsCompatibility {
  fun hasMessaging(context: Context): Boolean {
    val features = context.packageManager
    // Android 13 split FEATURE_TELEPHONY into finer capabilities. Some phones
    // still expose only the older telephony feature even though their active
    // subscription can send SMS. The SIM and sent-result checks below remain
    // authoritative; neither feature flag is proof that an SMS was sent.
    if ((Build.VERSION.SDK_INT >= 33 &&
        features.hasSystemFeature(PackageManager.FEATURE_TELEPHONY_MESSAGING)) ||
        features.hasSystemFeature(PackageManager.FEATURE_TELEPHONY)) return true
    // A valid SMS subscription is stronger evidence than a missing OEM feature
    // declaration. The actual send still requires permission, a usable SIM and
    // an Android sent callback; this fallback never claims delivery.
    return try { SubscriptionManager.isValidSubscriptionId(subscriptionId()) }
    catch (_: Exception) { false }
  }

  @Suppress("DEPRECATION")
  fun subscriptionId(): Int {
    // This API resolves the sole active subscription without opening a chooser,
    // but returns INVALID for multiple active SIMs without a user-defined default.
    // Works from API 22, below this project's actual minimum (24).
    return SmsManager.getDefaultSmsSubscriptionId()
  }

  @Suppress("DEPRECATION")
  fun manager(context: Context, subscription: Int): SmsManager =
    if (Build.VERSION.SDK_INT >= 31) {
      (context.getSystemService(SmsManager::class.java)
        ?: throw IllegalStateException("telephony_unavailable")).createForSubscriptionId(subscription)
    } else SmsManager.getSmsManagerForSubscriptionId(subscription)

  fun simProblem(context: Context, subscription: Int): String? {
    // A SIM metadata read is advisory; lack of an extra phone-state permission
    // must not itself prevent SEND_SMS. The send callback remains authoritative.
    return try {
      val telephony = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
      val slot = if (Build.VERSION.SDK_INT >= 29) SubscriptionManager.getSlotIndex(subscription) else -1
      @Suppress("DEPRECATION")
      val state = if (Build.VERSION.SDK_INT >= 29 && slot >= 0) telephony?.getSimState(slot)
        else if (telephony?.phoneCount == 1) telephony.simState else null
      when (state) {
        TelephonyManager.SIM_STATE_ABSENT -> "sim_absent"
        TelephonyManager.SIM_STATE_PIN_REQUIRED, TelephonyManager.SIM_STATE_PUK_REQUIRED,
        TelephonyManager.SIM_STATE_NETWORK_LOCKED, TelephonyManager.SIM_STATE_NOT_READY,
        TelephonyManager.SIM_STATE_PERM_DISABLED, TelephonyManager.SIM_STATE_CARD_IO_ERROR -> "sim_not_ready"
        else -> null
      }
    } catch (_: Exception) { null }
  }

  fun inspect(context: Context, activity: Activity?): Map<String, Any?> {
    val supported = hasMessaging(context)
    val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED
    val requested = context.getSharedPreferences("sml_sms_permission", Context.MODE_PRIVATE).getBoolean("requested", false)
    val rationale = activity?.shouldShowRequestPermissionRationale(Manifest.permission.SEND_SMS)
    val readiness = if (!supported) "telephony_unavailable" else try {
      val subscription = subscriptionId()
      if (!SubscriptionManager.isValidSubscriptionId(subscription)) "default_sim_missing"
      else simProblem(context, subscription) ?: "ready"
    } catch (_: Exception) { "unknown" }
    return mapOf("sdk" to Build.VERSION.SDK_INT, "messagingSupported" to supported,
      "permissionGranted" to granted, "requestPreviouslyMade" to requested,
      "shouldShowRationale" to rationale, "readiness" to readiness)
  }

  fun notePermissionRequest(context: Context) {
    // Store only app-scoped request history, never consent or personal data.
    check(context.getSharedPreferences("sml_sms_permission", Context.MODE_PRIVATE)
      .edit().putBoolean("requested", true).commit()) { "permission_history_write_failed" }
  }
}
