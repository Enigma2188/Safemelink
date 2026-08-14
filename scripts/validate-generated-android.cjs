const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// eslint-disable-next-line no-undef
const root = path.resolve(__dirname, '..');
const manifestPath = path.join(
  root,
  'android',
  'app',
  'src',
  'main',
  'AndroidManifest.xml',
);
const buildGradlePath = path.join(root, 'android', 'app', 'build.gradle');
const googleServicesPath = path.join(root, 'android', 'app', 'google-services.json');
const gradleWrapperPath = path.join(root, 'android', 'gradlew');

for (const requiredPath of [
  manifestPath,
  buildGradlePath,
  googleServicesPath,
  gradleWrapperPath,
]) {
  assert.ok(fs.existsSync(requiredPath), `File Android generato mancante: ${requiredPath}`);
}

const manifest = fs.readFileSync(manifestPath, 'utf8');
const buildGradle = fs.readFileSync(buildGradlePath, 'utf8');
const googleServices = JSON.parse(fs.readFileSync(googleServicesPath, 'utf8'));

assert.match(
  manifest,
  /<application\b[^>]*\bandroid:allowBackup="false"/s,
  'android:allowBackup deve essere false.',
);
assert.match(
  buildGradle,
  /\b(namespace|applicationId)\s+["']com\.tiziano\.safemelink["']/,
  'Package Android SafeMeLink non trovato nel build.gradle generato.',
);

for (const permission of [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MICROPHONE',
  'android.permission.RECORD_AUDIO',
]) {
  assert.match(
    manifest,
    new RegExp(
      `<uses-permission\\b[^>]*android:name=["']${permission.replaceAll('.', '\\.')}["'][^>]*>`,
    ),
    `Permesso Protezione Vocale mancante: ${permission}.`,
  );
}

assert.match(
  manifest,
  /<service\b[^>]*android:name=["']com\.asterinet\.react\.bgactions\.RNBackgroundActionsTask["'][^>]*android:foregroundServiceType=["']microphone["'][^>]*>/,
  'Il foreground service Protezione Vocale deve dichiarare il tipo microphone.',
);

for (const scheme of ['sms', 'smsto', 'whatsapp']) {
  assert.match(
    manifest,
    new RegExp(`<data\\b[^>]*android:scheme=["']${scheme}["'][^>]*>`),
    `Query Android per il canale SOS ${scheme} mancante.`,
  );
}

for (const packageName of ['com.whatsapp', 'com.whatsapp.w4b']) {
  assert.match(
    manifest,
    new RegExp(`<package\\b[^>]*android:name=["']${packageName.replaceAll('.', '\\.')}["'][^>]*>`),
    `Package visibility Android mancante: ${packageName}.`,
  );
}

for (const permission of [
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.SYSTEM_ALERT_WINDOW',
]) {
  const permissionTagPattern = new RegExp(
    `<uses-permission\\b[^>]*android:name=["']${permission.replaceAll('.', '\\.')}["'][^>]*>`,
    'g',
  );
  const permissionTags = manifest.match(permissionTagPattern) ?? [];

  for (const permissionTag of permissionTags) {
    assert.match(
      permissionTag,
      /\btools:node=["']remove["']/,
      `${permission} è presente senza tools:node="remove".`,
    );
  }
}

const hasSafeMeLinkFirebaseClient = googleServices.client?.some(
  (client) =>
    client.client_info?.android_client_info?.package_name ===
    'com.tiziano.safemelink',
);
assert.ok(
  hasSafeMeLinkFirebaseClient,
  'google-services.json non contiene il package Android SafeMeLink.',
);

assert.match(
  buildGradle,
  /release\s*\{[\s\S]*?signingConfig\s+signingConfigs\.debug[\s\S]*?\}/,
  'La build test release deve usare la firma debug interna.',
);

process.stdout.write('Generated Android project validation passed.\n');
