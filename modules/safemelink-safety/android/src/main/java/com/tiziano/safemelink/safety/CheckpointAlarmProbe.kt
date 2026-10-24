package com.tiziano.safemelink.safety

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.SystemClock
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors

// Diagnostic ONLY. No dependency on deadline store, notification, service or SOS.
internal object CheckpointAlarmProbe {
  const val ACTION = "com.tiziano.safemelink.CHECKPOINT_ALARM_PROBE"
  private const val DELAY_MS = 60_000L
  private fun prefs(context: Context) = context.getSharedPreferences("checkpoint-isolated-alarm-probe", Context.MODE_PRIVATE)
  private fun owner(salt: String, user: String) = MessageDigest.getInstance("SHA-256")
    .digest("$salt:$user".toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

  @Synchronized fun schedule(context: Context, userId: String): String {
    check(BuildConfig.CHECKPOINT_DIAGNOSTICS) { "diagnostic_disabled" }
    require(userId.isNotBlank())
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    check(Build.VERSION.SDK_INT < 31 || manager.canScheduleExactAlarms()) { "exact_alarm_permission_missing" }
    val p = prefs(context)
    val salt = p.getString("salt", null) ?: UUID.randomUUID().toString()
    val token = UUID.randomUUID().toString()
    val now = System.currentTimeMillis()
    val elapsed = SystemClock.elapsedRealtime()
    val previous = runCatching { JSONObject(p.getString("state", "{}")) }.getOrNull()?.optString("probe")
    if (!previous.isNullOrBlank()) {
      val priorIntent = Intent(context, CheckpointAlarmProbeReceiver::class.java).setAction(ACTION)
        .setData(Uri.parse("safemelink-probe://alarm/$previous"))
      val prior = PendingIntent.getBroadcast(context, 4290, priorIntent,
        PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE)
      if (prior != null) { manager.cancel(prior); prior.cancel() }
    }
    val state = JSONObject().put("owner", owner(salt, userId)).put("probe", token)
      .put("scheduledAt", now).put("scheduledElapsed", elapsed).put("deadline", now + DELAY_MS)
      .put("expectedElapsed", elapsed + DELAY_MS).put("status", "scheduled")
    // Persist only the isolated fixture before arming; never touch safety state.
    check(p.edit().putString("salt", salt).putString("state", state.toString()).commit()) { "probe_storage_failed" }
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: Intent(Intent.ACTION_VIEW, Uri.parse("safemelink://settings")).setPackage(context.packageName)
    val show = PendingIntent.getActivity(context, 4291, launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    // Unique diagnostic identity: an old delivery cannot inherit the new token.
    val intent = Intent(context, CheckpointAlarmProbeReceiver::class.java).setAction(ACTION)
      .setData(Uri.parse("safemelink-probe://alarm/$token")).putExtra("probe", token)
    val operation = PendingIntent.getBroadcast(context, 4290, intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    state.put("alarmRequestAt", System.currentTimeMillis())
    try {
      manager.setAlarmClock(AlarmManager.AlarmClockInfo(now + DELAY_MS, show), operation)
      state.put("alarmReturnedAt", System.currentTimeMillis())
    } catch (_: Exception) {
      state.put("status", "schedule_failed")
    }
    p.edit().putString("state", state.toString()).apply()
    return read(context, userId)
  }

  @Synchronized fun received(context: Context, token: String, wall: Long, elapsed: Long) {
    if (!BuildConfig.CHECKPOINT_DIAGNOSTICS) return
    val p = prefs(context)
    val state = JSONObject(p.getString("state", null) ?: return)
    if (state.optString("probe") != token || state.optString("status") != "scheduled") return
    val wallDelay = wall - state.getLong("deadline")
    val elapsedDelay = elapsed - state.getLong("expectedElapsed")
    state.put("status", "receiver_entered").put("enteredAt", wall).put("enteredElapsed", elapsed)
      .put("wallDelayMs", wallDelay).put("elapsedDelayMs", elapsedDelay)
      .put("clockUncertain", elapsed < state.getLong("scheduledElapsed") || kotlin.math.abs(wallDelay - elapsedDelay) > 2_000)
    p.edit().putString("state", state.toString()).apply()
  }

  @Synchronized fun read(context: Context, userId: String): String {
    if (!BuildConfig.CHECKPOINT_DIAGNOSTICS || userId.isBlank()) return "{}"
    val p = prefs(context)
    val salt = p.getString("salt", null) ?: return "{}"
    val state = JSONObject(p.getString("state", null) ?: return "{}")
    if (state.optString("owner") != owner(salt, userId)) return "{}"
    val safe = JSONObject()
    for (key in listOf("probe", "status", "scheduledAt", "alarmRequestAt", "alarmReturnedAt", "deadline", "enteredAt", "wallDelayMs", "elapsedDelayMs", "clockUncertain"))
      if (state.has(key)) safe.put(key, state.get(key))
    return safe.toString()
  }
}

class CheckpointAlarmProbeReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    // Capture BEFORE preferences, executor, locks, JSON and any operational code.
    val enteredAt = System.currentTimeMillis()
    val enteredElapsed = SystemClock.elapsedRealtime()
    if (!BuildConfig.CHECKPOINT_DIAGNOSTICS || intent.action != CheckpointAlarmProbe.ACTION) return
    val token = runCatching { intent.getStringExtra("probe") }.getOrNull() ?: return
    val completion = goAsync()
    try {
      writer.execute {
        try { CheckpointAlarmProbe.received(context.applicationContext, token, enteredAt, enteredElapsed) }
        catch (_: Throwable) { /* Missing diagnostics are not evidence of no delivery. */ }
        finally { completion.finish() }
      }
    } catch (_: Throwable) { completion.finish() }
  }
  companion object {
    private val writer = Executors.newSingleThreadExecutor()
  }
}
