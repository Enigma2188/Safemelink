import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

type TrustedContact = {
  id: string;
  name: string;
  phone: string;
  selected: boolean;
};

type SosEvent = {
  id: string;
  createdAt: string;
  latitude: number | null;
  longitude: number | null;
  message: string;
  contactIds: string[];
};

const CONTACTS_STORAGE_KEY = 'safemelink.trustedContacts';
const SOS_EVENTS_STORAGE_KEY = 'safemelink.sosEvents';

export default function HomeScreen() {
  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [activeSos, setActiveSos] = useState<SosEvent | null>(null);
  const [lastEvents, setLastEvents] = useState<SosEvent[]>([]);
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const startedAtRef = useRef<number | null>(null);

  const selectedContacts = useMemo(
    () => contacts.filter((contact) => contact.selected),
    [contacts]
  );

  useEffect(() => {
    const loadStoredData = async () => {
      try {
        const [storedContacts, storedEvents] = await Promise.all([
          AsyncStorage.getItem(CONTACTS_STORAGE_KEY),
          AsyncStorage.getItem(SOS_EVENTS_STORAGE_KEY),
        ]);

        if (storedContacts) {
          setContacts(JSON.parse(storedContacts));
        }

        if (storedEvents) {
          setLastEvents(JSON.parse(storedEvents));
        }
      } catch {
        Alert.alert('Archivio locale', 'Non riesco a leggere i dati salvati sul dispositivo.');
      }
    };

    loadStoredData();
  }, []);

  useEffect(() => {
    if (!activeSos) {
      startedAtRef.current = null;
      setElapsedSeconds(0);
      return;
    }

    startedAtRef.current = Date.now();
    const intervalId = setInterval(() => {
      if (startedAtRef.current) {
        setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }
    }, 1000);

    return () => clearInterval(intervalId);
  }, [activeSos]);

  const saveContacts = async (nextContacts: TrustedContact[]) => {
    setContacts(nextContacts);
    await AsyncStorage.setItem(CONTACTS_STORAGE_KEY, JSON.stringify(nextContacts));
  };

  const addContact = async () => {
    const name = contactName.trim();
    const phone = contactPhone.trim();

    if (!name || !phone) {
      Alert.alert('Contatto incompleto', 'Inserisci nome e numero di telefono.');
      return;
    }

    const nextContacts = [
      ...contacts,
      {
        id: `${Date.now()}`,
        name,
        phone,
        selected: true,
      },
    ];

    await saveContacts(nextContacts);
    setContactName('');
    setContactPhone('');
  };

  const toggleContact = async (id: string) => {
    const nextContacts = contacts.map((contact) =>
      contact.id === id ? { ...contact, selected: !contact.selected } : contact
    );
    await saveContacts(nextContacts);
  };

  const removeContact = async (id: string) => {
    const nextContacts = contacts.filter((contact) => contact.id !== id);
    await saveContacts(nextContacts);
  };

  const createSosMessage = (
    latitude: number | null,
    longitude: number | null,
    createdAt: string
  ) => {
    const mapsLink =
      latitude !== null && longitude !== null
        ? `https://maps.google.com/?q=${latitude},${longitude}`
        : 'Posizione non disponibile';

    return [
      'SOS SafeMeLink',
      `Ora: ${new Date(createdAt).toLocaleString()}`,
      `Posizione: ${mapsLink}`,
      'Ho bisogno di aiuto. Contattami appena possibile.',
    ].join('\n');
  };

  const activateSos = async () => {
    if (selectedContacts.length === 0) {
      Alert.alert('Nessun destinatario', 'Seleziona almeno un contatto fidato prima di inviare SOS.');
      return;
    }

    setIsLoadingLocation(true);

    try {
      const permission = await Location.requestForegroundPermissionsAsync();

      if (permission.status !== 'granted') {
        Alert.alert('Posizione non autorizzata', 'Abilita la posizione per associare le coordinate al SOS.');
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      const createdAt = new Date().toISOString();
      const event: SosEvent = {
        id: `${Date.now()}`,
        createdAt,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        message: createSosMessage(position.coords.latitude, position.coords.longitude, createdAt),
        contactIds: selectedContacts.map((contact) => contact.id),
      };

      const nextEvents = [event, ...lastEvents].slice(0, 20);
      await AsyncStorage.setItem(SOS_EVENTS_STORAGE_KEY, JSON.stringify(nextEvents));
      setLastEvents(nextEvents);
      setActiveSos(event);
      await shareSos(event);
    } catch {
      Alert.alert('SOS non completato', 'Non riesco a recuperare la posizione in questo momento.');
    } finally {
      setIsLoadingLocation(false);
    }
  };

  const shareSos = async (event: SosEvent) => {
    const recipients = selectedContacts
      .map((contact) => `${contact.name} (${contact.phone})`)
      .join(', ');

    await Share.share({
      message: `${event.message}\n\nDestinatari selezionati: ${recipients}`,
    });
  };

  const deactivateSos = () => {
    setActiveSos(null);
  };

  const formatElapsed = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.appName}>SafeMeLink</Text>
        <Text style={styles.subtitle}>MVP SOS personale</Text>
      </View>

      {activeSos ? (
        <View style={styles.emergencyPanel}>
          <Text style={styles.emergencyLabel}>SOS ATTIVO</Text>
          <Text style={styles.timer}>{formatElapsed(elapsedSeconds)}</Text>
          <Text style={styles.emergencyText}>Evento salvato sul dispositivo.</Text>
          <Text style={styles.coordinates}>
            {activeSos.latitude}, {activeSos.longitude}
          </Text>
          <Pressable style={styles.shareButton} onPress={() => shareSos(activeSos)}>
            <Text style={styles.shareButtonText}>Condividi di nuovo SOS</Text>
          </Pressable>
          <Pressable style={styles.stopButton} onPress={deactivateSos}>
            <Text style={styles.stopButtonText}>Disattiva SOS</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.sosPanel}>
          <Pressable
            disabled={isLoadingLocation}
            style={({ pressed }) => [
              styles.sosButton,
              pressed && styles.sosButtonPressed,
              isLoadingLocation && styles.disabledButton,
            ]}
            onPress={activateSos}>
            <Text style={styles.sosButtonText}>{isLoadingLocation ? 'POSIZIONE...' : 'SOS'}</Text>
          </Pressable>
          <Text style={styles.helperText}>
            Il pulsante salva un evento locale, recupera la posizione e apre la condivisione.
          </Text>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Contatti fidati</Text>
        <View style={styles.formRow}>
          <TextInput
            style={styles.input}
            placeholder="Nome"
            placeholderTextColor="#687076"
            value={contactName}
            onChangeText={setContactName}
          />
          <TextInput
            style={styles.input}
            placeholder="Telefono"
            placeholderTextColor="#687076"
            keyboardType="phone-pad"
            value={contactPhone}
            onChangeText={setContactPhone}
          />
        </View>
        <Pressable style={styles.addButton} onPress={addContact}>
          <Text style={styles.addButtonText}>Aggiungi contatto</Text>
        </Pressable>

        {contacts.length === 0 ? (
          <Text style={styles.emptyText}>Nessun contatto salvato.</Text>
        ) : (
          contacts.map((contact) => (
            <View key={contact.id} style={styles.contactRow}>
              <View style={styles.contactInfo}>
                <Text style={styles.contactName}>{contact.name}</Text>
                <Text style={styles.contactPhone}>{contact.phone}</Text>
              </View>
              <Switch value={contact.selected} onValueChange={() => toggleContact(contact.id)} />
              <Pressable style={styles.removeButton} onPress={() => removeContact(contact.id)}>
                <Text style={styles.removeButtonText}>Rimuovi</Text>
              </Pressable>
            </View>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Ultimi eventi SOS</Text>
        {lastEvents.length === 0 ? (
          <Text style={styles.emptyText}>Nessun evento salvato.</Text>
        ) : (
          lastEvents.slice(0, 3).map((event) => (
            <View key={event.id} style={styles.eventRow}>
              <Text style={styles.eventDate}>{new Date(event.createdAt).toLocaleString()}</Text>
              <Text style={styles.eventCoords}>
                {event.latitude}, {event.longitude}
              </Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    backgroundColor: '#f7f9fb',
    padding: 20,
    paddingTop: 64,
  },
  header: {
    marginBottom: 28,
  },
  appName: {
    color: '#11181c',
    fontSize: 34,
    fontWeight: '800',
  },
  subtitle: {
    color: '#52616b',
    fontSize: 16,
    marginTop: 4,
  },
  sosPanel: {
    alignItems: 'center',
    marginBottom: 28,
  },
  sosButton: {
    width: 168,
    height: 168,
    borderRadius: 84,
    backgroundColor: '#c62828',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.24,
    shadowRadius: 12,
    elevation: 8,
  },
  sosButtonPressed: {
    transform: [{ scale: 0.98 }],
  },
  disabledButton: {
    backgroundColor: '#8a8f94',
  },
  sosButtonText: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '900',
  },
  helperText: {
    color: '#52616b',
    fontSize: 14,
    lineHeight: 20,
    marginTop: 18,
    textAlign: 'center',
  },
  emergencyPanel: {
    backgroundColor: '#b71c1c',
    borderRadius: 8,
    padding: 20,
    marginBottom: 28,
  },
  emergencyLabel: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '900',
    textAlign: 'center',
  },
  timer: {
    color: '#fff',
    fontSize: 48,
    fontWeight: '800',
    marginTop: 12,
    textAlign: 'center',
  },
  emergencyText: {
    color: '#fff',
    fontSize: 15,
    marginTop: 12,
    textAlign: 'center',
  },
  coordinates: {
    color: '#ffe9e9',
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
  shareButton: {
    backgroundColor: '#fff',
    borderRadius: 6,
    marginTop: 18,
    padding: 14,
  },
  shareButtonText: {
    color: '#b71c1c',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  stopButton: {
    borderColor: '#fff',
    borderRadius: 6,
    borderWidth: 1,
    marginTop: 12,
    padding: 14,
  },
  stopButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 8,
    marginBottom: 18,
    padding: 16,
  },
  sectionTitle: {
    color: '#11181c',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 12,
  },
  formRow: {
    gap: 10,
  },
  input: {
    backgroundColor: '#f0f3f5',
    borderColor: '#d7dee4',
    borderRadius: 6,
    borderWidth: 1,
    color: '#11181c',
    fontSize: 16,
    padding: 12,
  },
  addButton: {
    backgroundColor: '#0a7ea4',
    borderRadius: 6,
    marginTop: 10,
    padding: 13,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptyText: {
    color: '#687076',
    fontSize: 14,
    marginTop: 8,
  },
  contactRow: {
    alignItems: 'center',
    borderTopColor: '#edf1f4',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 12,
  },
  contactInfo: {
    flex: 1,
  },
  contactName: {
    color: '#11181c',
    fontSize: 16,
    fontWeight: '700',
  },
  contactPhone: {
    color: '#52616b',
    fontSize: 14,
    marginTop: 2,
  },
  removeButton: {
    paddingVertical: 6,
  },
  removeButtonText: {
    color: '#b71c1c',
    fontSize: 13,
    fontWeight: '700',
  },
  eventRow: {
    borderTopColor: '#edf1f4',
    borderTopWidth: 1,
    paddingVertical: 10,
  },
  eventDate: {
    color: '#11181c',
    fontSize: 14,
    fontWeight: '700',
  },
  eventCoords: {
    color: '#52616b',
    fontSize: 13,
    marginTop: 2,
  },
});
