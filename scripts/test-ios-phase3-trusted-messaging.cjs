const fs = require('node:fs');

const read = (file) => fs.readFileSync(file, 'utf8');
const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

const protection = read('services/ProtectionSignalTrustedContactService.ts');
const sosAlert = read('services/SOSAlertService.ts');
const automatic = read('services/SOSAutomaticSmsService.ts');
const signalScreen = read('app/protection-signal.tsx');
const sosService = read('services/SOSService.ts');

const iosGate = protection.indexOf("if (Platform.OS !== 'android') return 'unavailable';");
const composer = protection.indexOf('Linking.openURL(url)');
expect(protection.includes("if (Platform.OS === 'android' && SafeMeLinkSms"), 'Protection Signal native SMS must be behind the Android gate.');
expect(iosGate >= 0 && composer > iosGate, 'Protection Signal iOS composer must be behind a capability/platform gate.');
expect(protection.includes('Linking.canOpenURL(url)'), 'Protection Signal must check composer capability before opening it.');
expect(protection.includes("if (!phone || !contact.remoteId) return 'unavailable';"), 'Protection Signal must keep contact/account identity validation.');
expect(protection.includes('deliveryInFlight'), 'Protection Signal composer must be protected against duplicate opens.');
expect(signalScreen.includes("result === 'composer' ? 'Messaggio preparato'"), 'Protection Signal must distinguish prepared from sent.');
expect(signalScreen.includes('premi Invia per completare'), 'Protection Signal must require manual confirmation.');
expect(sosAlert.includes('SMS_COMPOSER_OPENED'), 'SOS fallback must report only that the composer opened.');
expect(sosAlert.includes("status: 'sms_opened'"), 'SOS fallback must not claim delivery after opening the composer.');
expect(automatic.includes("Platform.OS === 'android'"), 'Automatic SMS must remain Android-only.');
expect(sosService.includes('sendSosAlert'), 'Composer fallback must remain separate from SOS backend completion.');
expect(!protection.match(/console\.(log|info|warn).*phone|console\.(log|info|warn).*MESSAGE/i), 'Trusted messaging logs must not contain phone numbers or message content.');

console.log('iOS Phase 3 trusted messaging checks: PASS');
