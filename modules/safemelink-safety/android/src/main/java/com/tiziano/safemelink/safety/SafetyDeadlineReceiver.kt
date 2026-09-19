package com.tiziano.safemelink.safety

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

class SafetyDeadlineReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    try {
      val generation = intent.getStringExtra("generation") ?: return
      val stage = intent.getIntExtra("stage", 0)
      val record = SafetyDeadlineStore.fired(context, generation, stage) ?: return
      if (stage == 1) SafetyDeadlineStore.show(context, record) else {
        val service = Intent(context, SafetyEscalationService::class.java).putExtra("generation", generation)
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(service) else context.startService(service)
      }
    } catch (_: Exception) {
      Log.w("SafetyDeadline", "ALARM_HANDLING_FAILED nowMs=${System.currentTimeMillis()}")
      SafetyDeadlineStore.read(context)?.let { runCatching { SafetyDeadlineStore.show(context, it, true) } }
    }
  }
}

class SafetyDeadlineRestoreReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action !in listOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED,
      "android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED")) return
    try {
      SafetyDeadlineStore.restore(context)
    } catch (_: Exception) { Log.w("SafetyDeadline", "ALARM_RESTORE_FAILED") }
  }
}
