import com.tiziano.safemelink.sms.SmsSentAccumulator;
import java.util.concurrent.atomic.AtomicInteger;

public final class SmsSentAccumulatorTest {
  static void check(boolean ok) { if (!ok) throw new AssertionError("SMS accumulator regression"); }
  public static void main(String[] args) throws Exception {
    SmsSentAccumulator a = new SmsSentAccumulator(2);
    check(a.accept(1, true)); check(a.completeIfReady() == null);
    check(!a.accept(1, false)); check(!a.accept(4, true));
    check(a.accept(0, true)); check("sent".equals(a.completeIfReady()));
    check(!a.accept(0, false)); check(!a.expire()); check(a.completeIfReady() == null);
    SmsSentAccumulator failed = new SmsSentAccumulator(2);
    failed.accept(0, false); failed.accept(1, true);
    check("failed".equals(failed.completeIfReady()));
    SmsSentAccumulator timeout = new SmsSentAccumulator(2);
    timeout.accept(0, true); check(timeout.expire()); check(!timeout.accept(1, true));
    check(timeout.completeIfReady() == null); check(!timeout.expire());
    for (int i = 0; i < 100; i++) {
      SmsSentAccumulator concurrent = new SmsSentAccumulator(1);
      concurrent.accept(0, true);
      AtomicInteger terminal = new AtomicInteger();
      Thread callback = new Thread(() -> { if (concurrent.completeIfReady() != null) terminal.incrementAndGet(); });
      Thread expiration = new Thread(() -> { if (concurrent.expire()) terminal.incrementAndGet(); });
      callback.start(); expiration.start(); callback.join(); expiration.join();
      check(terminal.get() == 1);
    }
    System.out.println("PASS real Java SMS accumulator: multipart, duplicate/out-of-order callbacks, late callbacks, timeout and concurrent single settlement; no Android APIs or SMS invoked");
  }
}
