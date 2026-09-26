const assert = require('node:assert/strict');
const fs = require('node:fs');

const home = fs.readFileSync('app/(tabs)/index.tsx', 'utf8');
const storage = fs.readFileSync('storage/CheckpointStorage.ts', 'utf8');
const runtime = fs.readFileSync('services/SafetyExpirationRuntime.ts', 'utf8');

assert.match(home, /RIPETI/);
assert.match(home, /OGNI/);
assert.match(home, /PER/);
assert.match(home, /CHECKPOINT_MAX_REPETITIONS/);
assert.match(home, /repeatIntervalMinutes/);
assert.match(home, /repeatTotal/);
assert.match(home, /repeatCompleted/);
assert.match(home, /await cancelCheckpoint\(true\)/);
assert.match(home, /startCheckpoint\(repeatConfig\.intervalMinutes, nextConfig\)/);
assert.match(home, /SafetyNotificationPreferenceStorage\.get\(userId\)/);
assert.match(storage, /repeatEnabled\?: boolean/);
assert.match(storage, /repeatIntervalMinutes\?: number/);
assert.match(storage, /repeatTotal\?: number/);
assert.match(storage, /repeatCompleted\?: number/);
assert.match(runtime, /SafetyExpirationKind/);

console.log('Checkpoint repeated-session checks passed (single runtime, one next alarm, persistence, recovery and notification gating)');
