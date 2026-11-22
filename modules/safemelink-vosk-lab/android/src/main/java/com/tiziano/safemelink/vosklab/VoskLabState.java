package com.tiziano.safemelink.vosklab;
import java.text.Normalizer;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
/** Volatile process-local state; no audio, phrase, transcript or account. */
public final class VoskLabState {
  private static long token;
  private static boolean busy, worker, cancelled;
  private static int detections;
  private static int audioLevel, audioPeak;
  private static boolean gainRequested, gainActive;
  private static String state = "OFF", reason = "";
  private VoskLabState() {}
  public static synchronized long reserve() {
    return reserve(false);
  }
  public static synchronized long reserve(boolean automaticGain) {
    if (busy) throw new IllegalStateException("lab_busy");
    token++; busy = true; worker = false; cancelled = false;
    state = "PREPARING"; reason = ""; detections = 0;
    audioLevel = 0; audioPeak = 0; gainRequested = automaticGain; gainActive = false; return token;
  }
  public static synchronized boolean enter(long value) {
    if (!current(value) || worker) return false; worker = true; return true;
  }
  public static synchronized boolean current(long value) { return busy && token == value && !cancelled; }
  public static synchronized boolean owns(long value) { return busy && token == value; }
  public static synchronized boolean busy() { return busy; }
  public static synchronized boolean hasWorker() { return worker; }
  public static synchronized long token() { return token; }
  public static synchronized boolean listening(long value) {
    if (!current(value) || (gainRequested && !gainActive)) return false; state = "LISTENING"; return true;
  }
  public static synchronized boolean gainEnabled(long value) {
    if (!current(value) || !gainRequested) return false; gainActive = true; return true;
  }
  /** Relative RMS index: -60 dBFS or less = 0, digital full scale = 100; not calibrated SPL. */
  public static int pcmLevel(byte[] pcm, int size) {
    if (pcm == null || size < 0 || size > pcm.length) throw new IllegalArgumentException("invalid_pcm_size");
    int samples = size / 2;
    if (samples == 0) return 0;
    double squares = 0;
    for (int i = 0; i < samples * 2; i += 2) {
      int sample = (short)((pcm[i] & 255) | ((pcm[i + 1] & 255) << 8));
      squares += (double)sample * sample;
    }
    if (squares == 0) return 0;
    double db = 20 * Math.log10(Math.sqrt(squares / samples) / 32768.0);
    return Math.max(0, Math.min(100, (int)Math.round((db + 60) * 100 / 60)));
  }
  public static synchronized void audio(long value, byte[] pcm, int size) {
    if (!current(value) || !state.equals("LISTENING")) return;
    audioLevel = pcmLevel(pcm, size); audioPeak = Math.max(audioPeak, audioLevel);
  }
  public static synchronized void captureEnded(long value) {
    if (!owns(value)) return;
    audioLevel = 0; gainActive = false; state = "STOPPING";
  }
  public static synchronized void detected(long value) { if (current(value) && state.equals("LISTENING")) detections++; }
  public static synchronized void stop(String code, boolean forget) {
    audioLevel = 0; gainActive = false;
    if (forget) { detections = 0; audioPeak = 0; gainRequested = false; }
    if (!busy) { if (forget) { state = "OFF"; reason = ""; } return; }
    if (cancelled) return;
    cancelled = true; state = "STOPPING"; reason = code;
  }
  public static synchronized void finish(long value, String error) {
    if (token != value || !busy) return; busy = false; worker = false;
    audioLevel = 0; gainActive = false;
    if (!cancelled && !error.isEmpty()) { state = "ERROR"; reason = error; } else state = "OFF";
  }
  public static synchronized void expireCancelledStart(long value) {
    if (token == value && !worker && cancelled) finish(value, "");
  }
  public static synchronized void reset() { detections = 0; audioLevel = 0; audioPeak = 0; }
  public static synchronized Map<String, Object> snapshot() {
    Map<String, Object> result = new LinkedHashMap<>(); result.put("state", state); result.put("reason", reason);
    result.put("detections", detections); result.put("busy", busy);
    result.put("audioLevel", audioLevel); result.put("audioPeak", audioPeak);
    result.put("gainRequested", gainRequested); result.put("gainActive", gainActive); return result;
  }
  public static String normalize(String text) {
    return Normalizer.normalize(text, Normalizer.Form.NFC).toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]+", " ").trim();
  }
  public static boolean matchesFinal(String text, String phrase) {
    return !phrase.isEmpty() && (" " + normalize(text) + " ").contains(" " + phrase + " ");
  }
}
