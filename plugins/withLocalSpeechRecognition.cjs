const fs = require('node:fs');
const path = require('node:path');
const { withDangerousMod } = require('@expo/config-plugins');

// expo-speech-recognition 3.1.3 selects the generic recognizer on API 31/32,
// despite Android exposing createOnDeviceSpeechRecognizer since API 31.
const before = 'Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && options.requiresOnDeviceRecognition == true -> {';
const after = 'Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && options.requiresOnDeviceRecognition == true -> {';
function patchLocalRecognizer(source) {
  let updated = source;
  if (!(updated.includes(after) && !updated.includes(before))) {
    if (updated.split(before).length !== 2) throw new Error('Speech recognizer source changed: review local-only Android selection before building.');
    updated = updated.replace(before, after);
  }
  // The upstream helper logs transcripts and contextualStrings (our passphrase).
  // Keep app diagnostics, but never forward these native debug message values.
  const privateLogger = 'private fun log(@Suppress("UNUSED_PARAMETER") message: String) {\n        // SafeMeLink: speech content must never enter Android logs.\n    }';
  if (!updated.includes(privateLogger)) {
    const logger = /private fun log\(message: String\) \{\s*Log\.d\("ExpoSpeechService", message\)\s*\}/g;
    if ([...updated.matchAll(logger)].length !== 1) throw new Error('Speech logger changed: review transcript privacy before building.');
    updated = updated.replace(logger, privateLogger);
  }
  return updated;
}
module.exports = function withLocalSpeechRecognition(config) {
  return withDangerousMod(config, ['android', async (mod) => {
    const packagePath = require.resolve('expo-speech-recognition/package.json', { paths: [mod.modRequest.projectRoot] });
    const file = path.join(path.dirname(packagePath), 'android/src/main/java/expo/modules/speechrecognition/ExpoSpeechService.kt');
    const source = fs.readFileSync(file, 'utf8');
    const updated = patchLocalRecognizer(source);
    if (updated !== source) fs.writeFileSync(file, updated);
    return mod;
  }]);
};
module.exports.patchLocalRecognizer = patchLocalRecognizer;
