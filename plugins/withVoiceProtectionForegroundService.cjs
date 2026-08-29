const { withAndroidManifest } = require('@expo/config-plugins');

const SERVICE_NAME = 'com.asterinet.react.bgactions.RNBackgroundActionsTask';
const REQUIRED_PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MICROPHONE',
  'android.permission.RECORD_AUDIO',
  'android.permission.POST_NOTIFICATIONS',
];

module.exports = function withVoiceProtectionForegroundService(config) {
  return withAndroidManifest(config, (androidConfig) => {
    const manifest = androidConfig.modResults.manifest;
    const permissions = manifest['uses-permission'] ?? [];
    const permissionNames = new Set(
      permissions.map((permission) => permission.$?.['android:name']),
    );

    for (const permissionName of REQUIRED_PERMISSIONS) {
      if (!permissionNames.has(permissionName)) {
        permissions.push({
          $: {
            'android:name': permissionName,
          },
        });
      }
    }

    manifest['uses-permission'] = permissions;

    const application = manifest.application?.[0];
    if (!application) {
      throw new Error('AndroidManifest senza application: impossibile configurare Protezione Vocale.');
    }

    application.service ??= [];
    let service = application.service.find(
      (entry) => entry.$?.['android:name'] === SERVICE_NAME,
    );

    if (!service) {
      service = {
        $: {
          'android:name': SERVICE_NAME,
        },
      };
      application.service.push(service);
    }

    service.$ ??= {};
    service.$['android:exported'] = 'false';
    service.$['android:foregroundServiceType'] = 'microphone';

    return androidConfig;
  });
};
