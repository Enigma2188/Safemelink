import AsyncStorage from '@react-native-async-storage/async-storage';

export const CURRENT_ONBOARDING_VERSION = 1;

const ONBOARDING_VERSION_KEY = 'safemelink_onboarding_version';

export const OnboardingStorage = {
  async getCompletedVersion() {
    const storedValue = await AsyncStorage.getItem(ONBOARDING_VERSION_KEY);
    const parsedValue = Number.parseInt(storedValue ?? '', 10);

    return Number.isInteger(parsedValue) && parsedValue >= 0 ? parsedValue : 0;
  },

  async markCurrentVersionCompleted() {
    await AsyncStorage.setItem(
      ONBOARDING_VERSION_KEY,
      String(CURRENT_ONBOARDING_VERSION),
    );
  },
};
