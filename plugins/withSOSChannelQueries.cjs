const { withAndroidManifest } = require('@expo/config-plugins');

const QUERY_INTENTS = [
  { action: 'android.intent.action.SENDTO', scheme: 'sms' },
  { action: 'android.intent.action.SENDTO', scheme: 'smsto' },
  { action: 'android.intent.action.VIEW', scheme: 'whatsapp' },
];
const WHATSAPP_PACKAGES = ['com.whatsapp', 'com.whatsapp.w4b'];

module.exports = function withSOSChannelQueries(config) {
  return withAndroidManifest(config, (androidConfig) => {
    const manifest = androidConfig.modResults.manifest;
    manifest.queries ??= [{}];
    const queries = manifest.queries[0];
    queries.intent ??= [];
    queries.package ??= [];

    for (const requiredIntent of QUERY_INTENTS) {
      const exists = queries.intent.some(
        (intent) =>
          intent.action?.[0]?.$?.['android:name'] === requiredIntent.action &&
          intent.data?.[0]?.$?.['android:scheme'] === requiredIntent.scheme,
      );
      if (!exists) {
        queries.intent.push({
          action: [{ $: { 'android:name': requiredIntent.action } }],
          data: [{ $: { 'android:scheme': requiredIntent.scheme } }],
        });
      }
    }

    for (const packageName of WHATSAPP_PACKAGES) {
      const exists = queries.package.some(
        (entry) => entry.$?.['android:name'] === packageName,
      );
      if (!exists) {
        queries.package.push({ $: { 'android:name': packageName } });
      }
    }

    return androidConfig;
  });
};
