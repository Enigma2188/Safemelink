package com.tiziano.safemelink.safety

import android.app.AlarmManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SafeMeLinkSafetyModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SafeMeLinkSafety")
    Function("canScheduleExactAlarms") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms()
    }
    AsyncFunction("openExactAlarmSettings") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        context.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
          Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
    }
    Function("prepareDeadlines") { userId: String, kind: String, sessionId: String, expiresAt: Double, escalationAt: Double ->
      SafetyDeadlineStore.prepare(appContext.reactContext ?: throw Exceptions.ReactContextLost(),
        userId, kind, sessionId, expiresAt.toLong(), escalationAt.toLong())
    }
    AsyncFunction("armDeadlines") { generation: String, channelId: String ->
      SafetyDeadlineStore.arm(appContext.reactContext ?: throw Exceptions.ReactContextLost(), generation, channelId)
    }
    Function("cancelDeadlines") { userId: String, kind: String?, sessionId: String? ->
      SafetyDeadlineStore.cancel(appContext.reactContext ?: throw Exceptions.ReactContextLost(), userId, kind, sessionId)
    }
    Function("claimEscalation") { userId: String, sessionId: String, generation: String ->
      SafetyDeadlineStore.claim(appContext.reactContext ?: throw Exceptions.ReactContextLost(), userId, sessionId, generation)
    }
    Function("escalationState") { userId: String, sessionId: String, generation: String ->
      SafetyDeadlineStore.state(appContext.reactContext ?: throw Exceptions.ReactContextLost(), userId, sessionId, generation)
    }
    Function("finishDeadlines") { userId: String, sessionId: String, generation: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      if (SafetyDeadlineStore.matches(context, userId, sessionId, generation)) {
        SafetyDeadlineStore.cancel(context, userId, null, sessionId)
      }
    }
    Function("operationId") { userId: String, sessionId: String, generation: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      check(SafetyDeadlineStore.matches(context, userId, sessionId, generation))
      SafetyDeadlineStore.read(context)!!.getString("operationId")
    }
    Function("releaseEscalation") { userId: String, sessionId: String, generation: String ->
      SafetyDeadlineStore.release(appContext.reactContext ?: throw Exceptions.ReactContextLost(), userId, sessionId, generation)
    }
    Function("isCurrentDeadline") { userId: String, sessionId: String, generation: String ->
      SafetyDeadlineStore.matches(appContext.reactContext ?: throw Exceptions.ReactContextLost(), userId, sessionId, generation)
    }
  }
}
