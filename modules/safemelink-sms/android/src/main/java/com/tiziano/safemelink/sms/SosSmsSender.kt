package com.tiziano.safemelink.sms

import android.Manifest
import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.Build
import android.telephony.SmsManager
import android.telephony.SubscriptionManager
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

/** SOS only. No retry, delivery claim, recipient/content logging or persistent sensitive payload. */
internal object SosSmsSender {
  // Three sequential recipients remain bounded below the existing 8s local SOS timeout.
  private const val SENT_TIMEOUT_MS = 2_000L

  fun send(context: Context, phone: String, message: String, promise: Promise) {
    val attempt = UUID.randomUUID().toString()
    fun result(status: String, reason: String, requested: Boolean) = mapOf(
      "attemptId" to attempt, "status" to status, "reason" to reason,
      "requested" to requested, "delivery" to "not_verified"
    )
    fun rejectBeforeSend(reason: String) { promise.resolve(result("failed", reason, false)) }
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
      rejectBeforeSend("permission_missing"); return
    }
    if (!phone.matches(Regex("^\\+[1-9]\\d{6,14}$")) || message.isBlank()) {
      rejectBeforeSend("invalid_input"); return
    }
    if (!SmsCompatibility.hasMessaging(context)) {
      rejectBeforeSend("telephony_unavailable"); return
    }
    val manager: SmsManager
    val parts: ArrayList<String>
    try {
      val subscription = SmsCompatibility.subscriptionId()
      if (!SubscriptionManager.isValidSubscriptionId(subscription)) {
        rejectBeforeSend("default_sim_missing"); return
      }
      SmsCompatibility.simProblem(context, subscription)?.let { rejectBeforeSend(it); return }
      manager = SmsCompatibility.manager(context, subscription)
      parts = manager.divideMessage(message)
    } catch (_: SecurityException) { rejectBeforeSend("sim_check_unavailable"); return }
    catch (_: Exception) { rejectBeforeSend("telephony_unavailable"); return }
    if (parts.isEmpty()) { rejectBeforeSend("invalid_input"); return }

    val accumulator = SmsSentAccumulator(parts.size)
    val settled = AtomicBoolean(false)
    val handler = Handler(Looper.getMainLooper())
    val intents = ArrayList<PendingIntent>()
    val action = context.packageName + ".SOS_SMS_SENT." + attempt
    var receiver: BroadcastReceiver? = null
    var timeout: Runnable? = null
    var registered = false
    fun finish(status: String, reason: String, requested: Boolean) {
      if (!settled.compareAndSet(false, true)) return
      timeout?.let { handler.removeCallbacks(it) }
      if (registered) {
        receiver?.let { try { context.unregisterReceiver(it) } catch (_: Exception) {} }
      }
      intents.forEach { try { it.cancel() } catch (_: Exception) {} }
      promise.resolve(result(status, reason, requested))
    }
    var failureReason = "send_failed"
    receiver = object : BroadcastReceiver() {
      override fun onReceive(receivedContext: Context?, intent: Intent?) {
        if (settled.get() || intent?.action != action) return
        val index = intent.data?.lastPathSegment?.toIntOrNull() ?: return
        val code = resultCode
        if (!accumulator.accept(index, code == Activity.RESULT_OK)) return
        if (code != Activity.RESULT_OK) failureReason = when {
          intent.getBooleanExtra("noDefault", false) -> "default_sim_missing"
          code == SmsManager.RESULT_ERROR_RADIO_OFF -> "radio_off"
          code == SmsManager.RESULT_ERROR_NO_SERVICE -> "no_service"
          code == SmsManager.RESULT_ERROR_LIMIT_EXCEEDED -> "limit_exceeded"
          code == SmsManager.RESULT_RIL_SIM_ABSENT -> "sim_absent"
          else -> "send_failed"
        }
        val outcome = accumulator.completeIfReady() ?: return
        finish(outcome, if (outcome == "sent") "sent_confirmed" else failureReason, true)
      }
    }
    var handoffEntered = false
    try {
      ContextCompat.registerReceiver(context, receiver, IntentFilter(action), ContextCompat.RECEIVER_NOT_EXPORTED)
      registered = true
      for (index in parts.indices) {
        val intent = Intent(action).setPackage(context.packageName)
          .setData(Uri.parse("safemelink-sms://sent/$attempt/$index"))
        intents.add(PendingIntent.getBroadcast(context, index, intent, PendingIntent.FLAG_IMMUTABLE))
      }
      timeout = Runnable {
        if (accumulator.expire()) finish("unknown", "sent_confirmation_timeout", true)
      }
      handler.postDelayed(timeout!!, SENT_TIMEOUT_MS)
      // Register every callback before handoff. Multipart success requires every part.
      handoffEntered = true
      if (parts.size == 1) manager.sendTextMessage(phone, null, message, intents[0], null)
      else manager.sendMultipartTextMessage(phone, null, parts, intents, null)
    } catch (_: Exception) {
      // A thrown call does not prove that no part was handed to the modem.
      accumulator.expire()
      finish(if (handoffEntered) "unknown" else "failed",
        if (handoffEntered) "native_result_unknown" else "setup_failed", handoffEntered)
    }
  }
}
