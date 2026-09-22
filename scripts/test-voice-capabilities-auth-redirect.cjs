const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, modules) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (name) => { assert.ok(modules[name], name); return modules[name]; }, console: { info() {} }, setTimeout, clearTimeout, URL, URLSearchParams });
  return exports;
}
async function run() {
  let general = true, local = true, locales = ['it-IT'], fail = false, queries = 0;
  const platform = { OS: 'android', Version: 33 };
  const voice = load('services/VoiceRecognitionCapabilities.ts', {
    'react-native': { Platform: platform },
    'expo-speech-recognition': { ExpoSpeechRecognitionModule: {
      isRecognitionAvailable: () => general, supportsOnDeviceRecognition: () => local,
      getSupportedLocales: async () => { queries++; if (fail) throw Error('private native error'); return { installedLocales: locales }; },
    } },
  });
  assert.equal(await voice.getVoiceRecognitionReadiness(), 'ready');
  general = false;
  assert.equal(await voice.getVoiceRecognitionReadiness(), 'ready', 'local recognizer independent of generic');
  local = false;
  assert.equal(await voice.getVoiceRecognitionReadiness(), 'recognition_unavailable');
  general = true;
  assert.equal(await voice.getVoiceRecognitionReadiness(), 'on_device_unavailable');
  local = true; platform.Version = 30;
  assert.equal(await voice.getVoiceRecognitionReadiness(), 'android_version_unsupported');
  const before = queries;
  for (const api of [31, 32]) { platform.Version = api; assert.equal(await voice.getVoiceRecognitionReadiness(), 'model_status_unknown'); }
  assert.equal(queries, before);
  platform.Version = 33; locales = [];
  assert.equal(await voice.getVoiceRecognitionReadiness(), 'model_status_unknown');
  locales = ['en-US'];
  assert.equal(await voice.getVoiceRecognitionReadiness(), 'italian_model_missing');
  locales = ['it_IT'];
  assert.equal(await voice.getVoiceRecognitionReadiness(), 'ready');
  locales = ['it'];
  assert.equal(await voice.getVoiceRecognitionReadiness(), 'model_status_unknown');
  fail = true;
  assert.equal(await voice.getVoiceRecognitionReadiness(), 'model_status_unknown');
  const { patchLocalRecognizer } = require('../plugins/withLocalSpeechRecognition.cjs');
  const native = fs.readFileSync('node_modules/expo-speech-recognition/android/src/main/java/expo/modules/speechrecognition/ExpoSpeechService.kt', 'utf8');
  const patched = patchLocalRecognizer(native);
  assert.match(patched, /VERSION_CODES.S && options.requiresOnDeviceRecognition == true/);
  assert.doesNotMatch(patched, /Log\.d\("ExpoSpeechService", message\)/);
  assert.match(patched, /@Suppress\("UNUSED_PARAMETER"\) message: String/);
  assert.equal(patchLocalRecognizer(patched), patched);
  assert.throws(() => patchLocalRecognizer('unexpected source'));
  assert.throws(() => patchLocalRecognizer(native.replace('Log.d("ExpoSpeechService", message)', 'unknownLogger(message)')));
  assert.match(fs.readFileSync('components/VoiceProtectionLifecycle.tsx', 'utf8'), /requiresOnDeviceRecognition: true/);

  let calls = 0, confirmed = true;
  const email = load('backend/auth/EmailConfirmation.ts', {
    '@/backend/supabaseClient': { getSupabaseClient: () => ({ auth: { getUser: async () => { calls++; return { data: { user: { email_confirmed_at: confirmed ? 'confirmed' : null } }, error: null }; } } }) },
  });
  assert.equal(await email.verifyEmailConfirmation(null), 'login_required');
  assert.equal(await email.verifyEmailConfirmation('https://evil.invalid/#access_token=test'), 'invalid');
  assert.equal(calls, 0);
  assert.equal(await email.verifyEmailConfirmation('safemelink://email-confirmed#error=expired'), 'invalid');
  assert.equal(await email.verifyEmailConfirmation('safemelink://email-confirmed'), 'login_required');
  assert.equal(await email.verifyEmailConfirmation('safemelink://email-confirmed#access_token=dummy-test-value'), 'verified');
  confirmed = false;
  assert.equal(await email.verifyEmailConfirmation('safemelink://email-confirmed#access_token=dummy-test-value'), 'invalid');
  const auth = fs.readFileSync('backend/auth/AuthService.ts', 'utf8');
  assert.match(auth, /emailRedirectTo: EMAIL_CONFIRMATION_REDIRECT/);
  assert.doesNotMatch(fs.readFileSync('backend/auth/EmailConfirmation.ts', 'utf8'), /setSession|console\./);
  const layout = fs.readFileSync('app/_layout.tsx', 'utf8');
  assert.ok(layout.indexOf("currentRootSegment === 'email-confirmed'") < layout.indexOf('if (!isComplete)'));
  const confirmationScreen = fs.readFileSync('app/email-confirmed.tsx', 'utf8');
  assert.match(confirmationScreen, /ScrollView contentContainerStyle/);
  assert.match(confirmationScreen, /flexGrow: 1/);
  console.log('PASS voice capability matrix, local-only native API selection, sanitized diagnostics and email confirmation redirect');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
