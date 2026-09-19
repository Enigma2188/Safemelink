package com.tiziano.safemelink.safety

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import org.json.JSONObject
import java.util.UUID

// One preventive mode per app. Identity stays in private, non-backed-up storage;
// alarm Intents carry only an opaque generation, never coordinates or credentials.
internal object SafetyDeadlineStore {
  const val NOTICE_ID = 4100
  const val SERVICE_ID = 4103
  const val SERVICE_CHANNEL = "safety-execution"
  private fun preferences(context: Context) = context.getSharedPreferences("safemelink-safety", Context.MODE_PRIVATE)
  @Synchronized fun read(context: Context): JSONObject? =
    preferences(context).getString("deadline", null)?.let { runCatching { JSONObject(it) }.getOrNull() }
  private fun write(context: Context, record: JSONObject) {
    check(preferences(context).edit().putString("deadline", record.toString()).commit()) { "deadline_persistence_failed" }
  }
  private fun alarms(context: Context) = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
  fun allowed(context: Context) = Build.VERSION.SDK_INT < 31 || alarms(context).canScheduleExactAlarms()
  fun trace(event: String, deadline: Long) {
    val now = System.currentTimeMillis()
    Log.i("SafetyDeadline", "$event nowMs=$now deadlineMs=$deadline latenessMs=${maxOf(0, now - deadline)}")
  }
  fun openApp(context: Context): PendingIntent {
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: Intent(Intent.ACTION_VIEW, Uri.parse("safemelink://")).setPackage(context.packageName)
    return PendingIntent.getActivity(context, 4104, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }
  private fun pending(context: Context, generation: String, stage: Int): PendingIntent =
    PendingIntent.getBroadcast(context, 4100 + stage,
      Intent(context, SafetyDeadlineReceiver::class.java)
        .setData(Uri.parse("safemelink-safety://alarm/$generation/$stage"))
        .putExtra("generation", generation).putExtra("stage", stage),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  private fun cancelAlarms(context: Context, record: JSONObject) {
    for (stage in 1..2) {
      val operation = pending(context, record.getString("generation"), stage)
      alarms(context).cancel(operation)
      operation.cancel()
    }
    (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(NOTICE_ID)
  }
  @Synchronized fun prepare(context: Context, userId: String, kind: String, sessionId: String, t1: Long, t2: Long): String {
    require(userId.isNotBlank() && sessionId.isNotBlank() && kind in listOf("checkpoint", "go_home"))
    require(t1 > 0 && t2 == t1 + 30_000) { "invalid_safety_deadlines" }
    check(allowed(context)) { "exact_alarm_permission" }
    read(context)?.let { cancelAlarms(context, it) }
    val generation = UUID.randomUUID().toString()
    // Stable even if cleanup/re-arm repeats; generation only identifies the alarms.
    val operationId = UUID.nameUUIDFromBytes("$userId:$kind:$sessionId".toByteArray(Charsets.UTF_8)).toString()
    write(context, JSONObject().put("userId", userId).put("sessionId", sessionId).put("kind", kind)
      .put("generation", generation).put("operationId", operationId).put("state", "pending").put("attempts", 0)
      .put("t1", t1).put("t2", t2).put("armed", false).put("claimed", false))
    return generation
  }
  @Synchronized fun arm(context: Context, generation: String, channelId: String): Boolean {
    val record = read(context) ?: return false
    if (record.getString("generation") != generation || record.optBoolean("claimed")) return false
    check(allowed(context)) { "exact_alarm_permission" }
    record.put("channelId", channelId).put("armed", true)
    write(context, record)
    try {
      for (stage in 1..2) {
        if (stage == 1 && record.optBoolean("firstFired")) continue
        val deadline = record.getLong(if (stage == 1) "t1" else "t2")
        // Alarm-clock deadlines are user-visible and do not share the Doze
        // nine-minute allowWhileIdle quota: T2 really may follow T1 by 30s.
        alarms(context).setAlarmClock(AlarmManager.AlarmClockInfo(maxOf(System.currentTimeMillis() + 100, deadline),
          openApp(context)), pending(context, generation, stage))
        trace(if (stage == 1) "FIRST_ALARM_SCHEDULED" else "ESCALATION_ALARM_SCHEDULED", deadline)
      }
    } catch (error: Exception) {
      cancelAlarms(context, record)
      record.put("armed", false)
      write(context, record)
      throw error
    }
    return true
  }
  @Synchronized fun matches(context: Context, userId: String, sessionId: String, generation: String): Boolean {
    val record = read(context) ?: return false
    return record.optString("userId") == userId && record.optString("sessionId") == sessionId &&
      record.optString("generation") == generation
  }
  @Synchronized fun restore(context: Context) {
    val record = read(context) ?: return
    if (!record.optBoolean("armed") || record.optString("state") == "failed" || !allowed(context)) return
    if (record.optBoolean("claimed")) {
      recoveryAlarm(context, record)
      return
    }
    record.put("escalationFired", false)
    write(context, record)
    arm(context, record.getString("generation"), record.optString("channelId", "safety-checks"))
  }
  @Synchronized fun claim(context: Context, userId: String, sessionId: String, generation: String): Boolean {
    if (!matches(context, userId, sessionId, generation)) return false
    val record = read(context) ?: return false
    val now = System.currentTimeMillis()
    if (!record.optBoolean("armed") || now < record.getLong("t2") || record.optString("state") == "failed") return false
    if (record.optBoolean("claimed") && now < record.optLong("leaseUntil")) return false
    if (record.optInt("attempts") >= 3) {
      record.put("state", "failed")
      write(context, record)
      show(context, record, true)
      return false
    }
    record.put("claimed", true).put("state", "in_progress").put("attempts", record.optInt("attempts") + 1)
      .put("leaseUntil", now + 300_000)
    write(context, record) // Durable before any JS/network side effect; operation identity survives recovery.
    recoveryAlarm(context, record)
    trace("SOS_EXECUTION_CLAIMED_NATIVE", record.getLong("t2"))
    return true
  }
  private fun recoveryAlarm(context: Context, record: JSONObject) {
    alarms(context).setAlarmClock(AlarmManager.AlarmClockInfo(maxOf(System.currentTimeMillis() + 100,
      record.optLong("leaseUntil", System.currentTimeMillis() + 300_000)), openApp(context)),
      pending(context, record.getString("generation"), 2))
  }
  @Synchronized fun state(context: Context, userId: String, sessionId: String, generation: String): String {
    if (!matches(context, userId, sessionId, generation)) return "missing"
    val record = read(context) ?: return "missing"
    if (record.optString("state") == "in_progress" && System.currentTimeMillis() >= record.optLong("leaseUntil")) return "recoverable"
    return record.optString("state", "pending")
  }
  @Synchronized fun cancel(context: Context, userId: String, kind: String?, sessionId: String?) {
    val record = read(context) ?: return
    if (record.optString("userId") != userId || (kind != null && record.optString("kind") != kind) ||
      (sessionId != null && record.optString("sessionId") != sessionId)) return
    cancelAlarms(context, record)
    check(preferences(context).edit().remove("deadline").commit()) { "deadline_cancel_failed" }
  }
  @Synchronized fun release(context: Context, userId: String, sessionId: String, generation: String) {
    if (!matches(context, userId, sessionId, generation)) return
    val record = read(context) ?: return
    record.put("claimed", false).put("state", "recoverable")
    write(context, record) // Used only for a JS storage failure BEFORE completeSOS was called.
  }
  @Synchronized fun fired(context: Context, generation: String, stage: Int): JSONObject? {
    val record = read(context) ?: return null
    if (record.optString("generation") != generation || !record.optBoolean("armed") || record.optString("state") == "failed") return null
    val key = if (stage == 1) "firstFired" else "escalationFired"
    if (stage !in 1..2 || (stage == 1 && record.optBoolean(key))) return null
    if (stage == 2 && record.optBoolean("claimed") && System.currentTimeMillis() < record.optLong("leaseUntil")) return null
    val deadline = record.getLong(if (stage == 1) "t1" else "t2")
    if (System.currentTimeMillis() < deadline) return null
    record.put(key, true)
    write(context, record)
    // Cover service/JS startup failure BEFORE the first claim too. Bounded to three wakeups.
    if (stage == 2 && !record.optBoolean("claimed")) {
      val wakes = record.optInt("startupWakes") + 1
      record.put("startupWakes", wakes)
      if (wakes <= 3) {
        record.put("leaseUntil", System.currentTimeMillis() + 300_000)
        write(context, record)
        recoveryAlarm(context, record)
      } else {
        record.put("state", "failed")
        write(context, record)
        show(context, record, true)
        return null
      }
    }
    trace(if (stage == 1) "FIRST_ALARM_FIRED" else "ESCALATION_ALARM_FIRED", deadline)
    return record
  }
  fun notification(context: Context, channelId: String, title: String, body: String, silent: Boolean = false): Notification {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(channelId) == null) {
      val channel = NotificationChannel(channelId, if (silent) "Esecuzione sicurezza" else "Verifiche di sicurezza",
        if (silent) NotificationManager.IMPORTANCE_LOW else NotificationManager.IMPORTANCE_HIGH)
      if (silent) channel.setSound(null, null) else {
        channel.setSound(Settings.System.DEFAULT_NOTIFICATION_URI, AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_NOTIFICATION).build())
        channel.enableVibration(true)
      }
      manager.createNotificationChannel(channel)
    }
    @Suppress("DEPRECATION")
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, channelId) else Notification.Builder(context)
    builder.setSmallIcon(context.applicationInfo.icon).setContentTitle(title).setContentText(body)
      .setContentIntent(openApp(context)).setAutoCancel(!silent).setVisibility(Notification.VISIBILITY_PRIVATE)
    if (Build.VERSION.SDK_INT < 26 && !silent) builder.setDefaults(Notification.DEFAULT_SOUND or Notification.DEFAULT_VIBRATE)
    return builder.build()
  }
  fun show(context: Context, record: JSONObject, failed: Boolean = false) {
    val notice = notification(context, record.optString("channelId", "safety-checks"),
      if (failed) "Controllo di sicurezza da verificare" else "Stai bene?",
      if (failed) "Apri SafeMeLink per verificare l’SOS." else "Apri SafeMeLink per confermare entro 30 secondi.")
    (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(NOTICE_ID, notice)
  }
}
