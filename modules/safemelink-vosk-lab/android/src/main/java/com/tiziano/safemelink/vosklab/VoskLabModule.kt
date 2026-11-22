package com.tiziano.safemelink.vosklab

import android.app.ActivityManager
import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// No Vosk classes are referenced when the native build gate is off.

class VoskLabModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SafeMeLinkVoskLab")
    Function("enabled") { BuildConfig.VOSK_LAB }
    Function("busy") { VoskLabState.busy() }
    Function("snapshot") { VoskLabState.snapshot() }
    Function("reset") { VoskLabState.reset() }
    Function("stop") { forget: Boolean ->
      VoskLabState.stop(if (forget) "context_changed" else "user_stop", forget)
      val context = appContext.reactContext
      if (BuildConfig.VOSK_LAB && context != null) context.stopService(Intent().setClassName(context, "com.tiziano.safemelink.vosklab.VoskLabService"))
      val token = VoskLabState.token()
      Handler(Looper.getMainLooper()).postDelayed({ VoskLabState.expireCancelledStart(token) }, 5_000)
      Unit
    }
    Function("start") { phrase: String, automaticGain: Boolean ->
      check(BuildConfig.VOSK_LAB) { "lab_disabled" }
      val activity = appContext.currentActivity ?: error("activity_unavailable")
      check(!activity.isFinishing && !activity.isDestroyed && activity.hasWindowFocus()) { "visible_activity_required" }
      check(activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) { "microphone_permission" }
      if (Build.VERSION.SDK_INT >= 33) check(activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) { "notification_permission" }
      val manager = activity.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      @Suppress("DEPRECATION")
      check(manager.getRunningServices(Int.MAX_VALUE).none {
        it.service.className == "com.asterinet.react.bgactions.RNBackgroundActionsTask"
      }) { "stop_core_service_first" }
      val normalized = VoskLabState.normalize(phrase)
      check(normalized.isNotEmpty() && normalized.length <= 100) { "invalid_test_phrase" }
      val token = VoskLabState.reserve(automaticGain)
      try {
        val target = Class.forName("com.tiziano.safemelink.vosklab.VoskLabService")
        val intent = Intent(activity, target).putExtra("token", token).putExtra("phrase", normalized)
          .putExtra("automaticGain", automaticGain)
        if (Build.VERSION.SDK_INT >= 26) activity.startForegroundService(intent) else activity.startService(intent)
      } catch (_: Throwable) {
        VoskLabState.finish(token, "start_rejected")
        throw IllegalStateException("start_rejected")
      }
      Unit
    }
  }
}
