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
assert.match(workflow, /^on:\s*\r?\n\s{2}workflow_dispatch:\s*\r?\n\s{4}inputs:\s*$/m);
assert.match(workflow, /^\s{6}source_ref:\s*$/m);
assert.match(workflow, /^\s{8}description:\s+Branch or commit SHA to build\s*$/m);
assert.match(workflow, /^\s{8}required:\s+true\s*$/m);
assert.match(workflow, /^\s{8}default:\s+main\s*$/m);
assert.match(workflow, /^\s{8}type:\s+string\s*$/m);
assert.match(workflow, /name:\s+Validate selected source ref/);
assert.match(workflow, /source_ref is required and cannot be empty/);
assert.match(workflow, /name:\s+Checkout selected SafeMeLink source/);
assert.match(workflow, /^\s{10}ref:\s+\$\{\{ inputs\.source_ref \}\}\s*$/m);
assert.match(workflow, /persist-credentials:\s+false/);
assert.match(workflow, /name:\s+Verify checked out source/);
assert.match(workflow, /git rev-parse HEAD/);
assert.match(workflow, /git rev-parse --verify "\$\{SOURCE_REF\}\^\{commit\}"/);
assert.match(workflow, /refs\/remotes\/origin\/\$\{SOURCE_REF\}\^\{commit\}/);
assert.match(workflow, /\[ "\$checked_out_sha" != "\$requested_sha" \]/);
assert.doesNotMatch(workflow, /test\/android-apk/);
assert.match(workflow, /node scripts\/verify-android-test-candidate\.cjs/);
assert.match(workflow, /^jobs:\s*$/m);
assert.match(workflow, /^\s{4}runs-on:\s+ubuntu-24\.04\s*$/m);
assert.equal(
  (workflow.match(/\$\{\{/g) ?? []).length,
  (workflow.match(/\}\}/g) ?? []).length,
  'Espressioni GitHub Actions non bilanciate.',
);
pass('struttura YAML e checkout del source_ref selezionato');

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
assert.ok(
  appConfig.expo.plugins.includes('./plugins/withSOSChannelQueries.cjs'),
  'Plugin Android per i canali fallback SOS mancante.',
);
pass('configurazione Android, Firebase e privacy');

assert.match(packageJson.dependencies.expo, /^~54\./);
assert.equal(packageJson.devDependencies['@expo/cli'], undefined);
assert.match(gitignore, /^\/google-services\.json$/m);
assert.match(gitignore, /^\/android\/app\/google-services\.json$/m);
assert.ok(fs.existsSync(candidateValidatorPath), 'Validatore del candidato test mancante.');
const candidateValidator = fs.readFileSync(candidateValidatorPath, 'utf8');
assert.match(candidateValidator, /Selected index\.tsx candidate is invalid/);
assert.match(candidateValidator, /fs\.statSync\(indexPath\)\.isFile\(\)/);
assert.match(candidateValidator, /Unresolved Git conflict marker detected/);
assert.match(candidateValidator, /Unexpected null byte detected/);
assert.match(candidateValidator, /createHash\('sha256'\)/);
assert.doesNotMatch(candidateValidator, /Expected JSX correction|Obsolete JSX form/);
pass('verifica strutturale del candidato index.tsx selezionato');

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
