'use strict';
/* global __dirname, __filename */
// Existing pattern: compile the actual TS modules, exercise exports with synthetic data.
// No network, GPS, native modules, fixtures on disk or app services are invoked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const registryFile = path.join(root, 'services/NetworkCategoryRegistryV2.ts');
const contractFile = path.join(root, 'services/NetworkMapContractV2.ts');
function load(file, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, { exports, Object, Reflect, Array, Date, Number,
    require: name => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; } }, { filename: file });
  return exports;
}
const registry = load(registryFile);
const contract = load(contractFile, { './NetworkCategoryRegistryV2': registry });
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const clone = value => JSON.parse(JSON.stringify(value));
const operational = () => ({ schemaVersion: 2, publicId: id(1), territoryId: id(2), zoneId: id(3),
  kind: 'OPERATIONAL_EVENT', categoryId: 'LIGHTING', status: 'ACTIVE', locationPolicyVersion: 'synthetic-policy',
  revision: 1, validUntil: '2026-11-04T12:00:00.000Z',
  publicPosition: { latitude: 0, longitude: 0, generalizationMeters: 1000, representation: 'GENERALIZED_EVENT_POINT' },
  createdAt: '2026-11-01T12:00:00.000Z', updatedAt: '2026-11-02T12:00:00.000Z', resolvedAt: null });
const historical = () => {
  const { createdAt, updatedAt, resolvedAt, ...base } = operational();
  return { ...base, kind: 'REVIEWED_HISTORY', status: 'CONCLUDED',
    publicPosition: { ...base.publicPosition, representation: 'ZONE_REPRESENTATIVE_POINT' },
    period: { startMonth: '2026-09-01', endMonthExclusive: '2026-10-01' } };
};
const detail = () => ({ marker: operational(), description: 'Descrizione sintetica del problema', authorNickname: 'Nickname sintetico',
  confirmations: { confirmedCount: 1, noLongerPresentCount: 0, myConfirmation: null },
  updates: [{ publicId: id(4), body: 'Aggiornamento sintetico', createdAt: '2026-11-02T12:00:00.000Z', authorRole: 'AUTHOR' }] });
let passed = 0;
function test(name, run) { run(); passed++; console.log(`PASS ${name}`); }

test('official five category IDs, Italian labels, semantic icons and frozen registry', () => {
  const expected = ['CIVIC_SAFETY', 'ROADS_TRAFFIC', 'LIGHTING', 'ENVIRONMENT_DECORUM', 'COMMUNITY_INFORMATION'];
  assert.deepEqual(Array.from(registry.NETWORK_CATEGORY_IDS_V2), expected);
  assert.deepEqual(Object.keys(registry.NETWORK_CATEGORY_REGISTRY_V2), expected);
  assert.deepEqual(expected.map(k => registry.NETWORK_CATEGORY_REGISTRY_V2[k].iconId), ['shield', 'road', 'lightbulb', 'leaf', 'information']);
  assert.deepEqual(expected.map(k => registry.NETWORK_CATEGORY_REGISTRY_V2[k].label),
    ['Sicurezza', 'Strade e viabilità', 'Illuminazione', 'Ambiente e decoro', 'Servizi pubblici']);
  for (const value of [null, '', 'URBAN_HAZARD', 'toString', '__proto__']) assert.equal(registry.isNetworkCategoryIdV2(value), false);
  assert.ok(Object.isFrozen(registry.NETWORK_CATEGORY_REGISTRY_V2));
  for (const category of expected) { assert.equal(registry.isNetworkCategoryIdV2(category), true); assert.ok(Object.isFrozen(registry.NETWORK_CATEGORY_REGISTRY_V2[category])); }
});

test('category accents/navy foreground have numeric contrast >= 4.5:1', () => {
  const luminance = hex => hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  for (const item of Object.values(registry.NETWORK_CATEGORY_REGISTRY_V2)) {
    const a = luminance(item.color), b = luminance(item.iconForeground);
    assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5, item.label);
  }
});

