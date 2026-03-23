import React, { useEffect } from 'react';
import { View, Text } from 'react-native';

export default function App() {
  useEffect(() => {
    const warmUpNetwork = async () => {
      try {
        // Risveglia lo stack di rete/DNS
        await fetch("https://www.google.com", { method: "HEAD" });

        // Riscalda il backend sulla tua rete locale
        await fetch("http://192.168.1.2:3000", { method: "HEAD" });

        console.log("Warm-up completato ✅");
      } catch (err) {
        console.log("Errore warm-up:", err);
      }
    };

    warmUpNetwork();
  }, []);

  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Text>Demo SafeMeLink in avvio...</Text>
    </View>
  );
}