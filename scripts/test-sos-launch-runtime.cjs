const fs = require('node:fs');
const home = fs.readFileSync('app/(tabs)/index.tsx', 'utf8');
const runtime = fs.readFileSync('services/SOSLaunchRuntime.ts', 'utf8');

if (!home.includes('SOSLaunchRuntime.request(userId)')) throw new Error('Home does not use SOSLaunchRuntime');
if (!home.includes('SOSLaunchRuntime.subscribe')) throw new Error('Home does not subscribe to SOSLaunchRuntime');
if (!home.includes("if (statusRef.current === 'idle') startSOSCountdown('manual')")) throw new Error('Shared launcher does not converge on the Home countdown');
if (!runtime.includes('pendingUserId') || !runtime.includes('listener')) throw new Error('SOSLaunchRuntime lacks readiness handoff');

console.log('SOS launch runtime convergence checks passed');