test('operational/history discriminators, lifecycle and public representations', () => {
  assert.equal(contract.isNetworkMarkerV2(operational()), true);
  assert.equal(contract.isNetworkMarkerV2(historical()), true);
  const resolved = { ...operational(), status: 'RESOLVED', resolvedAt: '2026-11-02T12:00:00.000Z' };
  assert.equal(contract.isNetworkMarkerV2(resolved), true);
  for (const mutate of [v => { v.status = 'CONCLUDED'; }, v => { v.kind = 'REVIEWED_HISTORY'; },
    v => { v.resolvedAt = resolved.resolvedAt; }, v => { v.publicPosition.representation = 'ZONE_REPRESENTATIVE_POINT'; }]) {
    const value = operational(); mutate(value); assert.equal(contract.isNetworkMarkerV2(value), false);
  }
  assert.equal(contract.isNetworkMarkerV2({ ...resolved, resolvedAt: '2026-11-03T12:00:00.000Z' }), false);
  assert.equal(contract.isNetworkMarkerV2({ ...historical(), authorNickname: 'Not allowed' }), false);
});

test('essential fields, finite coordinates, date ordering and monthly history', () => {
  for (const key of Object.keys(operational())) {
    const value = operational(); delete value[key]; assert.equal(contract.isNetworkMarkerV2(value), false, key);
  }
  for (const patch of [{ schemaVersion: 1 }, { categoryId: 'URBAN_HAZARD' }, { publicId: 'legacy-id' },
    { revision: 0 }, { revision: 1.5 }, { revision: Infinity }, { locationPolicyVersion: ' ' },
    { validUntil: '2026-02-30T00:00:00.000Z' }, { updatedAt: '2026-10-01T12:00:00.000Z' }])
    assert.equal(contract.isNetworkMarkerV2({ ...operational(), ...patch }), false);
  for (const patch of [{ latitude: NaN }, { longitude: Infinity }, { latitude: 91 }, { longitude: -181 },
    { generalizationMeters: 0 }, { generalizationMeters: -1 }, { generalizationMeters: Infinity }]) {
    const value = operational(); Object.assign(value.publicPosition, patch); assert.equal(contract.isNetworkMarkerV2(value), false);
  }
  for (const period of [{ startMonth: '2026-09-15', endMonthExclusive: '2026-10-01' },
    { startMonth: '2026-10-01', endMonthExclusive: '2026-09-01' }, { startMonth: '2026-13-01', endMonthExclusive: '2027-01-01' }])
    assert.equal(contract.isNetworkMarkerV2({ ...historical(), period }), false);
  // Shape validity deliberately does NOT imply freshness/visibility permission.
  assert.equal(contract.isNetworkMarkerV2({ ...operational(), validUntil: '2020-01-01T00:00:00.000Z' }), true);
});

test('separate details: nickname only operational; allowed author updates and safe counts', () => {
  assert.equal(contract.isNetworkOperationalDetailV2(detail()), true);
  assert.equal(contract.isNetworkHistoryDetailV2({ marker: historical(), summary: 'Sintesi storica revisionata' }), true);
  assert.equal(contract.isNetworkHistoryDetailV2({ marker: historical(), summary: 'Sintesi storica revisionata', authorNickname: 'Not allowed' }), false);
  assert.equal(contract.isNetworkHistoryDetailV2({ marker: operational(), summary: 'Sintesi storica revisionata' }), false);
  assert.equal(contract.isNetworkOperationalDetailV2({ ...detail(), marker: historical() }), false);
  for (const patch of [{ confirmedCount: -1 }, { confirmedCount: 0.5 }, { myConfirmation: 'UNKNOWN' }]) {
    const value = detail(); Object.assign(value.confirmations, patch); assert.equal(contract.isNetworkOperationalDetailV2(value), false);
  }
  const value = detail(); value.updates[0].authorRole = 'PARTICIPANT';
  assert.equal(contract.isNetworkOperationalDetailV2(value), false);
});

