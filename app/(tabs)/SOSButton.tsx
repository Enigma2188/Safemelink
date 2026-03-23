import React, { useState, useRef, useEffect } from 'react';
import { Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';

type SOSButtonProps = {
  onToggle?: (active: boolean) => void;
};

export default function SOSButton({ onToggle }: SOSButtonProps) {
  const [active, setActive] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (active) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 500,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 500,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }

    if (onToggle) onToggle(active);
  }, [active]);

  const handlePress = () => setActive(!active);

  return (
    <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
      <TouchableOpacity
        style={[styles.button, { backgroundColor: active ? 'red' : 'green' }]}
        onPress={handlePress}
      >
        <Text style={styles.text}>{active ? 'SOS Attivo' : 'SOS'}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    color: 'white',
    fontSize: 24,
    fontWeight: 'bold',
  },
});