import * as React from 'react';
import { useState, useRef, useEffect } from 'react';
import {
  Text,
  Image,
  StyleSheet,
  View,
  Animated,
  Dimensions,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Switch,
} from 'react-native';
import SOSButton from './SOSButton';

const { width, height } = Dimensions.get('window');

export default function HomeScreen() {
  const [sosActive, setSosActive] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showTrusted, setShowTrusted] = useState(false);
  const [showGuardian, setShowGuardian] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAvailability, setShowAvailability] = useState(false);

  const [trustedContacts, setTrustedContacts] = useState([
    { name: '', number: '' },
    { name: '', number: '' },
    { name: '', number: '' },
  ]);
  const [logIndex, setLogIndex] = useState<number[]>([]);
  const [chatVisible, setChatVisible] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState([{ from: 'bot', text: 'Ciao!' }]);
  const [inputText, setInputText] = useState('');
  const [dots, setDots] = useState('');

  const [darkMode, setDarkMode] = useState(false);
  const [soundsActive, setSoundsActive] = useState(true);
  const [available, setAvailable] = useState(true);

  const blinkAnim = useRef(new Animated.Value(1)).current;
  const animHeight = useRef(new Animated.Value(0)).current;
  const userBlink = useRef(new Animated.Value(1)).current;
  const radarAnim = useRef(new Animated.Value(0)).current;
  const scannerAnim = useRef(new Animated.Value(0)).current;

  const mapSize = width / 4;
  const radius = mapSize / 2;
  const [users, setUsers] = useState<any[]>([]);
  const [networkStatus, setNetworkStatus] = useState('Rete OK'); // simulazione stato rete

  const generateUsers = () => {
    const newUsers = Array.from({ length: 5 }).map(() => {
      const angle = Math.random() * 2 * Math.PI;
      const r = Math.random() * radius * 0.8;
      return { x: radius + r * Math.cos(angle), y: radius + r * Math.sin(angle) };
    });
    setUsers(newUsers);
  };

  const getBotResponse = (text: string) => {
    const msg = text.toLowerCase();
    if (msg.includes('ciao')) return 'Ciao! Ti accompagno io 😊';
    if (msg.includes('casa')) return 'Perfetto, resto con te fino a casa 🏠';
    if (msg.includes('paura')) return 'Tranquillo, sono qui. Attiva SOS se serve!';
    if (msg.includes('sos')) return 'Premi subito il pulsante SOS!';
    return 'Ti sto ascoltando...';
  };

  const stars = useRef(
    Array.from({ length: 50 }).map(() => ({
      x: Math.random() * width,
      y: Math.random() * (height / 1.5),
      size: Math.random() * 2 + 1,
      opacity: Math.random() * 0.8 + 0.2,
    }))
  ).current;

  const toggleMenu = () => {
    setMenuOpen(!menuOpen);
    Animated.timing(animHeight, {
      toValue: menuOpen ? 0 : 380,
      duration: 300,
      useNativeDriver: false,
    }).start();
  };
  const toggleTrusted = () => setShowTrusted(!showTrusted);

  const updateContact = (index: number, field: 'name' | 'number', value: string) => {
    const updated = [...trustedContacts];
    updated[index][field] = value;
    setTrustedContacts(updated);
  };

  useEffect(() => {
    if (sosActive) {
      generateUsers();

      Animated.loop(
        Animated.sequence([
          Animated.timing(blinkAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
          Animated.timing(blinkAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        ])
      ).start();

      Animated.loop(
        Animated.sequence([
          Animated.timing(userBlink, { toValue: 0.3, duration: 500, useNativeDriver: true }),
          Animated.timing(userBlink, { toValue: 1, duration: 500, useNativeDriver: true }),
        ])
      ).start();

      Animated.loop(Animated.timing(radarAnim, { toValue: 1, duration: 2000, useNativeDriver: true })).start();
      Animated.loop(Animated.timing(scannerAnim, { toValue: 1, duration: 3000, useNativeDriver: true })).start();

      setLogIndex([]);
      trustedContacts.forEach((c, i) => {
        if (c.name && c.number) {
          setTimeout(() => setLogIndex((prev) => [...prev, i]), i * 700);
        }
      });

      setNetworkStatus('Modalità Bluetooth attiva');
    } else {
      blinkAnim.setValue(1);
      userBlink.setValue(1);
      radarAnim.setValue(0);
      scannerAnim.setValue(0);
      setLogIndex([]);
      setUsers([]);
      setNetworkStatus('Rete OK');
    }
  }, [sosActive]);

  const startChat = () => {
    setChatLoading(true);
    let count = 0;
    const interval = setInterval(() => {
      count = (count + 1) % 4;
      setDots('.'.repeat(count));
    }, 500);

    setTimeout(() => {
      clearInterval(interval);
      setChatLoading(false);
      setChatVisible(true);
      setChatMessages([{ from: 'bot', text: 'Ciao! Ti accompagno io 😊' }]);
    }, 2000);
  };

  const sendMessage = () => {
    if (!inputText) return;
    const userText = inputText;
    setChatMessages((prev) => [...prev, { from: 'user', text: userText }]);
    setInputText('');
    setTimeout(() => {
      const response = getBotResponse(userText);
      setChatMessages((prev) => [...prev, { from: 'bot', text: response }]);
    }, 800);
  };

  const radarScale = radarAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 2] });
  const radarOpacity = radarAnim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] });
  const scannerRotate = scannerAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={styles.container}>
      <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: '#0a0f3c' }} />
      <View style={{ ...StyleSheet.absoluteFillObject, backgroundColor: '#3b0f5f', opacity: 0.3 }} />

      {stars.map((star, i) => (
        <View key={i} style={{
          position: 'absolute', left: star.x, top: star.y,
          width: star.size, height: star.size,
          borderRadius: star.size / 2,
          backgroundColor: '#fff',
          opacity: star.opacity
        }} />
      ))}

      {/* MENU */}
      <View style={{ position: 'absolute', top: 50, left: 20, zIndex: 10 }}>
        <TouchableOpacity onPress={toggleMenu} style={styles.menuButton}>
          <Text style={{ color: 'white', fontSize: 20 }}>☰</Text>
        </TouchableOpacity>

        <Animated.View style={[styles.dropdown, { height: animHeight }]}>
          <ScrollView>
            <TouchableOpacity style={styles.item} onPress={toggleTrusted}>
              <Text style={styles.itemText}>Numeri fidati</Text>
            </TouchableOpacity>
            {showTrusted && trustedContacts.map((c, i) => (
              <View key={i} style={styles.contactRow}>
                <TextInput style={styles.input} placeholder="Nome" placeholderTextColor="#aaa"
                  value={c.name} onChangeText={(t) => updateContact(i, 'name', t)} />
                <TextInput style={styles.input} placeholder="Numero" placeholderTextColor="#aaa"
                  value={c.number} onChangeText={(t) => updateContact(i, 'number', t)} />
              </View>
            ))}

            <TouchableOpacity style={styles.item} onPress={() => setShowGuardian(!showGuardian)}>
              <Text style={styles.itemText}>Guardian</Text>
            </TouchableOpacity>
            {showGuardian && (
              <>
                <TouchableOpacity style={styles.subItem}><Text style={styles.itemText}>I tuoi Guardian</Text></TouchableOpacity>
                <TouchableOpacity style={styles.subItem}><Text style={styles.itemText}>Vuoi diventare un Guardian?</Text></TouchableOpacity>
                <TouchableOpacity style={styles.subItem}><Text style={styles.itemText}>Richiedi Guardian vicino</Text></TouchableOpacity>
                <TouchableOpacity style={styles.subItem}><Text style={styles.itemText}>Suggerimenti Guardian</Text></TouchableOpacity>
              </>
            )}

            <TouchableOpacity style={styles.item} onPress={() => setShowSettings(!showSettings)}>
              <Text style={styles.itemText}>Impostazioni</Text>
            </TouchableOpacity>
            {showSettings && (
              <>
                <View style={styles.subItemRow}>
                  <Text style={styles.itemText}>Modalità notturna</Text>
                  <Switch value={darkMode} onValueChange={setDarkMode} />
                </View>
                <View style={styles.subItemRow}>
                  <Text style={styles.itemText}>Suoni attivi</Text>
                  <Switch value={soundsActive} onValueChange={setSoundsActive} />
                </View>
              </>
            )}

            <TouchableOpacity style={styles.item} onPress={() => setShowAvailability(!showAvailability)}>
              <Text style={styles.itemText}>Disponibilità</Text>
            </TouchableOpacity>
            {showAvailability && (
              <View style={styles.subItemRow}>
                <Text style={styles.itemText}>Disponibile / Silenzioso tranne contatti fidati</Text>
                <Switch value={available} onValueChange={setAvailable} />
              </View>
            )}

            <TouchableOpacity style={styles.item} onPress={startChat}>
              <Text style={styles.itemText}>Mi accompagni a casa</Text>
            </TouchableOpacity>
          </ScrollView>
        </Animated.View>
      </View>

      {/* NETWORK / BLUETOOTH STATUS */}
      <View style={{ position: 'absolute', top: 10, right: 20 }}>
        <Text style={{ color: 'white', fontWeight: 'bold' }}>{networkStatus}</Text>
      </View>

      {/* REC + LOG */}
      {sosActive && (
        <View style={styles.recContainer}>
          <Animated.View style={[styles.recDot, { opacity: blinkAnim }]} />
          <Text style={styles.recText}>REC</Text>
          <View style={styles.sosLog}>
            {logIndex.map((i) => (
              <View key={i} style={{ marginBottom: 4 }}>
                <Text style={styles.sosLogText}>{trustedContacts[i].name}</Text>
                <Text style={styles.sosSubText}>SMS ✅</Text>
                <Text style={styles.sosSubText}>WhatsApp ✅</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* CENTRO */}
      <View style={styles.content}>
        <Image source={require('../../assets/images/logo.png')} style={styles.logo} />
        <Text style={styles.title}>SafeMeLink</Text>
        <SOSButton onToggle={setSosActive} />
      </View>

      {/* RADAR */}
      <View style={styles.mapPlaceholder}>
        {sosActive && (
          <>
            <Animated.View style={[styles.radarWave, { transform: [{ scale: radarScale }], opacity: radarOpacity }]} />
            <Animated.View style={[styles.scannerLine, { transform: [{ rotate: scannerRotate }] }]} />
            {users.map((u, i) => (
              <Animated.View key={i} style={{
                position: 'absolute',
                left: u.x,
                top: u.y,
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: 'yellow',
                opacity: userBlink,
              }} />
            ))}
          </>
        )}
      </View>

      {/* CHAT */}
      {chatLoading && (
        <View style={styles.chatOverlay}>
          <Text style={{ color: 'white' }}>Ricerca utente{dots}</Text>
        </View>
      )}
      {chatVisible && (
        <View style={styles.chatOverlay}>
          <TouchableOpacity style={styles.chatCloseBtn} onPress={() => setChatVisible(false)}>
            <Text style={{ color: 'white', fontSize: 18 }}>✕</Text>
          </TouchableOpacity>
          <ScrollView style={{ flex: 1 }}>
            {chatMessages.map((m, i) => (
              <Text key={i} style={m.from === 'user' ? styles.chatUserText : styles.chatBotText}>{m.text}</Text>
            ))}
          </ScrollView>
          <View style={{ flexDirection: 'row' }}>
            <TextInput style={styles.chatInput} value={inputText} onChangeText={setInputText} />
            <TouchableOpacity onPress={sendMessage} style={styles.chatSendBtn}>
              <Text style={{ color: 'white' }}>Invia</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  logo: { width: 180, height: 180, marginBottom: 20 },
  title: { color: 'white', fontSize: 28, fontWeight: 'bold', marginBottom: 40 },
  recContainer: { position: 'absolute', top: 50, right: 30, alignItems: 'flex-start' },
  recDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: 'red', marginBottom: 4 },
  recText: { color: 'white', fontWeight: 'bold' },
  sosLog: { marginTop: 6, backgroundColor: '#222244AA', padding: 6, borderRadius: 6 },
  sosLogText: { color: 'white', fontSize: 12 },
  sosSubText: { color: '#00ff00', fontSize: 12, marginLeft: 8 },

  mapPlaceholder: { position: 'absolute', width: width / 4, height: width / 4, bottom: 20, right: 20, borderRadius: width / 8, backgroundColor: '#0a0f2c', borderWidth: 2, borderColor: '#00ffcc', overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  radarWave: { position: 'absolute', width: '100%', height: '100%', borderRadius: 999, borderWidth: 2, borderColor: '#00ffcc' },
  scannerLine: { position: 'absolute', width: '100%', height: 2, backgroundColor: '#00ffcc55', top: '50%', left: 0 },

  menuButton: { width: 40, height: 40, backgroundColor: '#222244', justifyContent: 'center', alignItems: 'center', borderRadius: 8 },
  dropdown: { overflow: 'hidden', backgroundColor: '#222244', marginTop: 10, borderRadius: 8 },
  item: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#444466' },
  subItem: { padding: 12, paddingLeft: 24, borderBottomWidth: 1, borderBottomColor: '#444466' },
  subItemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, paddingLeft: 24, borderBottomWidth: 1, borderBottomColor: '#444466' },
  itemText: { color: 'white' },
  contactRow: { flexDirection: 'row', margin: 5 },
  input: { flex: 1, backgroundColor: '#333366', color: 'white', margin: 4, padding: 6, borderRadius: 6 },

  chatOverlay: { position: 'absolute', top: '30%', left: '10%', width: '80%', height: '40%', backgroundColor: '#222244DD', borderRadius: 12, padding: 12 },
  chatCloseBtn: { position: 'absolute', top: 6, right: 6, zIndex: 10 },
  chatUserText: { alignSelf: 'flex-end', color: 'white', backgroundColor: '#444466', margin: 4, padding: 6, borderRadius: 6 },
  chatBotText: { alignSelf: 'flex-start', color: 'white', backgroundColor: '#666688', margin: 4, padding: 6, borderRadius: 6 },
  chatInput: { flex: 1, backgroundColor: '#333366', color: 'white', padding: 6, borderRadius: 6, marginRight: 6 },
  chatSendBtn: { backgroundColor: '#5555aa', padding: 8, borderRadius: 6, justifyContent: 'center', alignItems: 'center', marginBottom: 6 },
});