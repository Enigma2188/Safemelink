const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// eslint-disable-next-line no-undef
const root = path.resolve(__dirname, '..');
const workflowPath = path.join(root, '.github', 'workflows', 'android-test-apk.yml');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const pass = (message) => process.stdout.write(`PASS ${message}\n`);

assert.ok(fs.existsSync(workflowPath), 'Workflow Android mancante.');
const workflow = fs.readFileSync(workflowPath, 'utf8');
const appConfig = JSON.parse(read('app.json'));
const packageJson = JSON.parse(read('package.json'));
const gitignore = read('.gitignore');
const candidateValidatorPath = path.join(
  root,
  'scripts',
  'verify-android-test-candidate.cjs',
);

assert.doesNotMatch(workflow, /\t/, 'Il workflow YAML contiene tab non valide.');
assert.match(workflow, /^name:\s+.+$/m);
assert.match(workflow, /^on:\s*\r?\n\s{2}workflow_dispatch:\s*$/m);
assert.doesNotMatch(workflow, /inputs\.source_ref|github\.event\.inputs\.source_ref/);
assert.match(workflow, /name:\s+Checkout SafeMeLink test candidate/);
assert.match(workflow, /^\s{10}ref:\s+test\/android-apk\s*$/m);
assert.match(workflow, /persist-credentials:\s+false/);
assert.match(workflow, /name:\s+Verify checked out source/);
assert.match(workflow, /git rev-parse HEAD/);
assert.match(workflow, /git rev-parse refs\/remotes\/origin\/test\/android-apk/);
assert.match(workflow, /\[ "\$checked_out_sha" != "\$test_branch_sha" \]/);
assert.match(workflow, /node scripts\/verify-android-test-candidate\.cjs/);
assert.match(workflow, /^jobs:\s*$/m);
assert.match(workflow, /^\s{4}runs-on:\s+ubuntu-24\.04\s*$/m);
assert.equal(
  (workflow.match(/\$\{\{/g) ?? []).length,
  (workflow.match(/\}\}/g) ?? []).length,
  'Espressioni GitHub Actions non bilanciate.',
);
pass('struttura YAML e checkout fisso del branch test');

assert.doesNotMatch(workflow, /^\s{2}(push|pull_request|schedule):/m);
assert.doesNotMatch(
  workflow,
  /\b(eas\s+build|git\s+(commit|push)|gh\s+release|expo\s+publish|supabase\s+(deploy|db\s+push|functions\s+deploy))\b/i,
);
assert.match(workflow, /^permissions:\s*\r?\n\s{2}contents:\s+read\s*$/m);
pass('assenza trigger automatici e operazioni remote');

assert.match(workflow, /node-version:\s+20\.20\.1/);
assert.match(workflow, /java-version:\s+"17"/);
assert.match(workflow, /android-actions\/setup-android@v3/);
assert.match(workflow, /platforms;android-36/);
assert.match(workflow, /build-tools;36\.0\.0/);
assert.match(workflow, /ndk;27\.1\.12297006/);
assert.match(workflow, /npm ci/);
assert.match(workflow, /npx expo prebuild --platform android --clean --no-install/);
assert.match(workflow, /node scripts\/validate-generated-android\.cjs/);
assert.match(workflow, /\.\/gradlew :app:assembleRelease/);
assert.doesNotMatch(workflow, /\beas\b/i);
pass('toolchain e strategia prebuild/Gradle');

for (const secretName of [
  'ANDROID_GOOGLE_SERVICES_JSON_BASE64',
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
]) {
  assert.match(workflow, new RegExp(`secrets\\.${secretName}`));
}
assert.match(workflow, /base64 --decode > google-services\.json/);
assert.doesNotMatch(workflow, /AIza[0-9A-Za-z_-]{20,}/);
assert.doesNotMatch(workflow, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
pass('secret Firebase/Supabase senza credenziali hardcoded');

assert.match(workflow, /actions\/upload-artifact@v4/);
assert.match(workflow, /artifacts\/safemelink-test\.apk/);
assert.match(workflow, /safemelink-android-test-apk/);
assert.match(workflow, /if:\s+always\(\)/);
assert.match(workflow, /expo-prebuild\.log/);
assert.match(workflow, /gradle-build\.log/);

const uploadArtifactBlocks = [
  ...workflow.matchAll(
    /uses:\s+actions\/upload-artifact@v4\s*\r?\n\s+with:\s*\r?\n([\s\S]*?)(?=\r?\n\s{6}- name:|\s*$)/g,
  ),
].map((match) => match[1]);
assert.equal(uploadArtifactBlocks.length, 2, 'Sono attesi esattamente due upload artifact.');
for (const uploadBlock of uploadArtifactBlocks) {
  assert.doesNotMatch(uploadBlock, /google-services\.json|(^|\/)\.env(?:\.|$)/im);
}
assert.match(workflow, /rm -f google-services\.json android\/app\/google-services\.json/);
pass('artifact APK e log diagnostici');

assert.equal(appConfig.expo.android.package, 'com.tiziano.safemelink');
assert.equal(appConfig.expo.android.allowBackup, false);
assert.equal(appConfig.expo.android.googleServicesFile, './google-services.json');
for (const permission of [
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.SYSTEM_ALERT_WINDOW',
]) {
  assert.ok(appConfig.expo.android.blockedPermissions.includes(permission));
}
assert.ok(appConfig.expo.plugins.includes('expo-notifications'));
pass('configurazione Android, Firebase e privacy');

assert.match(packageJson.dependencies.expo, /^~54\./);
assert.equal(packageJson.devDependencies['@expo/cli'], undefined);
assert.match(gitignore, /^\/google-services\.json$/m);
assert.match(gitignore, /^\/android\/app\/google-services\.json$/m);
assert.ok(fs.existsSync(candidateValidatorPath), 'Validatore del candidato test mancante.');
const candidateValidator = fs.readFileSync(candidateValidatorPath, 'utf8');
assert.match(candidateValidator, /completeSOS/);
assert.match(candidateValidator, /dependencies\.includes\('contacts'\)/);
assert.match(candidateValidator, /dependencies\.includes\('userId'\)/);
assert.match(candidateValidator, /Wrong index\.tsx version checked out/);
assert.match(candidateValidator, /Obsolete JSX form detected/);
pass('verifica strutturale della versione test di index.tsx');

const trackedFiles = execFileSync('git', ['ls-files'], {
  cwd: root,
  encoding: 'utf8',
})
  .split(/\r?\n/)
  .filter(Boolean);
assert.ok(
  trackedFiles.every((file) => !/(^|\/)google-services\.json$/i.test(file)),
  'google-services.json non deve essere tracciato.',
);
pass('CLI Expo coerente e file Firebase non tracciato');

assert.equal(
  path.relative(root, workflowPath),
  path.join('.github', 'workflows', 'android-test-apk.yml'),
);
const incorrectSiblingPath = path.resolve(root, '..', 'backup safemelink.github');
assert.ok(
  !fs.existsSync(incorrectSiblingPath),
  'Trovata una cartella errata esterna al repository: backup safemelink.github',
);
pass('percorso workflow interno al repository');

process.stdout.write('All Android CI validation checks passed.\n');
