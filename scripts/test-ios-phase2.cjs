const fs = require('node:fs');

const read = (file) => fs.readFileSync(file, 'utf8');
const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

const protectionSignal = read('services/ProtectionSignalTrustedContactService.ts');
const presence = read('services/SOSNetworkPresenceService.ts');
const presenceProvider = read('components/SOSNetworkPresenceProvider.tsx');
const liveLocation = read('services/SOSLiveLocationService.ts');
const sms = read('services/SOSAutomaticSmsService.ts');
const network = read('screens/NetworkScreen.tsx');
const neighborhood = read('screens/NeighborhoodNetworkScreen.tsx');
const home = read('app/(tabs)/index.tsx');
const signal = read('app/protection-signal.tsx');

expect(protectionSignal.includes("if (Platform.OS !== 'android') return 'unavailable';"), 'Protection Signal must not open an iOS SMS composer in Phase 2.');
expect(protectionSignal.includes('SafeMeLinkSms.sendSms'), 'Android native SMS path must remain available.');
const iosGate = protectionSignal.indexOf("if (Platform.OS !== 'android') return 'unavailable';");
const smsComposer = protectionSignal.indexOf("const url = `sms:${phone}?body=");
expect(iosGate >= 0 && smsComposer > iosGate, 'iOS SMS fallback must be unreachable before the platform gate.');
expect(presence.includes("if (Platform.OS !== 'android') {"), 'SOS network background location must be platform-gated.');
expect(presence.includes('requestForegroundPermissionsAsync'), 'Foreground location participation must remain available.');
expect(presence.includes("if (Platform.OS !== 'android') return false;"), 'iOS must not claim background location readiness.');
expect(presenceProvider.includes("const foregroundOnly = Platform.OS !== 'android';"), 'iOS SOS network status must describe foreground-only availability.');
expect(presenceProvider.includes('Presenza attiva mentre SafeMeLink è aperto su questo iPhone.'), 'iOS must not instruct users to grant Location Always in Phase 2.');
expect(!presence.includes('requestBackgroundPermissionsAsync()') || presence.indexOf('requestBackgroundPermissionsAsync()') > presence.indexOf("if (Platform.OS !== 'android')"), 'Background permission request must remain Android-only.');
expect(liveLocation.includes('getBackgroundPermissionsAsync'), 'Existing SOS live-location recovery path must remain explicit.');
expect(liveLocation.includes("Platform.OS === 'android' || Platform.OS === 'ios'"), 'SOS live location may use background updates on both supported platforms.');
expect(sms.includes("Platform.OS === 'android'"), 'Automatic SMS must remain Android-gated.');
expect(!network.includes('PermissionsAndroid') && !network.includes('SafeMeLinkSms'), 'NETWORK must not import Android-only APIs.');
expect(!neighborhood.includes('PermissionsAndroid') && !neighborhood.includes('SafeMeLinkSms'), 'Neighborhood network must not import Android-only APIs.');
expect(home.includes('startCheckpoint') && home.includes('startGoHome'), 'Home safety actions must remain present behind their iOS gate.');
expect(signal.includes('SOSLaunchRuntime.request'), 'Protection Signal must keep the shared SOS launcher.');

console.log('iOS Phase 2 static checks: PASS');
