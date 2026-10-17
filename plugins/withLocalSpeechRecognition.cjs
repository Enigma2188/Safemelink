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
  if (!updated.includes('// SafeMeLink: session-scoped native callbacks.')) {
    const replaceOnce = (anchor, replacement) => {
      if (updated.split(anchor).length !== 2) throw new Error('Speech session API changed: review native callback isolation before building.');
      updated = updated.replace(anchor, replacement);
    };
    replaceOnce('private val mainHandler = Handler(Looper.getMainLooper())', `private val mainHandler = Handler(Looper.getMainLooper())
    // SafeMeLink: session-scoped native callbacks.
    private val listenerEpoch = java.util.concurrent.atomic.AtomicLong(0)
    private val originalSendEvent = sendEvent`);
    replaceOnce('fun start(options: SpeechRecognitionOptions) {\n        this.options = options\n        mainHandler.post {', `fun start(options: SpeechRecognitionOptions) {
        val epoch = listenerEpoch.incrementAndGet()
        val eventGeneration = options.androidIntentOptions?.get("safemelinkGeneration") as? String
        this.options = options
        mainHandler.post {
            if (listenerEpoch.get() != epoch) return@post
            sendEvent = { name, body ->
                originalSendEvent(name, if (eventGeneration == null) body else
                    (body ?: emptyMap<String, Any?>()) + mapOf("safemelinkGeneration" to eventGeneration))
            }`);
    replaceOnce('speech?.setRecognitionListener(this)', 'speech?.setRecognitionListener(sessionListener(epoch))');
    replaceOnce('options.androidIntentOptions?.forEach', 'options.androidIntentOptions?.filterKeys { it != "safemelinkGeneration" }?.forEach');
    replaceOnce('private fun teardownAndEnd(state: RecognitionState = RecognitionState.INACTIVE) {\n        recognitionState = RecognitionState.STOPPING\n        mainHandler.post {', `private fun teardownAndEnd(state: RecognitionState = RecognitionState.INACTIVE) {
        val endingEpoch = listenerEpoch.incrementAndGet()
        val endingEmitter = sendEvent
        recognitionState = RecognitionState.STOPPING
        mainHandler.post {
            if (listenerEpoch.get() != endingEpoch) return@post`);
    replaceOnce('sendEvent("end", null)', 'endingEmitter("end", null)');
    const callbacks = [
      ['onReadyForSpeech', 'params: Bundle?', 'params'],
      ['onBeginningOfSpeech', '', ''], ['onRmsChanged', 'rmsdB: Float', 'rmsdB'],
      ['onBufferReceived', 'buffer: ByteArray?', 'buffer'], ['onEndOfSpeech', '', ''],
      ['onError', 'error: Int', 'error'], ['onResults', 'results: Bundle?', 'results'],
      ['onPartialResults', 'partialResults: Bundle?', 'partialResults'],
      ['onLanguageDetection', 'results: Bundle', 'results'],
      ['onSegmentResults', 'segmentResults: Bundle', 'segmentResults'],
      ['onEndOfSegmentedSession', '', ''], ['onEvent', 'eventType: Int, params: Bundle?', 'eventType, params'],
    ];
    const listener = `private fun sessionListener(epoch: Long): RecognitionListener = object : RecognitionListener {\n` +
      callbacks.map(([name, signature, args]) => `        override fun ${name}(${signature}) {\n            if (listenerEpoch.get() == epoch) this@ExpoSpeechService.${name}(${args})\n        }`).join('\n') + '\n    }\n\n    ';
    replaceOnce('private fun teardownAndEnd(state:', listener + 'private fun teardownAndEnd(state:');
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
