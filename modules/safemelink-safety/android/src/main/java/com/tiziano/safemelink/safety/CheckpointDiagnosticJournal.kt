package com.tiziano.safemelink.safety

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.UUID

// Separate, bounded, best-effort telemetry. Never calls operational code.
internal object CheckpointDiagnosticJournal {
  private const val LIMIT = 100
  private fun prefs(context: Context) = context.getSharedPreferences("checkpoint-diagnostic-journal", Context.MODE_PRIVATE)
  private fun hash(salt: String, value: String): String = MessageDigest.getInstance("SHA-256")
    .digest("$salt:$value".toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

  @Synchronized fun record(context: Context, event: String, record: JSONObject? = null,
    generation: String? = null, stage: Int = 0, outcome: String = "recorded", deadline: Long? = null,
    occurredAt: Long = System.currentTimeMillis()) {
    if (!BuildConfig.CHECKPOINT_DIAGNOSTICS) return
    try {
      val p = prefs(context)
      val salt = p.getString("salt", null) ?: UUID.randomUUID().toString()
      val events = JSONArray(p.getString("events", "[]"))
      val gen = generation ?: record?.optString("generation") ?: return
      if (gen.isBlank()) return
      val correlation = hash(salt, gen)
      // A stale receiver must never be attributed to the current account.
      val previous = (events.length() - 1 downTo 0).map { events.getJSONObject(it) }
        .firstOrNull { it.optString("session") == correlation }
      val owner = if (record != null && record.optString("generation") == gen &&
        record.optString("kind") == "checkpoint" && record.optString("userId").isNotBlank())
        hash(salt, record.getString("userId")) else previous?.optString("owner") ?: return
      val now = occurredAt
      val entry = JSONObject().put("owner", owner).put("session", correlation)
        .put("timestamp", now).put("event", event).put("phase", if (stage == 1) "T1" else if (stage == 2) "T2" else "session")
        .put("outcome", outcome)
      if (deadline != null) entry.put("deadline", deadline).put("lateness", maxOf(0, now - deadline))
      val bounded = JSONArray()
      for (i in maxOf(0, events.length() - LIMIT + 1) until events.length()) bounded.put(events.getJSONObject(i))
      bounded.put(entry)
      // apply() avoids a synchronous disk commit on the alarm path. A process/power
      // failure before the disk flush may lose the newest diagnostic events only.
      p.edit().putString("salt", salt).putString("events", bounded.toString()).apply()
    } catch (_: Throwable) { /* Diagnostic failure must never escape. */ }
  }

  @Synchronized fun read(context: Context, userId: String): String {
    if (!BuildConfig.CHECKPOINT_DIAGNOSTICS || userId.isBlank()) return "[]"
    return try {
      val p = prefs(context)
      val salt = p.getString("salt", null) ?: return "[]"
      val owner = hash(salt, userId)
      val events = JSONArray(p.getString("events", "[]"))
      val result = JSONArray()
      for (i in 0 until events.length()) {
        val event = events.getJSONObject(i)
        if (event.optString("owner") != owner) continue
        // Export an explicit allowlist, never the internal owner hash.
        val safe = JSONObject()
        for (key in listOf("timestamp", "event", "phase", "outcome", "deadline", "lateness", "session"))
          if (event.has(key)) safe.put(key, event.get(key))
        result.put(safe)
      }
      result.toString()
    } catch (_: Throwable) { "[]" }
  }
}
