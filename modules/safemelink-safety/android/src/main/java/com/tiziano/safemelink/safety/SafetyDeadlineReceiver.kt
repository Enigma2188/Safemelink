package com.tiziano.safemelink.safety

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

class SafetyDeadlineReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val enteredAt = System.currentTimeMillis()
    val generation = intent.getStringExtra("generation") ?: return
    val stage = intent.getIntExtra("stage", 0)
    CheckpointDiagnosticJournal.record(context, "RECEIVER_ENTERED", generation = generation, stage = stage, occurredAt = enteredAt)
    try {
      val record = SafetyDeadlineStore.fired(context, generation, stage) ?: return
      if (stage == 1) SafetyDeadlineStore.publishConfirmation(context, record) else {
        val service = Intent(context, SafetyEscalationService::class.java).putExtra("generation", generation)
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(service) else context.startService(service)
      }
    } catch (error: Exception) {
      CheckpointDiagnosticJournal.record(context, "ALARM_HANDLING_FAILED", generation = generation, stage = stage, outcome = "native_exception")
      Log.w("SafetyDeadline", "ALARM_HANDLING_FAILED category=${error.javaClass.simpleName} nowMs=${System.currentTimeMillis()}")
      runCatching { SafetyDeadlineStore.showFailureIfCurrent(context, generation, stage == 1) }
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
