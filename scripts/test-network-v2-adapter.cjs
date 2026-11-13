'use strict';
/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const file = 'backend/repositories/NetworkV2Repository.ts';
const timers = new Map(); let nextTimer = 0;
const context = vm.createContext({ Date, AbortController, console,
  setTimeout: (fn, delay) => { const id = ++nextTimer; timers.set(id, { delay, fn: () => { timers.delete(id); fn(); } }); return id; }, clearTimeout: id => timers.delete(id) });
function load(name, deps = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, name), 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  context.exports = exports;
  context.require = key => { assert.ok(Object.hasOwn(deps, key), `Unexpected import ${key}`); return deps[key]; };
  vm.runInContext(`(function(exports,require){${code}\n})(exports,require);`, context);
  return exports;
}
const registry = load('services/NetworkCategoryRegistryV2.ts');
const contract = load('services/NetworkMapContractV2.ts', { './NetworkCategoryRegistryV2': registry });
const controller = load('services/NetworkMapController.ts', { './NetworkMapContractV2': contract, './NetworkCategoryRegistryV2': registry });
const api = load(file, { '@/services/NetworkMapContractV2': contract, '@/services/NetworkCategoryRegistryV2': registry, '@/services/NetworkMapController': controller });
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const marker = (n = 1, territory = 99) => ({ schemaVersion: 2, publicId: id(n), territoryId: id(territory), zoneId: id(90), kind: 'OPERATIONAL_EVENT',
  categoryId: 'LIGHTING', status: 'ACTIVE', locationPolicyVersion: 'synthetic-test', revision: 1, validUntil: new Date(Date.now() + 3600000).toISOString(),
  createdAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-02T10:00:00.000Z', resolvedAt: null,
  publicPosition: { latitude: 0, longitude: 0, representation: 'GENERALIZED_EVENT_POINT', generalizationMeters: 500 } });
const query = (territory = 99) => ({ territoryId: id(territory), center: { latitude: 0, longitude: 0 }, radiusMeters: 2500, status: 'ACTIVE', categoryId: null });
const detail = n => ({ marker: marker(n), authorNickname: 'Synthetic public nickname', description: 'Synthetic public description only.',
  confirmations: { confirmedCount: 0, noLongerPresentCount: 0, myConfirmation: null }, updates: [] });
