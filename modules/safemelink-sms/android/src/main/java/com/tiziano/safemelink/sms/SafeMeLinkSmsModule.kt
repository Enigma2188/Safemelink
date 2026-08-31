package com.tiziano.safemelink.sms

import android.Manifest
import android.content.pm.PackageManager
import android.telephony.SmsManager
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SafeMeLinkSmsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SafeMeLinkSms")

    AsyncFunction("sendSms") { phone: String, message: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      if (
        ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS) !=
          PackageManager.PERMISSION_GRANTED
      ) {
        throw IllegalStateException("sms_permission_required")
      }
      if (!phone.matches(Regex("^\\+[1-9]\\d{6,14}$"))) {
        throw IllegalArgumentException("invalid_phone")
      }
      if (message.isBlank()) {
        throw IllegalArgumentException("empty_message")
      }

      @Suppress("DEPRECATION")
      val smsManager = SmsManager.getDefault()
      val parts = smsManager.divideMessage(message)
      if (parts.size > 1) {
        smsManager.sendMultipartTextMessage(phone, null, parts, null, null)
      } else {
        smsManager.sendTextMessage(phone, null, message, null, null)
      }
    }
  }
}
