const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync('components/KeyboardSafeForm.tsx', 'utf8');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText, {
  exports: exportsObject,
  require: (name) => name === 'react' ? { createContext: () => ({}) } : {},
});
const delta = exportsObject.keyboardScrollDelta;
assert.equal(delta(100, 48, 50, 400, 450), 0, 'visible field must not jump');
assert.equal(delta(420, 48, 50, 400, 450), 34, 'last field clears keyboard by 16');
assert.equal(delta(600, 80, 50, 700, 450), 246, 'unresized viewport uses keyboard boundary');
assert.equal(delta(420, 48, 50, 300, 450), 134, 'resized viewport uses its actual bottom');
assert.equal(delta(40, 48, 50, 400, 450), -26, 'field above viewport is brought back');
assert.match(source, /minHeight: viewportHeight \+ keyboardHeight \+ CLEARANCE/);
assert.match(source, /paddingBottom: keyboardHeight \+ CLEARANCE/);
assert.match(source, /Keyboard\.metrics\(\)/);
assert.match(source, /show\.remove\(\)/);
assert.match(source, /hide\.remove\(\)/);
assert.match(source, /cancelAnimationFrame/);
assert.doesNotMatch(source, /setInterval|setTimeout/);
for (const path of [
  'screens/NetworkScreen.tsx',
  'screens/NeighborhoodNetworkScreen.tsx',
  'screens/EmergencyProfileScreen.tsx',
  'screens/TrustedContactsScreen.tsx',
  'app/voice-protection.tsx',
]) {
  const screen = fs.readFileSync(path, 'utf8');
  assert.match(screen, /KeyboardSafeScrollView as ScrollView, KeyboardSafeTextInput as TextInput/, `${path}: inputs must use focus-aware scroll`);
  assert.match(screen, /<KeyboardAvoidingView/, `${path}: keyboard-avoiding container required`);
  assert.match(screen, /keyboardShouldPersistTaps="handled"/, `${path}: action taps must work with keyboard open`);
  assert.match(screen, /automaticallyAdjustKeyboardInsets=\{Platform\.OS === 'ios'\}/, `${path}: iOS keyboard insets required`);
}
const login = fs.readFileSync('app/login.tsx', 'utf8');
const accountPanel = fs.readFileSync('components/AccountAccessPanel.tsx', 'utf8');
const appConfig = JSON.parse(fs.readFileSync('app.json', 'utf8'));
assert.match(login, /KeyboardSafeScrollView as ScrollView/);
assert.match(login, /<KeyboardAvoidingView/);
assert.match(login, /<AccountAccessPanel/);
assert.match(accountPanel, /KeyboardSafeTextInput as TextInput/);
assert.equal(appConfig.expo.android.softwareKeyboardLayoutMode, 'resize');
const network = fs.readFileSync('screens/NetworkScreen.tsx', 'utf8');
assert.match(network, /<TextInput[\s\S]*?multiline[\s\S]*?<PrimaryButton[^>]*label=\{busy \? 'PUBBLICAZIONE…' : 'PUBBLICA'\}/);
console.log('PASS keyboard form geometry: visible, first/last, resized/unresized viewport, dynamic short-form space and cleanup contracts');
console.log('PASS keyboard screen coverage: NETWORK, neighborhood, emergency, trusted contacts, voice, login/signup, Android resize');
