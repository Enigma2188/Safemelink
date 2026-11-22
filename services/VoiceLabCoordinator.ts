import { AppState, Platform } from 'react-native';
import { ExpoSpeechRecognitionModule as Speech } from 'expo-speech-recognition';
import { VoskLab } from '@/modules/safemelink-vosk-lab';
import { VoiceProtectionRuntime } from '@/services/VoiceProtectionRuntime';
import { VoiceProtectionService } from '@/services/VoiceProtectionService';
import { VoiceProtectionStorage } from '@/storage/VoiceProtectionStorage';
import type { VoiceLabSnapshot } from '@/modules/safemelink-vosk-lab';
import { SOSStorage } from '@/storage/SOSStorage';
import { VoiceSOSRecovery } from '@/services/VoiceSOSRecovery';

async function bounded<T>(request: Promise<T>, timeoutMs = 5_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([request, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Verifica laboratorio scaduta. Nessuna prova avviata.')), timeoutMs); })]); }
  finally { if (timer) clearTimeout(timer); }
}

export const voiceLabEnabled = () => {
  try { return Platform.OS === 'android' && VoskLab?.enabled() === true; } catch { return false; }
};

type Lease = { owner: symbol; user: string; cancelled: boolean; poll?: ReturnType<typeof setInterval> };
let lease: Lease | null = null;
let lastOwner: string | null = null;
let startGeneration = 0;
let preparing: symbol | null = null;
const off: VoiceLabSnapshot = { state: 'OFF', reason: '', detections: 0, busy: false,
  audioLevel: 0, audioPeak: 0, gainRequested: false, gainActive: false };
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
  startGeneration++;
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
        Number.isInteger(value.audioLevel) && value.audioLevel >= 0 && value.audioLevel <= 100 &&
        Number.isInteger(value.audioPeak) && value.audioPeak >= value.audioLevel && value.audioPeak <= 100 &&
        typeof value.gainRequested === 'boolean' && typeof value.gainActive === 'boolean' &&
        (!value.gainActive || (value.gainRequested && value.busy && ['PREPARING','LISTENING'].includes(value.state))) &&
        (value.state !== 'LISTENING' || (value.busy && (!value.gainRequested || value.gainActive))) &&
        (value.state === 'LISTENING' || value.audioLevel === 0)) return {
          state: value.state, reason: value.reason, detections: value.detections, busy: value.busy,
          audioLevel: value.audioLevel, audioPeak: value.audioPeak,
          gainRequested: value.gainRequested, gainActive: value.gainActive,
        };
  } catch { /* No false listening confirmation. */ }
  return { ...off, state: 'ERROR', reason: 'native_state_unknown' };
}
export function resetVoiceLabCounts() { VoskLab?.reset(); }

export class VoiceLabStartError extends Error {
  constructor(readonly code: 'unavailable' | 'protection_enabled' | 'sos_active' | 'sos_uncertain' | 'microphone_busy' | 'start_cancelled' | 'native_start_failed') {
    const messages = {
      unavailable: 'Laboratorio non disponibile. Apri questa schermata in primo piano.',
      protection_enabled: 'Disattiva prima la Protezione Vocale usando il suo pulsante OFF.',
      sos_active: 'Il server segnala un SOS aperto. Apri Protezione Vocale e usa VERIFICA SOS per visualizzarlo.',
      sos_uncertain: 'Un precedente SOS non è verificato. Apri Protezione Vocale e usa VERIFICA SOS per conoscere il motivo.',
      microphone_busy: 'Il microfono o il servizio di protezione è ancora occupato. Attendi l’arresto e riprova.',
      start_cancelled: 'Avvio annullato: schermata, account o stato della protezione sono cambiati.',
      native_start_failed: 'Il servizio Vosk non ha confermato l’avvio. Controlla lo stato nativo.',
    };
    super(messages[code]); this.name = 'VoiceLabStartError';
  }
}

export async function startVoiceLab(userId: string, phrase: string, isCurrent: () => boolean, automaticGain = false): Promise<void> {
  if (!voiceLabEnabled() || !VoskLab || AppState.currentState !== 'active' || !isCurrent()) {
    throw new VoiceLabStartError('unavailable');
  }
  if (preparing || lease) throw new VoiceLabStartError('microphone_busy');
  const token = Symbol('preflight'); preparing = token;
  const revision = ++startGeneration;
  const native = VoskLab;
  let value: Lease | null = null;
  const current = () => revision === startGeneration && isCurrent() && AppState.currentState === 'active';
  const requireCurrent = () => { if (!current()) throw new VoiceLabStartError('start_cancelled'); };
  try {
    const settings = await bounded(VoiceProtectionStorage.get(userId));
    requireCurrent();
    if (settings.enabled) throw new VoiceLabStartError('protection_enabled');
    // Reconcile a stale journal BEFORE reserving the mic. An active or uncertain
    // SOS still blocks; only verified terminal references may release suspension.
    const events = await bounded(SOSStorage.listEvents(userId));
    requireCurrent();
    const recovery = await bounded(VoiceSOSRecovery.inspect(userId, events), 12_000);
    requireCurrent();
    if (recovery.kind !== 'clear') throw new VoiceLabStartError(recovery.kind === 'active' ? 'sos_active' : 'sos_uncertain');
    if (!await bounded(VoiceProtectionRuntime.clearVerifiedSuspension(userId, recovery.attemptId, recovery.attempt))) throw new VoiceLabStartError('sos_uncertain');
    requireCurrent();
    const recognition = await bounded(Speech.getStateAsync());
    const latestSettings = await bounded(VoiceProtectionStorage.get(userId));
    requireCurrent();
    if (latestSettings.enabled) throw new VoiceLabStartError('protection_enabled');
    if (recognition !== 'inactive' || !VoiceProtectionService.canOpenVoiceLab() || native.busy()) {
      throw new VoiceLabStartError('microphone_busy');
    }
    // The final reservation and native start are synchronous. A production start
    // or a new SOS during preflight is vetoed by the runtime at this boundary.
    const owner = VoiceProtectionRuntime.reserveMicrophoneForLab();
    if (!owner) throw new VoiceLabStartError('microphone_busy');
    value = { owner, user: userId, cancelled: false }; lease = value; lastOwner = userId;
    native.start(phrase, automaticGain === true);
    if (!native.busy()) throw new VoiceLabStartError('native_start_failed');
    drain(value);
  } finally {
    if (preparing === token) preparing = null;
    if (value) drain(value);
  }
}
