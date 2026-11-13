// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // CommonJS tools use Node's directory global; app rules stay unchanged.
    files: ["prototype-web/metro.config.cjs", "scripts/prepare-network-ddl-scoped-validation.cjs", "scripts/prepare-network-ddl-trigger-validation.cjs", "scripts/prepare-network-ddl-validation.cjs", "scripts/prepare-network-social-validation.cjs", "scripts/prepare-network-v2-development-validation.cjs", "scripts/prepare-network-v2-local-validation.cjs", "scripts/start-network-prototype-web.cjs", "scripts/test-network-ddl-scoped-validation.cjs", "scripts/test-network-ddl-trigger-validation.cjs", "scripts/test-network-ddl-validation.cjs", "scripts/test-network-event-backend.cjs", "scripts/test-network-map-controller.cjs", "scripts/test-network-native-map.cjs", "scripts/test-network-prototype.cjs", "scripts/test-network-territorial-backend.cjs", "scripts/test-network-v2-default-acl.cjs"],
    languageOptions: { globals: { __dirname: 'readonly' } },
  },
  {
    ignores: ['dist/*'],
  },
]);
