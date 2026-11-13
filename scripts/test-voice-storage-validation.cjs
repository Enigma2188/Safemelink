const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
let stored = null;
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('storage/VoiceProtectionStorage.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  exports: exportsObject,
  require(name) {
    if (name === '@react-native-async-storage/async-storage') return { default: {
      getItem: async key => { assert.equal(key, 'A:voice-protection'); return stored; },
      setItem: async (_key, value) => { stored = value; },
    } };
    if (name === '@/storage/AccountScopedStorage') return { getAccountStorageKey: (user, key) => `${user}:${key}` };
    throw new Error(name);
  }, Date,
});
const api = exportsObject.VoiceProtectionStorage;
const valid = { enabled: true, enabledAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(), durationMinutes: 60, passphrase: 'synthetic phrase' };
(async () => {
  for (const input of [null, 'broken json', 'null', '[]', 'true', '42']) {
    stored = input; const result = await api.get('A'); assert.equal(result.enabled, false); assert.equal(typeof result.passphrase, 'string');
  }
  for (const change of [{ enabled: 'true' }, { passphrase: {} }, { passphrase: null }, { passphrase: '' }, { expiresAt: 'invalid' }, { expiresAt: null }, { expiresAt: undefined }, { durationMinutes: -1 }, { durationMinutes: '60' }]) {
    stored = JSON.stringify({ ...valid, ...change }); const result = await api.get('A');
    assert.equal(result.enabled, false, JSON.stringify(change));
    assert.equal(stored, JSON.stringify({ ...valid, ...change }), 'reading must not rewrite persisted settings');
  }
  for (const settings of [valid, { ...valid, durationMinutes: 0, expiresAt: null }]) {
    await api.save('A', settings); const read = await api.get('A');
    assert.equal(JSON.stringify(read), JSON.stringify(settings));
  }
  stored = null; const first = await api.get('A'); first.enabled = true;
  assert.equal((await api.get('A')).enabled, false, 'defaults cannot leak mutations into other reads');
  console.log('PASS voice storage: malformed data fails closed, valid timed/manual authorization survives, reads preserve storage and defaults are isolated');
})().catch(error => { console.error(error); process.exitCode = 1; });
