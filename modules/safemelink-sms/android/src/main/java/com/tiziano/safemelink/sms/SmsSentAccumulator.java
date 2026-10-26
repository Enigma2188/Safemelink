package com.tiziano.safemelink.sms;

/** Pure state machine: one result per part, one terminal outcome per attempt. */
public final class SmsSentAccumulator {
  private final Boolean[] results;
  private boolean terminal;
  public SmsSentAccumulator(int parts) {
    if (parts < 1) throw new IllegalArgumentException("parts");
    results = new Boolean[parts];
  }
  public synchronized boolean accept(int part, boolean success) {
    if (terminal || part < 0 || part >= results.length || results[part] != null) return false;
    results[part] = success;
    return true;
  }
  public synchronized String completeIfReady() {
    if (terminal) return null;
    boolean allSent = true;
    for (Boolean result : results) {
      if (result == null) return null;
      allSent &= result;
    }
    terminal = true;
    return allSent ? "sent" : "failed";
  }
  public synchronized boolean expire() {
    if (terminal) return false;
    terminal = true;
    return true;
  }
}
