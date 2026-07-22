import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { ContactsService, type TrustedContact } from '@/services/ContactsService';
import {
  TrustedLinksService,
  type TrustedLinkRequest,
} from '@/services/TrustedLinksService';

type ContactForm = {
  name: string;
  phone: string;
};

const emptyForm: ContactForm = {
  name: '',
  phone: '',
};

export function TrustedContactsScreen() {
  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [form, setForm] = useState<ContactForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [publicCode, setPublicCode] = useState<string | null>(null);
  const [linkCode, setLinkCode] = useState('');
  const [requests, setRequests] = useState<TrustedLinkRequest[]>([]);
  const [showQr, setShowQr] = useState(false);
  const [linkActionPending, setLinkActionPending] = useState(false);

  const loadContacts = useCallback(async () => {
    try {
      const overview = await TrustedLinksService.loadOverview();
      setContacts(overview.contacts);
      setPublicCode(overview.publicCode);
      setRequests(overview.requests);
    } catch {
      Alert.alert('Contatti fidati', 'Non riesco a caricare i contatti salvati.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadContacts();
    }, [loadContacts])
  );

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const saveContact = async () => {
    try {
      const nextContacts = editingId
        ? await ContactsService.update(editingId, form)
        : await ContactsService.add(form);

      setContacts(nextContacts);
      resetForm();
    } catch (error) {
      Alert.alert('Contatti fidati', error instanceof Error ? error.message : 'Errore inatteso.');
    }
  };

  const startEdit = (contact: TrustedContact) => {
    setEditingId(contact.id);
    setForm({
      name: contact.name,
      phone: contact.phone,
    });
  };

  const deleteContact = async (contact: TrustedContact) => {
    Alert.alert('Elimina contatto', `Vuoi eliminare ${contact.name}?`, [
      {
        text: 'Annulla',
        style: 'cancel',
      },
      {
        text: 'Elimina',
        style: 'destructive',
        onPress: async () => {
          try {
            setContacts(await ContactsService.remove(contact.id));
            if (editingId === contact.id) {
              resetForm();
            }
          } catch {
            Alert.alert('Contatti fidati', 'Non riesco a eliminare il contatto.');
          }
        },
      },
    ]);
  };

  const sendLinkRequest = async () => {
    if (!linkCode.trim()) {
      Alert.alert('Collegamento SafeMeLink', 'Inserisci un codice SafeMeLink.');
      return;
    }

    setLinkActionPending(true);

    try {
      await TrustedLinksService.sendRequest(linkCode);
      setLinkCode('');
      await loadContacts();
      Alert.alert('Collegamento SafeMeLink', 'Richiesta inviata.');
    } catch (error) {
      Alert.alert(
        'Collegamento SafeMeLink',
        error instanceof Error ? error.message : 'Impossibile inviare la richiesta.',
      );
    } finally {
      setLinkActionPending(false);
    }
  };

  const respondToRequest = async (requestId: string, accept: boolean) => {
    setLinkActionPending(true);

    try {
      await TrustedLinksService.respond(requestId, accept);
      await loadContacts();
      Alert.alert(
        'Collegamento SafeMeLink',
        accept ? 'Contatto SafeMeLink collegato.' : 'Richiesta rifiutata.',
      );
    } catch (error) {
      Alert.alert(
        'Collegamento SafeMeLink',
        error instanceof Error ? error.message : 'Impossibile aggiornare la richiesta.',
      );
    } finally {
      setLinkActionPending(false);
    }
  };

  const cancelRequest = async (requestId: string) => {
    setLinkActionPending(true);

    try {
      await TrustedLinksService.cancel(requestId);
      await loadContacts();
    } catch (error) {
      Alert.alert(
        'Collegamento SafeMeLink',
        error instanceof Error ? error.message : 'Impossibile annullare la richiesta.',
      );
    } finally {
      setLinkActionPending(false);
    }
  };

  const receivedRequests = requests.filter(
    (request) => request.direction === 'received' && request.request_status === 'pending',
  );
  const sentRequests = requests.filter(
    (request) => request.direction === 'sent' && request.request_status === 'pending',
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Contatti fidati</Text>
        <Text style={styles.subtitle}>Gestisci i contatti telefonici e i collegamenti SafeMeLink.</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Il mio codice SafeMeLink</Text>
        {publicCode ? (
          <>
            <Text selectable style={styles.publicCode}>
              {publicCode}
            </Text>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => setShowQr((current) => !current)}>
              <Text style={styles.secondaryButtonText}>
                {showQr ? 'Nascondi QR' : 'Mostra QR'}
              </Text>
            </Pressable>
            {showQr && (
              <View style={styles.qrContainer}>
                <QRCode value={publicCode} size={190} />
              </View>
            )}
          </>
        ) : (
          <Text style={styles.emptyText}>Accedi per visualizzare il tuo codice personale.</Text>
        )}
      </View>

      {publicCode && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Aggiungi tramite codice</Text>
          <TextInput
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!linkActionPending}
            maxLength={12}
            onChangeText={setLinkCode}
            placeholder="SML-XXXXXXXX"
            placeholderTextColor="#687076"
            style={styles.input}
            value={linkCode}
          />
          <Pressable
            disabled={linkActionPending}
            onPress={() => void sendLinkRequest()}
            style={[styles.primaryButton, linkActionPending && styles.disabledButton]}>
            <Text style={styles.primaryButtonText}>Invia richiesta</Text>
          </Pressable>
        </View>
      )}

      {publicCode && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Richieste ricevute</Text>
          {receivedRequests.length === 0 ? (
            <Text style={styles.emptyText}>Nessuna richiesta in attesa.</Text>
          ) : (
            receivedRequests.map((request) => (
              <View key={request.request_id} style={styles.requestRow}>
                <Text style={styles.contactName}>{request.display_name}</Text>
                <View style={styles.actions}>
                  <Pressable
                    disabled={linkActionPending}
                    onPress={() => void respondToRequest(request.request_id, true)}
                    style={styles.smallButton}>
                    <Text style={styles.smallButtonText}>Accetta</Text>
                  </Pressable>
                  <Pressable
                    disabled={linkActionPending}
                    onPress={() => void respondToRequest(request.request_id, false)}
                    style={styles.dangerButton}>
                    <Text style={styles.dangerButtonText}>Rifiuta</Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}

          {sentRequests.length > 0 && (
            <>
              <Text style={styles.pendingTitle}>Richieste inviate</Text>
              {sentRequests.map((request) => (
                <View key={request.request_id} style={styles.requestRow}>
                  <Text style={styles.contactName}>{request.display_name}</Text>
                  <Text style={styles.pendingText}>In attesa</Text>
                  <Pressable
                    disabled={linkActionPending}
                    onPress={() => void cancelRequest(request.request_id)}
                    style={styles.secondaryButton}>
                    <Text style={styles.secondaryButtonText}>Annulla richiesta</Text>
                  </Pressable>
                </View>
              ))}
            </>
          )}
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{editingId ? 'Modifica contatto' : 'Nuovo contatto'}</Text>
        <TextInput
          style={styles.input}
          placeholder="Nome"
          placeholderTextColor="#687076"
          value={form.name}
          onChangeText={(name) => setForm((current) => ({ ...current, name }))}
        />
        <TextInput
          style={styles.input}
          placeholder="Numero di telefono"
          placeholderTextColor="#687076"
          keyboardType="phone-pad"
          value={form.phone}
          onChangeText={(phone) => setForm((current) => ({ ...current, phone }))}
        />
        <Pressable style={styles.primaryButton} onPress={saveContact}>
          <Text style={styles.primaryButtonText}>
            {editingId ? 'Salva modifiche' : 'Aggiungi contatto'}
          </Text>
        </Pressable>
        {editingId && (
          <Pressable style={styles.secondaryButton} onPress={resetForm}>
            <Text style={styles.secondaryButtonText}>Annulla modifica</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Contatti salvati ({contacts.length})</Text>
        {contacts.length === 0 ? (
          <Text style={styles.emptyText}>Nessun contatto salvato.</Text>
        ) : (
          contacts.map((contact) => (
            <View key={contact.id} style={styles.contactRow}>
              <View style={styles.contactInfo}>
                <Text style={styles.contactName}>{contact.name}</Text>
                <Text style={styles.contactPhone}>
                  {contact.phone || 'Contatto SafeMeLink collegato'}
                </Text>
              </View>
              <View style={styles.actions}>
                <Pressable style={styles.smallButton} onPress={() => startEdit(contact)}>
                  <Text style={styles.smallButtonText}>Modifica</Text>
                </Pressable>
                <Pressable style={styles.dangerButton} onPress={() => deleteContact(contact)}>
                  <Text style={styles.dangerButtonText}>Elimina</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f7f9fb',
    flexGrow: 1,
    padding: 20,
    paddingTop: 64,
  },
  header: {
    marginBottom: 20,
  },
  title: {
    color: '#11181c',
    fontSize: 30,
    fontWeight: '800',
  },
  subtitle: {
    color: '#52616b',
    fontSize: 15,
    lineHeight: 21,
    marginTop: 6,
  },
  publicCode: {
    color: '#0a7ea4',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 2,
    textAlign: 'center',
  },
  qrContainer: {
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 14,
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 8,
    marginBottom: 18,
    padding: 16,
  },
  sectionTitle: {
    color: '#11181c',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 12,
  },
  input: {
    backgroundColor: '#f0f3f5',
    borderColor: '#d7dee4',
    borderRadius: 6,
    borderWidth: 1,
    color: '#11181c',
    fontSize: 16,
    marginBottom: 10,
    padding: 12,
  },
  primaryButton: {
    backgroundColor: '#0a7ea4',
    borderRadius: 6,
    padding: 13,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  secondaryButton: {
    padding: 12,
  },
  secondaryButtonText: {
    color: '#0a7ea4',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  disabledButton: {
    backgroundColor: '#8a8f94',
  },
  emptyText: {
    color: '#687076',
    fontSize: 14,
  },
  contactRow: {
    borderTopColor: '#edf1f4',
    borderTopWidth: 1,
    paddingVertical: 12,
  },
  requestRow: {
    borderTopColor: '#edf1f4',
    borderTopWidth: 1,
    gap: 10,
    paddingVertical: 12,
  },
  pendingTitle: {
    color: '#11181c',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 18,
  },
  pendingText: {
    color: '#687076',
    fontSize: 14,
  },
  contactInfo: {
    marginBottom: 10,
  },
  contactName: {
    color: '#11181c',
    fontSize: 16,
    fontWeight: '800',
  },
  contactPhone: {
    color: '#52616b',
    fontSize: 14,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  smallButton: {
    backgroundColor: '#e8f3f7',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  smallButtonText: {
    color: '#0a7ea4',
    fontWeight: '800',
  },
  dangerButton: {
    backgroundColor: '#fdecec',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  dangerButtonText: {
    color: '#b71c1c',
    fontWeight: '800',
  },
});
