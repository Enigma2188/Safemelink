const { withAndroidManifest } = require('@expo/config-plugins');

// Android 11+ visibility for canOpenURL(tel:). No CALL_PHONE permission.
module.exports = config => withAndroidManifest(config, result => {
  const manifest = result.modResults.manifest;
  manifest.queries ??= [{}];
  manifest.queries[0].intent ??= [];
  const intents = manifest.queries[0].intent;
  if (!intents.some(intent => intent.action?.some(action => action.$?.['android:name'] === 'android.intent.action.VIEW') &&
    intent.data?.some(data => data.$?.['android:scheme'] === 'tel'))) {
    intents.push({ action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }], data: [{ $: { 'android:scheme': 'tel' } }] });
  }
  return result;
});
