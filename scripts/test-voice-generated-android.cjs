const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const cli = path.join(path.dirname(require.resolve('expo/package.json')), 'bin/cli');
const result = spawnSync(process.execPath, [cli, 'config', '--type', 'introspect', '--json'], {
  encoding: 'utf8', env: { ...process.env, CI: '1' }, timeout: 60000,
});
assert.equal(result.status, 0, result.stderr);
const config = JSON.parse(result.stdout);
const manifest = config._internal.modResults.android.manifest.manifest;
const permissions = new Set(manifest['uses-permission'].map(item => item.$['android:name']));
for (const permission of ['RECORD_AUDIO', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_MICROPHONE', 'POST_NOTIFICATIONS']) {
  assert.ok(permissions.has(`android.permission.${permission}`), permission);
}
const services = manifest.application[0].service.filter(service =>
  service.$['android:name'] === 'com.asterinet.react.bgactions.RNBackgroundActionsTask');
assert.equal(services.length, 1, 'one shared foreground service declaration');
assert.equal(services[0].$['android:exported'], 'false');
assert.ok(services[0].$['android:foregroundServiceType'].split('|').includes('microphone'));
assert.ok(manifest.queries.some(query => query.intent?.some(intent => intent.action?.some(action =>
  action.$['android:name'] === 'android.speech.RecognitionService'))), 'recognizer discovery must survive Android package visibility');
assert.equal(manifest.application[0].$['android:allowBackup'], 'false', 'account settings and recovery journals are not backed up');
console.log('PASS generated Android configuration: microphone permissions, private service, recognition visibility and disabled backups; introspection only, not APK compilation');
