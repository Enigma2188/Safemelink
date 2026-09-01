const { withGradleProperties } = require('@expo/config-plugins');

const COMPILE_SDK_PROPERTY = 'android.compileSdkVersion';
const COMPILE_SDK_VERSION = '36';

module.exports = function withAndroidCompileSdk(config) {
  return withGradleProperties(config, (androidConfig) => {
    androidConfig.modResults = androidConfig.modResults.filter(
      (entry) => entry.key !== COMPILE_SDK_PROPERTY,
    );
    androidConfig.modResults.push({
      type: 'property',
      key: COMPILE_SDK_PROPERTY,
      value: COMPILE_SDK_VERSION,
    });

    return androidConfig;
  });
};