const submission = () => ({ operationId: id(55), territoryId: id(99), eventPoint: { latitude: 0.25, longitude: 0.25 }, selection: 'EXPLICIT_EVENT_POINT', categoryId: 'LIGHTING', description: 'Synthetic explicit event point.' });
// JSON is decoded in the same realm as all actual modules, as in the app runtime.
const reply = data => ({ data: vm.runInContext(`JSON.parse(${JSON.stringify(JSON.stringify(data))})`, context), error: null, status: 200 });
const signal = () => new AbortController().signal;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(setImmediate);
async function expectError(promise, reason, outcome) {
  await assert.rejects(promise, error => error instanceof api.NetworkV2Error && error.reason === reason && (!outcome || error.outcome === outcome));
}
let passed = 0;
async function test(name, run) { await run(); passed++; console.log(`PASS ${name}`); }
(async () => {
  await test('real Supabase-shaped rpc/abort bridge; exact SQL parameter names; operational data and detail copied safely', async () => {
    const calls = []; let data = [marker()];
    const transport = api.createNetworkV2SupabaseTransport({ rpc: (name, args) => ({ abortSignal: async abortSignal => { calls.push({ name, args, abortSignal }); return reply(name === 'get_network_author_updates_v2' ? { eventId: data.marker.publicId, revision: data.marker.revision, validUntil: data.marker.validUntil, updates: [] } : data); } }) });
    const repo = new api.NetworkV2Repository(transport, () => 'scope');
    const result = await repo.loadMarkers(query(), signal()); assert.equal(result.length, 1); assert.equal(calls[0].abortSignal instanceof AbortSignal, true);
    data[0].publicPosition.latitude = 5; assert.equal(result[0].publicPosition.latitude, 0); assert.equal(Object.isFrozen(result[0].publicPosition), true);
    data = detail(1); const d = await repo.loadDetail(id(1), signal()); assert.equal(d.authorNickname, data.authorNickname);
    data.description = 'Changed source'; assert.notEqual(d.description, data.description);
    data = { publicId: id(1), status: 'ACTIVE', publicationState: 'PENDING', replayed: false }; await repo.publish(submission(), signal());
    data = null; await repo.finish(id(1), 'WITHDRAWN', signal());
    data = [{ territoryId: id(99), code: 'synthetic-region', label: 'Synthetic region', publicCenter: { latitude: 0, longitude: 0 },
      locationPolicyVersion: 'test', geometrySource: 'synthetic', geometryLicense: 'test-only', geometryVersion: '1' }];
    assert.equal((await repo.loadTerritories({ center: { latitude: 0, longitude: 0 }, radiusMeters: 10000, pageSize: 50 }, signal())).length, 1);
    const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261107120000_network_event_markers_v2.sql'), 'utf8') + fs.readFileSync(path.join(root, 'supabase/migrations/20261110120000_network_recovery_author_updates_v2.sql'), 'utf8');
    for (const call of calls) {
      const signature = sql.match(new RegExp(`create function public\\.${call.name}\\(([\\s\\S]*?)\\)\\s*\\nreturns`)); assert.ok(signature, call.name);
      const names = signature[1].split(',').map(value => value.trim().split(/\s+/)[0]);
      assert.deepEqual(Object.keys(call.args).sort(), names.sort()); assert.equal('authorizationKey' in call.args, false);
    }
    repo.dispose();
  });
  await test('strict decoding rejects private fields, PENDING markers, wrong territory, duplicates and invalid roots; expiry removed', async () => {
    let data = []; const repo = new api.NetworkV2Repository(async () => reply(data), () => 'scope');
    for (const invalid of [[{ ...marker(), accountId: id(8) }], [{ ...marker(), status: 'PENDING' }], [marker(1, 100)], [marker(), marker()], { markers: [marker()] }]) {
      data = invalid; await expectError(repo.loadMarkers(query(), signal()), 'INVALID_DATA');
    }
    data = [{ ...marker(), validUntil: '2020-01-01T00:00:00.000Z' }]; assert.equal((await repo.loadMarkers(query(), signal())).length, 0);
    data = { ...detail(1), authorUserId: id(8) }; await expectError(repo.loadDetail(id(1), signal()), 'INVALID_DATA');
    data = detail(2); await expectError(repo.loadDetail(id(1), signal()), 'INVALID_DATA');
    repo.dispose();
  });
  await test('HISTORY and invalid geography fail before transport; no legacy conversion or manufactured empty history', async () => {
    let calls = 0; const repo = new api.NetworkV2Repository(async () => { calls++; return reply([]); }, () => 'scope');
    await expectError(repo.loadMarkers({ ...query(), status: 'HISTORY' }, signal()), 'UNSUPPORTED_HISTORY');
    await expectError(repo.loadMarkers({ ...query(), center: { latitude: 89, longitude: 0 } }, signal()), 'INVALID_REQUEST');
    await expectError(repo.publish({ ...submission(), selection: 'GPS_DEFAULT' }, signal()), 'INVALID_REQUEST');
    assert.equal(calls, 0); repo.dispose();
  });
  await test('late marker/detail replies and account changes cannot return old data, including ignored abort signals', async () => {
    const calls = []; let access = 'scope-A'; const repo = new api.NetworkV2Repository((name, args, abort) => {
      if (name === 'get_network_author_updates_v2') return Promise.resolve(reply({ eventId: args.target_event, revision: 1, validUntil: new Date(Date.now()+60000).toISOString(), updates: [] }));
      const d = deferred(); calls.push({ ...d, name, args, abort }); return d.promise;
    }, () => access);
    const a = repo.loadMarkers(query(), signal()); const aCheck = expectError(a, 'STALE_RESPONSE'); await flush();
    const b = repo.loadMarkers(query(100), signal()); await flush(); calls[1].resolve(reply([marker(2, 100)])); assert.equal((await b)[0].publicId, id(2));
    calls[0].resolve(reply([marker()])); await aCheck;
    const c = repo.loadDetail(id(1), signal()); const cCheck = expectError(c, 'STALE_RESPONSE'); await flush();
    const d = repo.loadDetail(id(2), signal()); await flush(); calls[3].resolve(reply(detail(2))); await d; calls[2].resolve(reply(detail(1))); await cCheck;
    const e = repo.loadDetail(id(3), signal()); const eCheck = expectError(e, 'STALE_CONTEXT'); await flush();
    access = 'scope-B'; repo.invalidate(); assert.equal(calls[4].abort.aborted, true); calls[4].resolve(reply(detail(3))); await eCheck;
    repo.dispose();
  });
  await test('bounded timeout, cancellation and disposal; no retries; uncertain writes remain explicitly unknown', async () => {
    const calls = []; const repo = new api.NetworkV2Repository((name, args, abort) => { const d = deferred(); calls.push({ ...d, name, args, abort }); return d.promise; }, () => 'scope', 3333);
    const pending = repo.publish(submission(), signal()); const check = expectError(pending, 'TIMEOUT', 'UNKNOWN'); await flush();
    const timer = [...timers.values()].find(value => value.delay === 3333); assert.ok(timer); timer.fn(); await check;
    assert.equal(calls.length, 1); assert.equal(calls[0].abort.aborted, true); calls[0].resolve(reply({ publicId: id(1), status: 'ACTIVE', publicationState: 'PENDING', replayed: false })); await flush();
    const abort = new AbortController(); abort.abort(); await expectError(repo.loadMarkers(query(), abort.signal), 'ABORTED'); assert.equal(calls.length, 1);
    const stop = new AbortController(); const finishing = repo.finish(id(1), 'RESOLVED', stop.signal); const stopped = expectError(finishing, 'ABORTED', 'UNKNOWN'); await flush(); stop.abort(); await stopped;
    repo.dispose(); await expectError(repo.loadDetail(id(1), signal()), 'ACCESS_DENIED'); assert.equal(timers.size, 0);
  });
  await test('PENDING receipt is not a marker; stable operation IDs, safe errors and unknown malformed mutation responses', async () => {
    let count = 0, argsSeen = [], failure = null, data = null;
    const repo = new api.NetworkV2Repository(async (name, args) => { argsSeen.push(args); count++; if (failure) return failure;
      return reply(name === 'create_network_event_v2' ? { publicId: id(1), status: 'ACTIVE', publicationState: 'PENDING', replayed: count > 1 } : data); }, () => 'scope');
    const one = await repo.publish(submission(), signal()); const two = await repo.publish(submission(), signal());
    assert.equal(one.publicationState, 'PENDING'); assert.equal(two.replayed, true); assert.equal('publicPosition' in one, false);
    assert.equal(argsSeen[0].target_operation, argsSeen[1].target_operation);
    failure = { data: null, error: { code: '42501', message: 'private raw message must not propagate' }, status: 403 };
    await expectError(repo.loadMarkers(query(), signal()), 'ACCESS_DENIED');
    failure = { data: null, error: { code: 'PGRST202' }, status: 404 }; await expectError(repo.loadMarkers(query(), signal()), 'BACKEND_UNAVAILABLE');
    failure = { data: null, error: { code: '54000' }, status: 400 }; await expectError(repo.loadMarkers(query(), signal()), 'RATE_LIMIT');
    failure = { data: null, error: {}, status: 503 }; await expectError(repo.publish(submission(), signal()), 'SERVER', 'UNKNOWN');
    failure = { data: [marker()], error: null, status: 503 }; await expectError(repo.loadMarkers(query(), signal()), 'SERVER');
    failure = { data: { unexpected: true }, error: null, status: 200 }; await expectError(repo.publish(submission(), signal()), 'INVALID_DATA', 'UNKNOWN');
    failure = null; await repo.finish(id(1), 'WITHDRAWN', signal()); data = {}; await expectError(repo.finish(id(1), 'RESOLVED', signal()), 'INVALID_DATA', 'UNKNOWN');
    repo.dispose();
    const unavailableAuth = new api.NetworkV2Repository(async () => { assert.fail('No request allowed without verified auth context'); }, () => { throw new Error('private auth details'); });
    await expectError(unavailableAuth.loadMarkers(query(), signal()), 'ACCESS_DENIED'); unavailableAuth.dispose();
  });
  await test('actual controller integration receives validated snapshots, not receipt or demo rows', async () => {
    const repo = new api.NetworkV2Repository(async () => reply([marker()]), () => 'scope');
    const store = new controller.NetworkMapController(repo);
    await store.setContext({ authorizationKey: 'scope', query: query() }); assert.equal(store.getState().status, 'READY');
    assert.equal(store.getState().snapshot.markers[0].publicId, id(1)); await store.setContext(null); assert.equal(store.getState().snapshot.markers.length, 0);
    store.dispose(); repo.dispose(); assert.equal(timers.size, 0);
  });
  await test('local validation bundle: single transaction, actual dependency sources, default blocked, no executor', async () => {
    const builder = require('./prepare-network-v2-local-validation.cjs'); const bundle = builder.buildLocalValidation();
    assert.equal(builder.topLevel(bundle.sql)[0].token, 'begin'); assert.equal(builder.topLevel(bundle.sql).at(-1).token, 'rollback');
    assert.match(bundle.sql, /safemelink_network_v2_disposable_%/); assert.match(bundle.sql, /LOCAL_DISPOSABLE_NO_REMOTE/);
    assert.match(bundle.sql, /database is not an empty scratch database/); assert.equal(bundle.inputs.length, 5);
    assert.throws(() => builder.unwrap('begin; commit; commit;')); assert.throws(() => builder.unwrap("begin; do $$ begin; end;"));
  });
  await test('strict TypeScript including structural compatibility with actual installed Supabase client type', async () => {
    const virtual = path.join(root, 'scripts/__network_v2_rpc_typecheck__.ts');
    const source = `import type { SupabaseClient } from '@supabase/supabase-js';
import type { Json } from '../backend/database.types';
import { createNetworkV2SupabaseTransport, type NetworkV2RpcArgs } from '../backend/repositories/NetworkV2Repository';
type DB = {public:{Tables:{};Views:{};Enums:{};CompositeTypes:{};Functions:{[N in keyof NetworkV2RpcArgs]:{Args:NetworkV2RpcArgs[N];Returns:Json}}}};
declare const client: SupabaseClient<DB>;
createNetworkV2SupabaseTransport(client);
`;
    const modules = path.resolve(path.dirname(require.resolve('typescript')), '..', '..');
    const options = { strict: true, noEmit: true, skipLibCheck: true, esModuleInterop: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
      baseUrl: root, typeRoots: [path.join(modules, '@types')], types: ['react', 'node'], paths: { '@/*': ['./*'] } };
    const host = ts.createCompilerHost(options), read = host.readFile.bind(host), exists = host.fileExists.bind(host), get = host.getSourceFile.bind(host);
    const same = name => path.resolve(name).toLowerCase() === virtual.toLowerCase();
    host.readFile = name => same(name) ? source : read(name); host.fileExists = name => same(name) || exists(name);
    host.getSourceFile = (name, version, onError, fresh) => same(name) ? ts.createSourceFile(name, source, version, true) : get(name, version, onError, fresh);
    const program = ts.createProgram([path.join(root, file), virtual], options, host); const diagnostics = ts.getPreEmitDiagnostics(program);
    assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: () => root, getCanonicalFileName: name => name, getNewLine: () => '\n' }));
  });
  console.log(`${passed} local adapter/package checks PASS. No real Supabase, SQL execution, JWT or native rendering verified.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
