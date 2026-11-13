const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exportsForTest = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('services/TrustedContactLink.ts','utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,{exports:exportsForTest});
const {parseTrustedContactToken,trustedContactUrl}=exportsForTest;
assert.equal(parseTrustedContactToken(' sml-abcdef12 '),'SML-ABCDEF12');
for(const value of [null,{},['SML-ABCDEF12'],'SML-ABCDEFGH','SML-ABCDEF12&x=1','https://example.com/SML-ABCDEF12'])assert.equal(parseTrustedContactToken(value),null);
const url=new URL(trustedContactUrl('SML-ABCDEF12'));assert.equal(url.protocol,'safemelink:');assert.equal(url.hostname,'connect');assert.equal(url.searchParams.get('token'),'SML-ABCDEF12');
assert.equal(trustedContactUrl('invalid'),'');
assert.equal(JSON.parse(fs.readFileSync('app.json','utf8')).expo.scheme,'safemelink');
assert.match(fs.readFileSync('app/connect.tsx','utf8'),/TrustedContactsScreen as default/);
assert.match(fs.readFileSync('screens/TrustedContactsScreen.tsx','utf8'),/QRCode value=\{trustedContactUrl\(publicCode\)\}/);
console.log('PASS QR contract: custom scheme/route, normalized token, malformed input rejection; external scanner, App Links and install fallback NOT tested');
