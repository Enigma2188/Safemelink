package com.tiziano.safemelink.vosklab;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicInteger;
public final class VoskLabStateTest {
  private static void check(boolean yes) { if (!yes) throw new AssertionError(); }
  private static byte[] pcm(int... samples) {
    byte[] value = new byte[samples.length * 2];
    for (int i=0; i<samples.length; i++) { value[2*i]=(byte)samples[i]; value[2*i+1]=(byte)(samples[i] >> 8); }
    return value;
  }
  public static void main(String[] args) throws Exception {
    check(!VoskLabState.busy()); long first = VoskLabState.reserve();
    check(VoskLabState.snapshot().get("state").equals("PREPARING"));
    VoskLabState.stop("user_stop", false); check(!VoskLabState.enter(first)); VoskLabState.expireCancelledStart(first); check(!VoskLabState.busy());
    long second = VoskLabState.reserve(); VoskLabState.finish(first, "stale"); check(VoskLabState.busy());
    check(VoskLabState.enter(second)); check(!VoskLabState.enter(second)); check(VoskLabState.listening(second));
    VoskLabState.detected(first); check(VoskLabState.snapshot().get("detections").equals(0));
    VoskLabState.detected(second); check(VoskLabState.snapshot().get("detections").equals(1));
    VoskLabState.reset(); check(VoskLabState.snapshot().get("detections").equals(0));
    VoskLabState.stop("context_changed", true); VoskLabState.detected(second); check(!VoskLabState.current(second));
    VoskLabState.finish(second, "ignored_after_stop"); VoskLabState.finish(second, "duplicate"); check(VoskLabState.snapshot().get("state").equals("OFF"));
    check(VoskLabState.matchesFinal("Qui AIUTO! Subito", "aiuto")); check(!VoskLabState.matchesFinal("maiutare", "aiuto"));
    check(VoskLabState.matchesFinal("Un caffè, grazie", "caffè")); check(!VoskLabState.matchesFinal("test", ""));
    check(VoskLabState.pcmLevel(pcm(0,0),4)==0);
    check(VoskLabState.pcmLevel(pcm(32767,-32768),4)==100);
    check(VoskLabState.pcmLevel(pcm(1,-1),4)==0);
    check(VoskLabState.pcmLevel(pcm(3276,-3276),4)==67);
    check(VoskLabState.pcmLevel(pcm(0,32767),2)==0); // No samples beyond valid read length.
    check(VoskLabState.pcmLevel(new byte[]{1},1)==0);
    boolean rejected=false; try { VoskLabState.pcmLevel(new byte[2],3); } catch (IllegalArgumentException expected) { rejected=true; } check(rejected);
    long gain = VoskLabState.reserve(true); check(VoskLabState.enter(gain));
    check(VoskLabState.snapshot().get("gainRequested").equals(true));
    check(!VoskLabState.listening(gain)); // ON cannot claim listening before effect verification.
    check(VoskLabState.gainEnabled(gain)); check(VoskLabState.listening(gain));
    VoskLabState.audio(second,pcm(32767),2); check(VoskLabState.snapshot().get("audioLevel").equals(0));
    VoskLabState.audio(gain,pcm(3276),2); check(VoskLabState.snapshot().get("audioLevel").equals(67));
    VoskLabState.audio(gain,pcm(32767),2); VoskLabState.audio(gain,pcm(0),2);
    check(VoskLabState.snapshot().get("audioLevel").equals(0)); check(VoskLabState.snapshot().get("audioPeak").equals(100));
    VoskLabState.reset(); check(VoskLabState.snapshot().get("audioPeak").equals(0));
    check(VoskLabState.snapshot().get("gainActive").equals(true));
    VoskLabState.audio(gain,pcm(3276),2); VoskLabState.stop("user_stop",false);
    VoskLabState.audio(gain,pcm(32767),2); check(VoskLabState.snapshot().get("audioLevel").equals(0));
    check(VoskLabState.snapshot().get("audioPeak").equals(67)); check(VoskLabState.snapshot().get("gainActive").equals(false));
    VoskLabState.finish(gain,"");
    long next = VoskLabState.reserve(); check(VoskLabState.enter(next)); check(VoskLabState.listening(next));
    check(VoskLabState.snapshot().get("gainRequested").equals(false)); check(!VoskLabState.gainEnabled(gain));
    VoskLabState.audio(gain,pcm(32767),2); VoskLabState.finish(gain,"stale");
    check(VoskLabState.snapshot().get("audioPeak").equals(0)); check(VoskLabState.busy());
    VoskLabState.audio(next,pcm(32767),2); VoskLabState.captureEnded(gain);
    check(VoskLabState.snapshot().get("audioLevel").equals(100)); // Old cleanup cannot touch the new capture.
    VoskLabState.captureEnded(next);
    check(VoskLabState.snapshot().get("audioLevel").equals(0)); check(VoskLabState.snapshot().get("state").equals("STOPPING"));
    VoskLabState.audio(next,pcm(32767),2); check(VoskLabState.snapshot().get("audioLevel").equals(0));
    VoskLabState.finish(next,"capture_read_failed");
    check(VoskLabState.snapshot().get("audioLevel").equals(0)); check(VoskLabState.snapshot().get("state").equals("ERROR"));
    CountDownLatch gate = new CountDownLatch(1); AtomicInteger won = new AtomicInteger(); Thread[] threads = new Thread[12];
    for (int i=0;i<threads.length;i++) { threads[i]=new Thread(() -> { try { gate.await(); VoskLabState.reserve(); won.incrementAndGet(); } catch (Exception expected) {} }); threads[i].start(); }
    gate.countDown(); for (Thread thread:threads) thread.join(); check(won.get()==1);
    VoskLabState.stop("user_stop", false); VoskLabState.expireCancelledStart(VoskLabState.token()); check(!VoskLabState.busy());
    check(VoskLabState.snapshot().size()==8); System.out.println("PASS real Java state: lifecycle, stale/duplicate callbacks, concurrent ownership, final counts, per-session gain state, RMS bounds/valid length, level and peak resets; no Android stubs");
  }
}
