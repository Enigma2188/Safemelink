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
  @Volatile var onCheckpointNoticeFailed: (() -> Unit)? = null
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
    if (record.getString("generation") != generation || record.optString("state") in listOf("failed", "cancelled")) return false
    check(allowed(context)) { "exact_alarm_permission" }
    // Preserve an in-progress claim and its recovery lease; never create a fresh T2.
    if (record.optBoolean("claimed")) {
      recoveryAlarm(context, record)
      return true
    }
    // Check at the native arm boundary too: JS preflight may now be obsolete.
    // A later permission revocation must NOT silently cancel an existing T2.
    if (!record.optBoolean("armed")) checkNotificationPrerequisites(context, channelId)
    if (System.currentTimeMillis() >= record.getLong("t1")) trace("LATE_ARM_ORIGINAL_DEADLINES_PRESERVED", record.getLong("t1"))
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
  @Synchronized fun recover(context: Context, userId: String, kind: String, sessionId: String, t1: Long, t2: Long, generation: String?): String? {
    val current = read(context)
    if (current != null) {
      if (generation == null || !matches(context, userId, sessionId, generation) || current.optString("kind") != kind ||
        current.getLong("t1") != t1 || current.getLong("t2") != t2 || current.optString("state") == "failed") return null
      return generation // Preserve firstFired, claim, operationId and lease.
    }
    // Missing durable identity is not permission to revive a former generation.
    if (generation != null) return null
    return prepare(context, userId, kind, sessionId, t1, t2)
  }
  @Synchronized fun finish(context: Context, userId: String, sessionId: String, generation: String) {
    if (!matches(context, userId, sessionId, generation)) return
    cancel(context, userId, null, sessionId)
  }
  @Synchronized fun operationId(context: Context, userId: String, sessionId: String, generation: String): String {
    check(matches(context, userId, sessionId, generation)) { "stale_deadline_generation" }
    return read(context)!!.getString("operationId")
  }
  @Synchronized fun rollback(context: Context, userId: String, sessionId: String, generation: String): Boolean {
    if (!matches(context, userId, sessionId, generation)) return false
    val current = read(context) ?: return false
    // A late arm/storage error must not cancel a legitimate T2 or its recovery lease.
    if (current.optBoolean("claimed") || (current.optBoolean("armed") && System.currentTimeMillis() >= current.getLong("t2"))) return false
    finish(context, userId, sessionId, generation)
    return true
  }
  @Synchronized fun matches(context: Context, userId: String, sessionId: String, generation: String): Boolean {
    val record = read(context) ?: return false
    return record.optString("userId") == userId && record.optString("sessionId") == sessionId &&
      record.optString("generation") == generation && record.optString("state") != "cancelled"
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
    // Durable tombstone defeats recovery after a crash between native cancellation
    // and JS/source cleanup. Only an explicit prepare may replace it.
    record.put("armed", false).put("claimed", false).put("state", "cancelled")
    write(context, record)
  }
  @Synchronized fun release(context: Context, userId: String, sessionId: String, generation: String) {
    if (!matches(context, userId, sessionId, generation)) return
    val record = read(context) ?: return
    record.put("claimed", false).put("state", "recoverable")
    write(context, record) // Used only for a JS storage failure BEFORE completeSOS was called.
  }
  @Synchronized fun fired(context: Context, generation: String, stage: Int): JSONObject? {
    val record = read(context) ?: return null
    if (record.optString("generation") != generation || !record.optBoolean("armed") || record.optString("state") in listOf("failed", "cancelled")) return null
    val key = if (stage == 1) "firstFired" else "escalationFired"
    if (stage !in 1..2 || (stage == 1 && record.optBoolean(key))) return null
    if (stage == 2 && record.optBoolean("claimed") && System.currentTimeMillis() < record.optLong("leaseUntil")) return null
    val deadline = record.getLong(if (stage == 1) "t1" else "t2")
    if (System.currentTimeMillis() < deadline) return null
    // T1 is consumed only after successful publication, not on receiver entry.
    if (stage == 2) {
      record.put(key, true)
      write(context, record)
    }
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
  @Synchronized fun publishConfirmation(context: Context, record: JSONObject) {
    val current = read(context) ?: return
    if (current.optString("generation") != record.optString("generation") ||
      !current.optBoolean("armed") || current.optBoolean("firstFired") || current.optString("state") == "failed") return
    current.put("firstNoticeAttemptedAt", System.currentTimeMillis())
    current.put("firstNoticeFailed", false)
    write(context, current)
    try {
      show(context, current)
    } catch (error: Exception) {
      current.put("firstNoticeFailed", true)
      // An already-armed Checkpoint retains its original T2 even if T1 fails.
      // Only diagnostics change; claim, lease, deadlines and alarms are untouched.
      if (current.optString("kind") == "checkpoint" || current.optString("kind") == "go_home") {
        val reason = when (error.message) {
          "notifications_disabled" -> "notifications_disabled"
          "notification_channel_silent" -> "notification_channel_silent"
          else -> "publication_rejected"
        }
        current.put("firstNoticeFailureReason", reason)
        // Persist the account/session-scoped warning without invalidating T2.
        persistNoticeWarning(context, current, reason)
      } else write(context, current)
      trace("FIRST_NOTICE_REJECTED", current.getLong("t1"))
      throw error
    }
    // Failure to persist this flag is NOT evidence that Android rejected notify().
    current.put("firstFired", true)
    write(context, current)
    if (current.optBoolean("firstNoticeDegraded")) {
      // notify() returned, but Android/user settings do not guarantee an audible,
      // high-importance alert. Never call this a failed publication or cancel T2.
      runCatching { persistNoticeWarning(context, current, "notification_channel_degraded") }
        .onFailure { Log.w("SafetyDeadline", "NOTICE_WARNING_PERSISTENCE_FAILED") }
    }
  }
  private fun persistNoticeWarning(context: Context, current: JSONObject, reason: String) {
    check(preferences(context).edit().putString("deadline", current.toString())
      .putString("checkpoint-notice-failure-${current.getString("userId")}", JSONObject()
        .put("sessionId", current.getString("sessionId")).put("generation", current.getString("generation"))
        .put("kind", current.getString("kind")).put("reason", reason).toString()).commit()) { "deadline_persistence_failed" }
    runCatching { onCheckpointNoticeFailed?.invoke() }
  }
  @Synchronized fun checkpointNoticeFailure(context: Context, userId: String): String? =
    preferences(context).getString("checkpoint-notice-failure-$userId", null)

  @Synchronized fun acknowledgeCheckpointNoticeFailure(context: Context, userId: String, generation: String): Boolean {
    val raw = checkpointNoticeFailure(context, userId) ?: return false
    if (JSONObject(raw).optString("generation") != generation) return false
    // Acknowledgement only dismisses the warning; T2 remains unchanged.
    return preferences(context).edit().remove("checkpoint-notice-failure-$userId").commit()
  }
  private fun checkNotificationPrerequisites(context: Context, channelId: String, requireAudible: Boolean = true): Boolean {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 24 && !manager.areNotificationsEnabled()) {
      Log.w("SafetyDeadline", "NOTIFICATION_PREREQUISITE_FAILED category=notifications_disabled")
      error("notifications_disabled")
    }
    if (Build.VERSION.SDK_INT >= 26) {
      val channel = manager.getNotificationChannel(channelId)
      if (channel == null || channel.importance == NotificationManager.IMPORTANCE_NONE) {
        Log.w("SafetyDeadline", "NOTIFICATION_PREREQUISITE_FAILED category=channel_missing_or_blocked")
        error("notification_channel_silent")
      }
      val audible = channel.importance >= NotificationManager.IMPORTANCE_HIGH && channel.sound != null
      if (requireAudible && !audible) {
        Log.w("SafetyDeadline", "NOTIFICATION_PREREQUISITE_FAILED category=channel_unavailable_or_silent")
        error("notification_channel_silent")
      }
      return audible
    }
    return true
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
    trace(if (failed) "FAILURE_NOTICE_ATTEMPT" else "FIRST_NOTICE_ATTEMPT", record.getLong("t1"))
    val remainingMs = record.getLong("t2") - System.currentTimeMillis()
    val elapsed = remainingMs <= 0 || record.optBoolean("claimed") || record.optBoolean("escalationFired")
    val notice = notification(context, record.optString("channelId", "safety-checks"),
      if (failed) "Controllo di sicurezza da verificare" else if (elapsed) "Tempo di conferma scaduto" else "Stai bene?",
      if (failed || elapsed) "Apri SafeMeLink per verificare lo stato dell’SOS."
      else "Apri SafeMeLink per confermare: restano ${(remainingMs + 999) / 1000} secondi.")
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    // Keep strict pre-arm requirements, but do not suppress a possible visual
    // alert for an already armed session merely because the channel was demoted.
    val audible = checkNotificationPrerequisites(context, record.optString("channelId", "safety-checks"), requireAudible = false)
    record.put("firstNoticeDegraded", !audible)
    if (!audible) trace("FIRST_NOTICE_DEGRADED", record.getLong("t1"))
    manager.notify(NOTICE_ID, notice)
    trace(if (failed) "FAILURE_NOTICE_POSTED" else "FIRST_NOTICE_POSTED", record.getLong("t1"))
  }
}
