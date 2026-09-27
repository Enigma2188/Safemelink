const fs = require('node:fs');

const read = (file) => fs.readFileSync(file, 'utf8');
const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

const push = read('services/PushNotificationService.ts');
const settings = read('app/settings.tsx');
const registrar = read('components/PushTokenRegistrar.tsx');
const center = read('components/SOSNotificationCenter.tsx');
const channels = read('services/OperationalNotificationChannels.ts');
const appConfig = read('app.json');

expect(appConfig.includes('"expo-notifications"'), 'Expo notifications plugin must remain configured.');
expect(push.includes('Notifications.setNotificationHandler'), 'A global notification handler must be installed.');
expect(push.includes('shouldShowBanner: requiresAttention'), 'Foreground urgent notifications must remain visible on iOS.');
expect(push.includes('shouldSetBadge: false'), 'No persistent notification badge workaround may be introduced.');
expect(push.includes('Notifications.getPermissionsAsync()'), 'Notification permission state must be read from the OS.');
expect(push.includes('Notifications.requestPermissionsAsync()'), 'Permission can be requested from a user action/registration flow.');
expect(push.includes('Notifications.getExpoPushTokenAsync({ projectId })'), 'The Expo push token flow must be shared with iOS.');
expect(push.includes('platform,'), 'Token registration must persist the actual platform.');
expect(!push.match(/console\.(log|info|warn).*expoPushToken|console\.(log|info|warn).*token\s*:/i), 'Push tokens must never be logged.');
expect(settings.includes('Notifications.getPermissionsAsync()'), 'Settings must expose the real OS permission state.');
expect(settings.includes('permission.canAskAgain'), 'Settings must distinguish requestable from blocked permission.');
expect(settings.includes("Platform.OS === 'android'"), 'Android channel details must remain platform-gated.');
expect(settings.includes('Linking.openSettings()'), 'Blocked iOS notifications must have a safe settings path.');
expect(settings.includes('scheduleNotificationAsync'), 'Test notification must use a local scheduling API.');
expect(settings.includes("trigger: Platform.OS === 'android' ? { channelId: SAFETY_NOTIFICATION_CHANNEL_ID } : null"), 'iOS test notifications must not depend on an Android channel.');
expect(registrar.includes('registerDeviceForUser(userId)'), 'Push registration must remain account-scoped.');
expect(registrar.includes('pushTokenSubscription.remove()'), 'Push token listeners must be cleaned up.');
expect(registrar.includes('appStateSubscription.remove()'), 'AppState listeners must be cleaned up.');
expect(center.includes('addNotificationReceivedListener'), 'Foreground notification receipt must be handled.');
expect(center.includes('addNotificationResponseReceivedListener'), 'Notification taps must be handled.');
expect(center.includes('getLastNotificationResponseAsync'), 'Cold-start notification responses must be recovered.');
expect(center.includes('navigationReadyRef') && center.includes('authReadyRef'), 'Notification routing must wait for auth and navigation readiness.');
expect(center.includes('clearLastNotificationResponseAsync'), 'Cold-start responses must be consumed once.');
expect(channels.includes("if (Platform.OS !== 'android') return null;"), 'Android channels must remain isolated from iOS.');
expect(!push.includes('silent push') && !registrar.includes('silent push'), 'No silent-push workaround may be introduced.');

console.log('iOS Phase 4 notification checks: PASS');
