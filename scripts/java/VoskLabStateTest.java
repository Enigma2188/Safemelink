package com.tiziano.safemelink.vosklab;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.atomic.AtomicInteger;
public final class VoskLabStateTest {
  private static void check(boolean yes) { if (!yes) throw new AssertionError(); }
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
    CountDownLatch gate = new CountDownLatch(1); AtomicInteger won = new AtomicInteger(); Thread[] threads = new Thread[12];
    for (int i=0;i<threads.length;i++) { threads[i]=new Thread(() -> { try { gate.await(); VoskLabState.reserve(); won.incrementAndGet(); } catch (Exception expected) {} }); threads[i].start(); }
    gate.countDown(); for (Thread thread:threads) thread.join(); check(won.get()==1);
    VoskLabState.stop("user_stop", false); VoskLabState.expireCancelledStart(VoskLabState.token()); check(!VoskLabState.busy());
    check(VoskLabState.snapshot().size()==4); System.out.println("PASS real Java state: lifecycle, stop-during-start, stale/duplicate callbacks, concurrent ownership, counters and final word boundaries; no Android stubs");
  }
}
