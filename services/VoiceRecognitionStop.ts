import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

// abort() queues Android teardown; do not start a replacement while it is stopping.
// This bounded check runs only during a transition, never as background polling.
export async function stopVoiceRecognition(): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  try {
    ExpoSpeechRecognitionModule.abort();
    const stopped = async () => {
      while (!expired) {
        const state = await ExpoSpeechRecognitionModule.getStateAsync();
        if (expired) return false;
        if (state === 'inactive') return true;
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
      return false;
    };
    return await Promise.race([
      stopped(),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => { expired = true; resolve(false); }, 2_000);
      }),
    ]);
  } catch {
    return false;
  } finally {
    expired = true;
    clearTimeout(timeout);
  }
}
