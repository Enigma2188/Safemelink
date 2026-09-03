import AsyncStorage from '@react-native-async-storage/async-storage';

export type AccountStorageNamespace =
  | 'checkpoint-active'
  | 'checkpoint-events'
  | 'go-home-active'
  | 'go-home-events'
  | 'go-home-location'
  | 'go-home-transport-mode'
  | 'passphrase'
  | 'sos-events'
  | 'sos-network-location'
  | 'sos-live-location'
  | 'safety-expiration'
  | 'sos-sms-consent'
  | 'sos-sms-dispatch'
  | 'trusted-contacts'
  | 'voice-protection';

const STORAGE_PREFIX = 'safemelink:account';
const LEGACY_OWNER_KEY = 'safemelink:storage-migration:v1:legacy-owner';
let migrationQueue: Promise<void> = Promise.resolve();

export const getAccountStorageKey = (
  userId: string,
  namespace: AccountStorageNamespace,
) => `${STORAGE_PREFIX}:${userId}:${namespace}`;

const getMigrationMarkerKey = (
  userId: string,
  namespace: AccountStorageNamespace,
) => `${getAccountStorageKey(userId, namespace)}:legacy-migration-v1`;

const enqueueMigration = async <T>(operation: () => Promise<T>) => {
  const previousOperation = migrationQueue;
  let releaseQueue = () => {};
  migrationQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });

  await previousOperation;

  try {
    return await operation();
  } finally {
    releaseQueue();
  }
};

async function migrateLegacyValueOnce(
  userId: string,
  namespace: AccountStorageNamespace,
  legacyKeys: readonly string[],
) {
  return enqueueMigration(async () => {
    const accountKey = getAccountStorageKey(userId, namespace);
    const markerKey = getMigrationMarkerKey(userId, namespace);
    const [existingValue, existingMarker] = await AsyncStorage.multiGet([
      accountKey,
      markerKey,
    ]);

    if (existingValue[1] !== null || existingMarker[1] !== null) {
      return existingValue[1];
    }

    let legacyOwnerId = await AsyncStorage.getItem(LEGACY_OWNER_KEY);

    if (!legacyOwnerId) {
      legacyOwnerId = userId;
      await AsyncStorage.setItem(LEGACY_OWNER_KEY, userId);
    }

    if (legacyOwnerId !== userId) {
      await AsyncStorage.setItem(markerKey, 'blocked:different-owner');
      return null;
    }

    let legacyValue: string | null = null;

    for (const legacyKey of legacyKeys) {
      legacyValue = await AsyncStorage.getItem(legacyKey);

      if (legacyValue !== null) {
        break;
      }
    }

    if (legacyValue !== null) {
      await AsyncStorage.setItem(accountKey, legacyValue);
      await AsyncStorage.setItem(markerKey, 'migrated');
      return legacyValue;
    }

    await AsyncStorage.setItem(markerKey, 'no-legacy-data');
    return null;
  });
}

export async function getAccountStorageItem(
  userId: string,
  namespace: AccountStorageNamespace,
  legacyKeys: readonly string[],
) {
  const accountKey = getAccountStorageKey(userId, namespace);
  const storedValue = await AsyncStorage.getItem(accountKey);

  if (storedValue !== null) {
    return storedValue;
  }

  return migrateLegacyValueOnce(userId, namespace, legacyKeys);
}

export async function setAccountStorageItem(
  userId: string,
  namespace: AccountStorageNamespace,
  value: string,
  legacyKeys: readonly string[],
) {
  await migrateLegacyValueOnce(userId, namespace, legacyKeys);
  await AsyncStorage.setItem(getAccountStorageKey(userId, namespace), value);
}

export async function removeAccountStorageItem(
  userId: string,
  namespace: AccountStorageNamespace,
) {
  await AsyncStorage.removeItem(getAccountStorageKey(userId, namespace));
}
