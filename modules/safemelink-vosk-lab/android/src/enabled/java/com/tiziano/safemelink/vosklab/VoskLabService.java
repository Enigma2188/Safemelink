package com.tiziano.safemelink.vosklab;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.media.*;
import android.media.audiofx.AutomaticGainControl;
import android.media.audiofx.AudioEffect;
import android.net.Uri;
import android.os.*;
import org.json.JSONObject;
import org.vosk.*;
import com.sun.jna.Library;
import com.sun.jna.Native;
import com.sun.jna.Pointer;
import java.io.*;
import java.util.List;
import java.util.concurrent.*;

/** Audio, model and recognition are owned only by this non-restarting native service. */
public final class VoskLabService extends Service {
  public interface WordLookup extends Library { int vosk_model_find_word(Pointer model, String word); }
  static final String CHANNEL = "vosk-lab-v2";
  static final int NOTICE = 8193;
  static final long LIMIT_MS = 30 * 60 * 1000L;
  private final Handler main = new Handler(Looper.getMainLooper());
  private final ExecutorService executor = Executors.newSingleThreadExecutor();
  private volatile AudioRecord capture;
  private volatile long session;
  private volatile boolean closing;
  private boolean finishing;
  private PowerManager.WakeLock wakeLock;
  private AudioFocusRequest focusRequest;
  private AudioManager audio;
  private final AudioManager.OnAudioFocusChangeListener focus = value -> {
    if (value < 0) halt("audio_interrupted");
  };
  private final Runnable limit = () -> halt("session_limit");
  private final Runnable watchdog = new Runnable() {
    public void run() {
      if (!VoskLabState.owns(session)) return;
      try {
        NotificationManager notices = (NotificationManager)getSystemService(NOTIFICATION_SERVICE);
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED || audio.isMicrophoneMute()) halt("permission_or_privacy");
        else if (!notices.areNotificationsEnabled() || (Build.VERSION.SDK_INT >= 26 &&
          (notices.getNotificationChannel(CHANNEL) == null || notices.getNotificationChannel(CHANNEL).getImportance() == NotificationManager.IMPORTANCE_NONE))) halt("notifications_blocked");
        else if (coreRunning()) halt("core_service_started");
      } catch (RuntimeException ignored) { halt("native_state_unknown"); }
      if (VoskLabState.current(session)) main.postDelayed(this, 1_000);
    }
  };
  @Override public IBinder onBind(Intent intent) { return null; }
  @Override public int onStartCommand(Intent intent, int flags, int id) {
    if (intent != null && "STOP".equals(intent.getAction())) {
      if (intent.getLongExtra("token", -1) == VoskLabState.token()) halt("notification_stop");
      if (!VoskLabState.busy()) stopSelf();
      return START_NOT_STICKY;
    }
    long token = intent == null ? -1 : intent.getLongExtra("token", -1);
    if (!BuildConfig.VOSK_LAB || !VoskLabState.enter(token)) {
      if (!VoskLabState.hasWorker() || (token == VoskLabState.token() && !VoskLabState.current(token))) stopSelf(id);
      return START_NOT_STICKY;
    }
    session = token;
    closing = false;
    String phrase = intent.getStringExtra("phrase"); intent.removeExtra("phrase");
    boolean automaticGain = intent.getBooleanExtra("automaticGain", false);
    try {
      audio = (AudioManager)getSystemService(AUDIO_SERVICE);
      if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED || coreRunning()) throw new IllegalStateException("start_conditions");
      NotificationManager nm = (NotificationManager)getSystemService(NOTIFICATION_SERVICE);
      if (!nm.areNotificationsEnabled()) throw new IllegalStateException("notifications_blocked");
      if (Build.VERSION.SDK_INT >= 26) {
        nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Laboratorio Vosk — nessuna protezione", NotificationManager.IMPORTANCE_LOW));
        if (nm.getNotificationChannel(CHANNEL).getImportance() == NotificationManager.IMPORTANCE_NONE) throw new IllegalStateException("channel_blocked");
      }
      Notification notice = notification(token);
      if (Build.VERSION.SDK_INT >= 30) startForeground(NOTICE, notice, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE);
      else startForeground(NOTICE, notice);
      int granted;
      if (Build.VERSION.SDK_INT >= 26) {
        focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
          .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
          .setOnAudioFocusChangeListener(focus, main).build();
        granted = audio.requestAudioFocus(focusRequest);
      } else granted = audio.requestAudioFocus(focus, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
      if (granted != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) throw new IllegalStateException("audio_focus_denied");
      // Bounded CPU lease for PCM processing while the display is off; no battery exemption.
      wakeLock = ((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SafeMeLink:VoskLab");
      wakeLock.setReferenceCounted(false); wakeLock.acquire(LIMIT_MS + 60_000);
      main.postDelayed(limit, LIMIT_MS); main.post(watchdog);
      executor.execute(() -> recognize(token, phrase, automaticGain));
    } catch (Exception error) {
      releaseSystemResources(); VoskLabState.finish(token, "service_start_failed");
      finishing = true; stopForeground(true); stopSelf();
    }
    return START_NOT_STICKY;
  }
  private Notification notification(long token) {
    Intent stop = new Intent(this, VoskLabService.class).setAction("STOP")
      .setData(Uri.parse("safemelink-vosk-lab://stop/" + token)).putExtra("token", token);
    PendingIntent action = PendingIntent.getService(this, 8193, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    Notification.Builder builder = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
    return builder.setSmallIcon(android.R.drawable.ic_btn_speak_now).setContentTitle("Laboratorio Vosk — nessuna protezione")
      .setContentText("Prova audio in corso o in preparazione. Nessun SOS/SMS. Limite 30 minuti.")
      .setOngoing(true).setCategory(Notification.CATEGORY_SERVICE).setVisibility(Notification.VISIBILITY_PRIVATE)
      .addAction(new Notification.Action.Builder(android.R.drawable.ic_media_pause, "Ferma prova", action).build()).build();
  }
  private boolean coreRunning() {
    ActivityManager manager = (ActivityManager)getSystemService(ACTIVITY_SERVICE);
    for (ActivityManager.RunningServiceInfo value : manager.getRunningServices(Integer.MAX_VALUE))
      if (value.service.getClassName().equals("com.asterinet.react.bgactions.RNBackgroundActionsTask")) return true;
    return false;
  }
  private void halt(String reason) {
    if (closing || !VoskLabState.owns(session)) return;
    VoskLabState.stop(reason, false);
    AudioRecord current = capture;
    if (current != null) try { current.stop(); } catch (RuntimeException ignored) {}
  }
  @Override public void onTaskRemoved(Intent rootIntent) { halt("task_removed"); stopSelf(); }
  @Override public void onDestroy() {
    if (!finishing && session != 0 && VoskLabState.owns(session)) halt("service_destroyed");
    main.removeCallbacksAndMessages(null); executor.shutdown();
    // Worker finally owns release; it must complete before the microphone lease is cleared.
    super.onDestroy();
  }
  private void copyAssets(String asset, File destination, long token) throws Exception {
    if (!VoskLabState.current(token)) throw new InterruptedException();
    String[] children = getAssets().list(asset);
    if (children != null && children.length > 0) {
      if (!destination.isDirectory() && !destination.mkdirs()) throw new IOException();
      for (String child : children) copyAssets(asset + "/" + child, new File(destination, child), token);
    } else try (InputStream input = getAssets().open(asset); FileOutputStream output = new FileOutputStream(destination)) {
      byte[] buffer = new byte[65536]; int size;
      while ((size = input.read(buffer)) != -1) {
        if (!VoskLabState.current(token)) throw new InterruptedException();
        output.write(buffer, 0, size);
      }
    }
  }
  private void recognize(long token, String phrase, boolean automaticGain) {
    AudioRecord recorder = null; Model model = null; Recognizer recognizer = null;
    AutomaticGainControl gain = null;
    AudioManager.AudioRecordingCallback callback = null;
    String error = "";
    String failure = "model_prepare_failed";
    try {
      String target = VoskLabState.normalize(phrase == null ? "" : phrase); phrase = null;
      if (target.isEmpty() || target.length() > 100) throw new IllegalArgumentException();
      File directory = new File(getFilesDir(), "vosk-lab-it");
      copyAssets("vosk-it", directory, token); // Fresh verified packaged assets; worker thread only.
      if (!VoskLabState.current(token)) return;
      LibVosk.vosk_set_log_level(-1);
      failure = "model_load_failed";
      model = new Model(directory.getAbsolutePath());
      failure = "vocabulary_check_failed";
      WordLookup lookup = Native.load("vosk", WordLookup.class);
      for (String word : target.split(" ")) if (lookup.vosk_model_find_word(model.getPointer(), word) < 0) { error = "word_not_in_model"; return; }
      failure = "model_load_failed";
      recognizer = new Recognizer(model, 16000.0f); // Full vocabulary, no restricted grammar.
      failure = "capture_start_failed";
      int minimum = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
      if (minimum <= 0) throw new IllegalStateException();
      recorder = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, 16000, AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT, Math.max(minimum, 6400));
      capture = recorder;
      if (!VoskLabState.current(token)) return;
      if (Build.VERSION.SDK_INT >= 29) {
        callback = new AudioManager.AudioRecordingCallback() {
          @Override public void onRecordingConfigChanged(List<AudioRecordingConfiguration> configurations) {
            if (!VoskLabState.current(token)) return;
            for (AudioRecordingConfiguration configuration : configurations) if (configuration.isClientSilenced()) { halt("audio_silenced"); break; }
          }
        };
        recorder.registerAudioRecordingCallback(getMainExecutor(), callback);
      }
      if (recorder.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException();
      if (automaticGain) {
        failure = "gain_unavailable";
        if (!AutomaticGainControl.isAvailable()) throw new IllegalStateException();
        gain = AutomaticGainControl.create(recorder.getAudioSessionId());
        if (gain == null) throw new IllegalStateException();
        failure = "gain_control_unavailable";
        if (!gain.hasControl()) throw new IllegalStateException();
        failure = "gain_enable_failed";
        if (gain.setEnabled(true) != AudioEffect.SUCCESS || !gain.getEnabled() || !gain.hasControl()) throw new IllegalStateException();
        if (!VoskLabState.gainEnabled(token)) return;
      }
      failure = "capture_start_failed";
      recorder.startRecording();
      if (recorder.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) throw new IllegalStateException();
      if (!VoskLabState.listening(token)) return;
      failure = "capture_read_failed";
      byte[] buffer = new byte[3200];
      while (VoskLabState.current(token)) {
        int size = recorder.read(buffer, 0, buffer.length);
        if (!VoskLabState.current(token)) break;
        if (size <= 0) throw new IOException();
        if (automaticGain) {
          failure = "gain_control_lost";
          if (gain == null || !gain.hasControl() || !gain.getEnabled()) throw new IllegalStateException();
        }
        failure = "capture_read_failed";
        // Measure the same PCM block passed to Vosk; never persist audio or transcripts.
        VoskLabState.audio(token, buffer, size);
        // One decision per completed utterance; partial hypotheses never increment counts.
        if (recognizer.acceptWaveForm(buffer, size)) {
          String finalText = new JSONObject(recognizer.getResult()).optString("text", "");
          if (VoskLabState.matchesFinal(finalText, target)) VoskLabState.detected(token);
        }
      }
    } catch (InterruptedException ignored) { /* Explicit stop while initializing. */ }
      catch (Exception | LinkageError ignored) { error = failure; }
    finally {
      VoskLabState.captureEnded(token);
      closing = true; capture = null;
      if (gain != null) try { gain.release(); } catch (RuntimeException ignored) {}
      if (recorder != null) {
        if (Build.VERSION.SDK_INT >= 29 && callback != null) try { recorder.unregisterAudioRecordingCallback(callback); } catch (RuntimeException ignored) {}
        try { recorder.stop(); } catch (RuntimeException ignored) {}
        try { recorder.release(); } catch (RuntimeException ignored) {}
      }
      if (recognizer != null) try { recognizer.close(); } catch (RuntimeException | LinkageError ignored) {}
      if (model != null) try { model.close(); } catch (RuntimeException | LinkageError ignored) {}
      releaseSystemResources();
      final String outcome = error;
      main.post(() -> {
        if (VoskLabState.owns(token)) {
          finishing = true;
          try { stopForeground(true); stopSelf(); }
          finally { VoskLabState.finish(token, outcome); }
        }
      });
    }
  }
  private void releaseSystemResources() {
    main.removeCallbacks(watchdog); main.removeCallbacks(limit);
    if (audio != null) {
      try {
        if (Build.VERSION.SDK_INT >= 26 && focusRequest != null) audio.abandonAudioFocusRequest(focusRequest);
        else audio.abandonAudioFocus(focus);
      } catch (RuntimeException ignored) {}
    }
    if (wakeLock != null && wakeLock.isHeld()) try { wakeLock.release(); } catch (RuntimeException ignored) {}
  }
}
