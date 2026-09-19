package com.tiziano.safemelink.safety

import android.app.Service
import android.app.ActivityManager
import android.Manifest
import android.content.pm.PackageManager
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener

// Independent bounded wake lock: never release Voice Protection's shared lock.
class SafetyEscalationService : Service(), HeadlessJsTaskEventListener {
  private val handler = Handler(Looper.getMainLooper())
  private val stop = Runnable { failed("ESCALATION_SERVICE_TIMEOUT"); stopSelf() }
  private var wakeLock: PowerManager.WakeLock? = null
  private var listener: ReactInstanceEventListener? = null
  private var taskContext: HeadlessJsTaskContext? = null
  private val pending = mutableListOf<HeadlessJsTaskConfig>()
  private val tasks = mutableSetOf<Int>()
  private var destroyed = false
  private var ready = false
  private val reactApplication get() = application as ReactApplication
  override fun onCreate() {
    super.onCreate()
    try {
    val notification = SafetyDeadlineStore.notification(this, SafetyDeadlineStore.SERVICE_CHANNEL,
      "Controllo di sicurezza", "SafeMeLink sta verificando la scadenza.", true)
    val process = ActivityManager.RunningAppProcessInfo()
    ActivityManager.getMyMemoryState(process)
    val locationGranted = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
      checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
    val backgroundGranted = Build.VERSION.SDK_INT < 29 ||
      checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED
    val locationAllowed = locationGranted && (backgroundGranted || process.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND)
    if (Build.VERSION.SDK_INT >= 34) startForeground(SafetyDeadlineStore.SERVICE_ID, notification,
      ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE or (if (locationAllowed) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0))
    else if (Build.VERSION.SDK_INT >= 29) startForeground(SafetyDeadlineStore.SERVICE_ID, notification,
      if (locationAllowed) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0)
    else startForeground(SafetyDeadlineStore.SERVICE_ID, notification)
    wakeLock = (getSystemService(POWER_SERVICE) as PowerManager)
      .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SafeMeLink:SafetyEscalation").apply {
        setReferenceCounted(false)
        acquire(240_000)
      }
    handler.postDelayed(stop, 240_000)
    ready = true
    } catch (_: Exception) {
      failed("ESCALATION_SERVICE_START_FAILED")
      stopSelf()
    }
  }
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (!ready) { stopSelf(startId); return START_NOT_STICKY }
    return try { handleStart(intent, startId) } catch (_: Exception) {
      failed("HEADLESS_START_FAILED")
      stopSelf(startId)
      START_NOT_STICKY
    }
  }
  private fun handleStart(intent: Intent?, startId: Int): Int {
    val record = SafetyDeadlineStore.read(this)
    if (record == null || record.optString("generation") != intent?.getStringExtra("generation") || record.optString("state") == "failed") {
      if (tasks.isEmpty() && pending.isEmpty()) stopSelf(startId)
      return START_NOT_STICKY
    }
    val data = Arguments.createMap().apply {
      putString("userId", record.getString("userId"))
      putString("sessionId", record.getString("sessionId"))
      putString("generation", record.getString("generation"))
    }
    pending.add(HeadlessJsTaskConfig("SafeMeLinkSafetyEscalation", data, 240_000, true))
    val host = reactApplication.reactHost
    @Suppress("DEPRECATION")
    val context = host?.currentReactContext ?: if (host == null) reactApplication.reactNativeHost.reactInstanceManager.currentReactContext else null
    if (context != null) dispatch(context) else if (listener == null) {
      val created = object : ReactInstanceEventListener {
        override fun onReactContextInitialized(context: ReactContext) {
          handler.post {
            if (!destroyed) { detachListener(); dispatch(context) }
          }
        }
      }
      listener = created
      if (host != null) {
        host.addReactInstanceEventListener(created)
        host.start()
      } else {
        @Suppress("DEPRECATION")
        val manager = reactApplication.reactNativeHost.reactInstanceManager
        manager.addReactInstanceEventListener(created)
        manager.createReactContextInBackground()
      }
    }
    return START_NOT_STICKY
  }
  private fun dispatch(context: ReactContext) {
    try { dispatchReady(context) } catch (_: Exception) {
      failed("HEADLESS_DISPATCH_FAILED")
      stopSelf()
    }
  }
  private fun dispatchReady(context: ReactContext) {
    val current = HeadlessJsTaskContext.getInstance(context)
    taskContext = current
    current.addTaskEventListener(this)
    val ready = pending.toList()
    pending.clear()
    for (config in ready) {
      val user = config.data.getString("userId") ?: continue
      val session = config.data.getString("sessionId") ?: continue
      val generation = config.data.getString("generation") ?: continue
      if (SafetyDeadlineStore.matches(this, user, session, generation)) tasks.add(current.startTask(config))
    }
    if (tasks.isEmpty()) stopSelf()
  }
  private fun detachListener() {
    val registered = listener ?: return
    val host = reactApplication.reactHost
    if (host != null) host.removeReactInstanceEventListener(registered) else {
      @Suppress("DEPRECATION")
      val manager = reactApplication.reactNativeHost.reactInstanceManager
      manager.removeReactInstanceEventListener(registered)
    }
    listener = null
  }
  override fun onHeadlessJsTaskStart(taskId: Int) = Unit
  override fun onHeadlessJsTaskFinish(taskId: Int) {
    handler.post {
      if (!destroyed) {
        tasks.remove(taskId)
        if (tasks.isEmpty() && pending.isEmpty()) stopSelf()
      }
    }
  }
  private fun failed(event: String) {
    Log.w("SafetyDeadline", "$event nowMs=${System.currentTimeMillis()}")
    SafetyDeadlineStore.read(this)?.let { runCatching { SafetyDeadlineStore.show(this, it, true) } }
  }
  override fun onBind(intent: Intent): IBinder? = null
  override fun onDestroy() {
    destroyed = true
    handler.removeCallbacksAndMessages(null)
    detachListener()
    taskContext?.removeTaskEventListener(this)
    if (wakeLock?.isHeld == true) wakeLock?.release()
    super.onDestroy()
  }
}
