import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/backend/auth/AuthProvider';

export function OfflineStatusBanner() {
  const { isOffline, session } = useAuth();

  if (!session || !isOffline) {
    return null;
  }

  return (
    <View accessibilityRole="alert" style={styles.banner}>
      <Text style={styles.text}>
        Sei offline. Alcune funzioni SafeMeLink non sono disponibili.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#4A3511',
    borderBottomColor: '#D7A742',
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  text: {
    color: '#FFF3D0',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
});