test('reject private/extra fields at all public boundaries, without serializing them', () => {
  const forbidden = ['authorUserId', 'accountId', 'sourceReportId', 'phone', 'email', 'authorPosition', 'deviceLocation', 'accuracy'];
  for (const key of forbidden) {
    const marker = operational(); marker[key] = 'private-sentinel';
    assert.equal(contract.isNetworkMarkerV2(marker), false, key);
    const nested = operational(); nested.publicPosition[key] = 'private-sentinel';
    assert.equal(contract.isNetworkMarkerV2(nested), false, key);
    const value = detail(); value.updates[0][key] = 'private-sentinel';
    assert.equal(contract.isNetworkOperationalDetailV2(value), false, key);
    const counters = detail(); counters.confirmations[key] = 'private-sentinel';
    assert.equal(contract.isNetworkOperationalDetailV2(counters), false, key);
    assert.equal(contract.isNetworkHistoryDetailV2({ marker: historical(), summary: 'Sintesi storica revisionata', [key]: 'private-sentinel' }), false);
  }
  const accessor = operational(); Object.defineProperty(accessor, 'kind', { get: () => { throw Error('getter executed'); }, enumerable: true });
  assert.equal(contract.isNetworkMarkerV2(accessor), false);
  const inherited = operational(); Object.setPrototypeOf(inherited, { toJSON: () => ({ private: 'sentinel' }) });
  assert.equal(contract.isNetworkMarkerV2(inherited), false);
  const symbol = operational(); symbol[Symbol('private')] = 'sentinel'; assert.equal(contract.isNetworkMarkerV2(symbol), false);
  const arrayHook = detail(); arrayHook.updates.toJSON = () => { throw Error('hook executed'); };
  assert.equal(contract.isNetworkOperationalDetailV2(arrayHook), false);
  const sparse = detail(); sparse.updates = new Array(1);
  assert.equal(contract.isNetworkOperationalDetailV2(sparse), false);
  assert.equal(contract.isNetworkMarkerV2(clone(operational())), true);
  assert.equal(contract.isNetworkHistoryDetailV2(clone({ marker: historical(), summary: 'Sintesi storica revisionata' })), true);
});

test('strict TypeScript contracts compile; forbidden unions/fields are type errors', () => {
  // Compiler host provides this fixture only in memory. No config/output files written.
  const virtualFile = path.join(root, 'scripts/__network_contract_typecheck__.ts');
  const code = `
    import type { NetworkOperationalMarkerV2, NetworkHistoryMarkerV2, NetworkHistoryDetailV2 } from '../services/NetworkMapContractV2';
    import type { NetworkCategoryIdV2 } from '../services/NetworkCategoryRegistryV2';
    declare const op: NetworkOperationalMarkerV2;
    declare const history: NetworkHistoryMarkerV2;
    const validCategory: NetworkCategoryIdV2 = 'LIGHTING';
    const validHistory: NetworkHistoryDetailV2 = { marker: history, summary: 'Synthetic summary' };
    // @ts-expect-error history cannot be operational
    const wrongKind: NetworkOperationalMarkerV2 = history;
    // @ts-expect-error no operational timestamp in historical DTO
    history.createdAt;
    // @ts-expect-error no private author coordinates
    op.authorPosition;
    // @ts-expect-error legacy enum is not silently reclassified
    const wrongCategory: NetworkCategoryIdV2 = 'URBAN_HAZARD';
    // @ts-expect-error history detail has no nickname
    const privateHistory: NetworkHistoryDetailV2 = { marker: history, summary: 'Synthetic summary', authorNickname: 'Synthetic' };
    // @ts-expect-error lifecycle cannot mix ACTIVE and resolved date
    const wrongLifecycle: NetworkOperationalMarkerV2 = { ...op, status: 'ACTIVE', resolvedAt: '2026-11-01' };
    void [validCategory, validHistory, wrongKind, wrongCategory, privateHistory, wrongLifecycle];
  `;
  const options = { strict: true, noEmit: true, types: [], skipLibCheck: true,
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS };
  const host = ts.createCompilerHost(options);
  const originalRead = host.readFile.bind(host), originalExists = host.fileExists.bind(host), originalSource = host.getSourceFile.bind(host);
  const same = file => path.resolve(file).toLowerCase() === virtualFile.toLowerCase();
  host.readFile = file => same(file) ? code : originalRead(file);
  host.fileExists = file => same(file) || originalExists(file);
  host.getSourceFile = (file, languageVersion, onError, createNew) => same(file)
    ? ts.createSourceFile(file, code, languageVersion, true) : originalSource(file, languageVersion, onError, createNew);
  const program = ts.createProgram([registryFile, contractFile, virtualFile], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => root, getCanonicalFileName: file => file, getNewLine: () => '\n',
  }));
  for (const file of [registryFile, contractFile, __filename])
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /[\t ]+\r?$/m, `${file}: trailing whitespace`);
});
console.log(`${passed} targeted contract tests PASS. No UI, backend authorization, moderation or real geolocation verified.`);
