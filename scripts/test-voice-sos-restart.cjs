const fs = require('fs');
const path = require('path');

const root = path.resolve(process.cwd());
const lifecycle = fs.readFileSync(path.join(root, 'components/VoiceProtectionLifecycle.tsx'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'services/VoiceProtectionRuntime.ts'), 'utf8');

const checks = [
  ['execution stops recognition', lifecycle.includes('onSOSExecutionStarted') && lifecycle.includes('stopRecognition();')],
  ['real SOS close recovery listener', lifecycle.includes('onSOSClosed') && lifecycle.includes('recoverAfterSOS') && runtime.includes('notifySOSClosed')],
  ['failure recovery listener', lifecycle.includes('onSOSFailed') && lifecycle.includes('recoverAfterSOS')],
  ['bounded recovery delay', lifecycle.includes('}, 1_500);')],
  ['native start confirmation remains required', lifecycle.includes('notifyRecognitionStarted') && runtime.includes('waitForRecognitionStart')],
  ['single SOS request lock remains present', runtime.includes('sosRequestLockedUntil') && runtime.includes('sosRequestedForSessionRef') === false],
  ['recovery timer cleanup', lifecycle.includes('clearPostSOSRecoveryTimer();')],
];

const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
  console.error(`Voice SOS restart checks failed: ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`Voice SOS restart checks passed (${checks.length})`);
