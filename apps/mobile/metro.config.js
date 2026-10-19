const { getDefaultConfig } = require('expo/metro-config');
// SDK 58 detects the pnpm workspace. Keep one React resolution per mobile bundle.
module.exports = getDefaultConfig(__dirname);
