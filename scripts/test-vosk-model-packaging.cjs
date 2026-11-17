/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const archive = path.join(root,'modules/safemelink-vosk-lab/model-source/vosk-model-small-it-0.22.zip');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
assert.equal(sha(archive),'9ec65e75861d1c6c2e457cccd932705340dcdf233f5b239f00733b4de0bf3267');
const python = process.platform === 'win32' ? ['py',['-3']] : ['python3',[]];
const script = path.join(root,'scripts/prepare-vosk-lab-model.py');
const temp = fs.mkdtempSync(path.join(os.tmpdir(),'vosk-offline-test-'));
const run = args => spawnSync(python[0],[...python[1],script,...args],{cwd:root,encoding:'utf8'});
const wrong = path.join(temp,'wrong.zip'); fs.writeFileSync(wrong,'not a model');
assert.notEqual(run([wrong,'--project',temp]).status,0,'wrong hash must be rejected');
assert.equal(run([archive,'--project',root]).status,0,'verified existing model may be reused');
const model = path.join(root,'modules/safemelink-vosk-lab/android/src/enabled/assets/vosk-it');
const inventory = JSON.parse(fs.readFileSync(path.join(model,'SAFEMELINK_MODEL_SHA256.json'),'utf8'));
assert.equal(Object.keys(inventory).length,14);
for (const [name,expected] of Object.entries(inventory)) { assert.ok(!name.includes('\\') && !name.includes('..')); assert.equal(sha(path.join(model,name)),expected); }
const canonical = Object.fromEntries(Object.entries(inventory).sort(([a],[b])=>a<b?-1:a>b?1:0));
assert.equal(crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex'),'cee894090699f651cd93ffbac4ea5af514a3b3537039ae105b5591e195d7a921');
const badTarget = path.join(temp,'modules/safemelink-vosk-lab/android/src/enabled/assets/vosk-it'); fs.mkdirSync(badTarget,{recursive:true});
const sentinel = path.join(badTarget,'sentinel'); fs.writeFileSync(sentinel,'do not overwrite');
assert.notEqual(run([archive,'--project',temp]).status,0,'divergent model must not be overwritten'); assert.equal(fs.readFileSync(sentinel,'utf8'),'do not overwrite');
console.log('PASS offline pinned archive, portable 14-file inventory, idempotent verified reuse, wrong hash and overwrite refusal. No network or build.');
