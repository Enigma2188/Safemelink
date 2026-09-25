const assert = require('node:assert/strict');
const fs = require('node:fs');

const home = fs.readFileSync('app/(tabs)/index.tsx', 'utf8');
const actions = fs.readFileSync('components/HomeQuickActions.tsx', 'utf8');
const storage = fs.readFileSync('storage/InterfaceModeStorage.ts', 'utf8');

assert.match(storage, /type InterfaceMode = 'essential' \| 'complete'/);
assert.match(storage, /safemelink:interface-mode/);
assert.match(storage, /value === 'essential' \|\| value === 'complete'/);
assert.match(home, /useState<InterfaceMode>\('complete'\)/);
assert.match(home, /InterfaceModeStorage\.get\(\)/);
assert.match(home, /InterfaceModeStorage\.set\(mode\)/);
assert.match(home, /HomeQuickActions mode=\{interfaceMode\}/);
assert.match(home, /Modalità interfaccia/);
assert.match(home, /chooseInterfaceMode\('essential'\)/);
assert.match(home, /chooseInterfaceMode\('complete'\)/);
assert.match(actions, /label: 'Proteggimi'/);
assert.match(actions, /label: 'Qualcosa non va'/);
assert.match(actions, /showMore \? 'Nascondi altro' : 'Altro'/);
assert.match(actions, /const secondaryActions = \[actions\[0\], actions\[3\], actions\[4\], actions\[5\]\]/);
assert.match(actions, /const visibleActions = mode === 'essential'/);
assert.match(actions, /visibleActions\.map/);
assert.match(actions, /onNavigate\('\/voice-protection'\)/);
assert.match(actions, /onPanel\('goHome'\)/);
assert.match(actions, /onNavigate\('\/protection-signal'\)/);
assert.match(actions, /onPanel\('checkpoint'\)/);
assert.match(actions, /onNavigate\('\/radar'\)/);
assert.match(actions, /onNavigate\('\/network'\)/);
assert.match(actions, /onNavigate\('\/neighborhood-network'\)/);
assert.match(home, /status === 'idle' \? <HomeQuickActions/);

console.log('Interface mode checks passed (complete default, persistent essential mode, shared routes and safety visibility)');
