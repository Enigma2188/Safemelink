import { AppState, Platform } from 'react-native';
import { ExpoSpeechRecognitionModule as Speech } from 'expo-speech-recognition';
import { VoskLab } from '@/modules/safemelink-vosk-lab';
import { VoiceProtectionRuntime } from '@/services/VoiceProtectionRuntime';
import { VoiceProtectionService } from '@/services/VoiceProtectionService';
import { VoiceProtectionStorage } from '@/storage/VoiceProtectionStorage';
import type { VoiceLabSnapshot } from '@/modules/safemelink-vosk-lab';
import { SOSStorage } from '@/storage/SOSStorage';
import { VoiceSOSRecoveryStorage } from '@/storage/VoiceSOSRecoveryStorage';

async function bounded<T>(request: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([request, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Verifica laboratorio scaduta. Nessuna prova avviata.')), 5_000); })]); }
  finally { if (timer) clearTimeout(timer); }
}

export const voiceLabEnabled = () => {
  try { return Platform.OS === 'android' && VoskLab?.enabled() === true; } catch { return false; }
};

type Lease = { owner: symbol; user: string; cancelled: boolean; poll?: ReturnType<typeof setInterval> };
let lease: Lease | null = null;
let lastOwner: string | null = null;
const off: VoiceLabSnapshot = { state: 'OFF', reason: '', detections: 0, busy: false };
function release(value: Lease) {
  if (value.poll) clearInterval(value.poll);
  VoiceProtectionRuntime.releaseMicrophoneForLab(value.owner);
  if (lease === value) lease = null;
}
function drain(value: Lease) {
  try { if (!VoskLab?.busy()) { release(value); return; } } catch { /* Unknown keeps the lease. */ }
  if (!value.poll) value.poll = setInterval(() => {
    try { if (!VoskLab?.busy()) release(value); } catch { /* Fail closed. */ }
  }, 500);
}
export function stopVoiceLab(forget = false) {
  if (lease) lease.cancelled = true;
  try { VoskLab?.stop(forget); } finally { if (lease) drain(lease); }
  if (forget) lastOwner = null;
}
VoiceProtectionRuntime.setLabSafetyStop?.(() => stopVoiceLab(true));

export function readVoiceLab(user: string | null): VoiceLabSnapshot {
  if (!user || lastOwner !== user) {
    try { if (VoskLab?.busy()) stopVoiceLab(true); } catch { /* Never show another account's state. */ }
    return off;
  }
  try {
    const value = VoskLab?.snapshot();
    if (value && ['OFF','PREPARING','LISTENING','STOPPING','ERROR'].includes(value.state) &&
        Number.isSafeInteger(value.detections) && value.detections >= 0 && typeof value.busy === 'boolean' &&
        typeof value.reason === 'string' && /^[a-z_]*$/.test(value.reason) &&
        (value.state !== 'LISTENING' || value.busy)) return { state: value.state, reason: value.reason, detections: value.detections, busy: value.busy };
  } catch { /* No false listening confirmation. */ }
  return { ...off, state: 'ERROR', reason: 'native_state_unknown' };
}
export function resetVoiceLabCounts() { VoskLab?.reset(); }

export async function startVoiceLab(userId: string, phrase: string, isCurrent: () => boolean): Promise<void> {
  if (!voiceLabEnabled() || !VoskLab || AppState.currentState !== 'active' || !isCurrent()) {
    throw new Error('Laboratorio non disponibile.');
  }
  const native = VoskLab;
  const owner = VoiceProtectionRuntime.reserveMicrophoneForLab();
  if (!owner) throw new Error('Ferma la protezione e chiudi eventuali emergenze prima della prova.');
  const value: Lease = { owner, user: userId, cancelled: false }; lease = value; lastOwner = userId;
  const current = () => lease === value && !value.cancelled && isCurrent() && AppState.currentState === 'active';
  try {
    // Reserve before awaits: queued production starts must observe the reservation.
    const settings = await bounded(VoiceProtectionStorage.get(userId));
    if (settings.enabled || !current()) throw new Error('Disattiva prima la Protezione Vocale.');
    const [events, journal] = await bounded(Promise.all([SOSStorage.listEvents(userId), VoiceSOSRecoveryStorage.get(userId)]));
    if (!current() || journal || events.some(event => event.isActive || ['open', 'accepted'].includes(event.remoteStatus ?? ''))) {
      throw new Error('Emergenza presente o non verificata. Laboratorio non avviato.');
    }
    const recognition = await bounded(Speech.getStateAsync());
    if (recognition !== 'inactive' || !current() ||
        !VoiceProtectionService.canOpenVoiceLab() || native.busy()) {
      throw new Error('Microfono o servizio di sicurezza occupato. Attendi e riprova.');
    }
    native.start(phrase); // Only an explicit foreground user action reaches this call.
    if (!native.busy()) throw new Error('Laboratorio non avviato.');
    drain(value); // Lease maintenance only; recognition never relies on JS timers.
  } finally {
    drain(value);
  }
}
