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
  private static String state = "OFF", reason = "";
  private VoskLabState() {}
  public static synchronized long reserve() {
    if (busy) throw new IllegalStateException("lab_busy");
    token++; busy = true; worker = false; cancelled = false;
    state = "PREPARING"; reason = ""; detections = 0; return token;
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
    if (!current(value)) return false; state = "LISTENING"; return true;
  }
  public static synchronized void detected(long value) { if (current(value) && state.equals("LISTENING")) detections++; }
  public static synchronized void stop(String code, boolean forget) {
    if (forget) detections = 0;
    if (!busy) { if (forget) { state = "OFF"; reason = ""; } return; }
    if (cancelled) return;
    cancelled = true; state = "STOPPING"; reason = code;
  }
  public static synchronized void finish(long value, String error) {
    if (token != value || !busy) return; busy = false; worker = false;
    if (!cancelled && !error.isEmpty()) { state = "ERROR"; reason = error; } else state = "OFF";
  }
  public static synchronized void expireCancelledStart(long value) {
    if (token == value && !worker && cancelled) finish(value, "");
  }
  public static synchronized void reset() { detections = 0; }
  public static synchronized Map<String, Object> snapshot() {
    Map<String, Object> result = new LinkedHashMap<>(); result.put("state", state); result.put("reason", reason);
    result.put("detections", detections); result.put("busy", busy); return result;
  }
  public static String normalize(String text) {
    return Normalizer.normalize(text, Normalizer.Form.NFC).toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}]+", " ").trim();
  }
  public static boolean matchesFinal(String text, String phrase) {
    return !phrase.isEmpty() && (" " + normalize(text) + " ").contains(" " + phrase + " ");
  }
}
