const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

async function run() {
  let user = 'account-A';
  let afterGPS = () => {};
  let writes = 0;
  const modules = {
    '@/backend/auth/AuthService': { AuthService: { getSession: async () => user ? { user: { id: user } } : null } },
    '@/backend/repositories/NetworkRepository': { NetworkRepository: { createReport: async () => { writes++; return { report_id: 'test-report' }; } } },
    '@/services/LocationService': { LocationService: { getCurrentLocation: async () => { afterGPS(); return { latitude: 0, longitude: 0, accuracy: 10 }; } } },
    '@/services/NetworkModels': {},
  };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('services/NetworkService.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require: (name) => { assert.ok(modules[name], name); return modules[name]; } });
  const service = exports.NetworkService;
  await service.createReport('OTHER_SAFETY', 'Descrizione di test');
  assert.equal(writes, 1);
  afterGPS = () => { user = 'account-B'; };
  await assert.rejects(service.createReport('OTHER_SAFETY', 'Descrizione di test'), /Account cambiato/);
  assert.equal(writes, 1);
  user = 'account-A'; afterGPS = () => { user = null; };
  await assert.rejects(service.createReport('OTHER_SAFETY', 'Descrizione di test'), /Account cambiato/);
  assert.equal(writes, 1);
  await assert.rejects(service.createReport('OTHER_SAFETY', 'Descrizione di test'), /Accedi/);
  assert.equal(writes, 1);
  console.log('PASS NETWORK publication rejects logout/account change during GPS acquisition');
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
