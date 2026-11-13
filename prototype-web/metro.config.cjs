// Only the isolated preview uses this configuration. Native/root config is untouched.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
const workspace = path.resolve(__dirname, '..');
config.watchFolders = [workspace];
config.resolver.nodeModulesPaths = [path.join(workspace, 'node_modules')];
module.exports = config;
