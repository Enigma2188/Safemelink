import AsyncStorage from '@react-native-async-storage/async-storage';

export type InterfaceMode = 'essential' | 'complete';

const STORAGE_KEY = 'safemelink:interface-mode';

export const InterfaceModeStorage = {
  async get(): Promise<InterfaceMode | null> {
    const value = await AsyncStorage.getItem(STORAGE_KEY);
    return value === 'essential' || value === 'complete' ? value : null;
  },

  async set(mode: InterfaceMode) {
    await AsyncStorage.setItem(STORAGE_KEY, mode);
  },
};
