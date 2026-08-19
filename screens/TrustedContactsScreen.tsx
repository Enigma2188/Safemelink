import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { useAuth } from '@/backend/auth/AuthProvider';
import { ContactsService, type TrustedContact } from '@/services/ContactsService';
import type { PreferredSosChannel } from '@/services/SafeMeLinkContact';
import {
  TrustedLinksService,
  type TrustedLinkRequest,
} from '@/services/TrustedLinksService';

type ContactForm = {
  name: string;
  phone: string;
  preferredChannel: PreferredSosChannel;
};

const emptyForm: ContactForm = {
  name: '',
  phone: '',
  preferredChannel: 'sms',
};

export function TrustedContactsScreen() {
  const { session, isInitializing } = useAuth();
  const userId = session?.user.id ?? null;
  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [form, setForm] = useState<ContactForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [publicCode, setPublicCode] = useState<string | null>(null);
  const [linkCode, setLinkCode] = useState('');
  const [requests, setRequests] = useState<TrustedLinkRequest[]>([]);
  const [showQr, setShowQr] = useState(false);
  const [linkActionPending, setLinkActionPending] = useState(false);
  const [contactActionPending, setContactActionPending] = useState(false);
  const activeUserIdRef = useRef<string | null>(userId);
  const loadGenerationRef = useRef(0);
  const linkActionGenerationRef = useRef(0);
  const linkActionInFlightRef = useRef(false);
  const contactActionGenerationRef = useRef(0);
  const contactActionInFlightRef = useRef(false);
  activeUserIdRef.current = userId;

  const loadContacts = useCallback(async () => {
    const loadUserId = userId;
    const loadGeneration = loadGenerationRef.current + 1;
    loadGenerationRef.current = loadGeneration;

    if (isInitializing || !loadUserId) {
      return;
    }

    try {
      const overview = await TrustedLinksService.loadOverview();

      if (
        activeUserIdRef.current !== loadUserId ||
        loadGenerationRef.current !== loadGeneration
      ) {
        return;
      }

      setContacts(overview.contacts);
      setPublicCode(overview.publicCode);
      setRequests(overview.requests);
    } catch {
      if (
        activeUserIdRef.current === loadUserId &&
        loadGenerationRef.current === loadGeneration
      ) {
        Alert.alert('Contatti fidati', 'Non riesco a caricare i contatti salvati.');
      }
    }
  }, [isInitializing, userId]);

  useEffect(() => {
    loadGenerationRef.current += 1;
    setContacts([]);
    setForm(emptyForm);
    setEditingId(null);
    setPublicCode(null);
    setLinkCode('');
    setRequests([]);
    setShowQr(false);
    linkActionGenerationRef.current += 1;
    linkActionInFlightRef.current = false;
    setLinkActionPending(false);
    contactActionGenerationRef.current += 1;
    contactActionInFlightRef.current = false;
    setContactActionPending(false);
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void loadContacts();

      return () => {
        loadGenerationRef.current += 1;
      };
    }, [loadContacts]),
  );

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const saveContact = async () => {
    const actionUserId = userId;

    if (contactActionInFlightRef.current) {
      return;
    }

    if (!actionUserId) {
      Alert.alert('Contatti fidati', 'Accedi per gestire i contatti salvati.');
      return;
    }

    contactActionInFlightRef.current = true;
    const actionGeneration = contactActionGenerationRef.current + 1;
    contactActionGenerationRef.current = actionGeneration;
    setContactActionPending(true);

    try {
      const nextContacts = editingId
        ? await ContactsService.update(editingId, form)
        : await ContactsService.add(form);

      if (activeUserIdRef.current === actionUserId) {
        setContacts(nextContacts);
        resetForm();
      }
    } catch (error) {
      Alert.alert('Contatti fidati', error instanceof Error ? error.message : 'Errore inatteso.');
    } finally {
      if (contactActionGenerationRef.current === actionGeneration) {
        contactActionInFlightRef.current = false;
      }
      if (
        activeUserIdRef.current === actionUserId &&
        contactActionGenerationRef.current === actionGeneration
      ) {
        setContactActionPending(false);
      }
    }
  };

  const startEdit = (contact: TrustedContact) => {
    setEditingId(contact.id);
    setForm({
      name: contact.name,
      phone: contact.phone,
      preferredChannel: contact.preferredChannel,
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
          const actionUserId = userId;

          if (!actionUserId || contactActionInFlightRef.current) {
            return;
          }

          contactActionInFlightRef.current = true;
          const actionGeneration = contactActionGenerationRef.current + 1;
          contactActionGenerationRef.current = actionGeneration;
          setContactActionPending(true);

          try {
            const nextContacts = await ContactsService.remove(contact.id);

            if (activeUserIdRef.current === actionUserId) {
              setContacts(nextContacts);
              if (editingId === contact.id) {
                resetForm();
              }
            }
          } catch {
            Alert.alert('Contatti fidati', 'Non riesco a eliminare il contatto.');
          } finally {
            if (contactActionGenerationRef.current === actionGeneration) {
              contactActionInFlightRef.current = false;
            }
            if (
              activeUserIdRef.current === actionUserId &&
              contactActionGenerationRef.current === actionGeneration
            ) {
              setContactActionPending(false);
            }
          }
        },
      },
    ]);
  };

  const sendLinkRequest = async () => {
    if (linkActionInFlightRef.current) {
      return;
    }

    if (!linkCode.trim()) {
      Alert.alert('Collegamento SafeMeLink', 'Inserisci un codice SafeMeLink.');
      return;
    }

    const actionUserId = userId;

    if (!actionUserId) {
      return;
    }

    linkActionInFlightRef.current = true;
    const actionGeneration = linkActionGenerationRef.current + 1;
    linkActionGenerationRef.current = actionGeneration;
    setLinkActionPending(true);

    try {
      await TrustedLinksService.sendRequest(linkCode);

      if (activeUserIdRef.current !== actionUserId) {
        return;
      }

      setLinkCode('');
      await loadContacts();
      Alert.alert('Collegamento SafeMeLink', 'Richiesta inviata.');
    } catch (error) {
      Alert.alert(
        'Collegamento SafeMeLink',
        error instanceof Error ? error.message : 'Impossibile inviare la richiesta.',
      );
    } finally {
      if (linkActionGenerationRef.current === actionGeneration) {
        linkActionInFlightRef.current = false;
      }
      if (
        activeUserIdRef.current === actionUserId &&
        linkActionGenerationRef.current === actionGeneration
      ) {
        setLinkActionPending(false);
      }
    }
  };

  const respondToRequest = async (requestId: string, accept: boolean) => {
    if (linkActionInFlightRef.current) {
      return;
    }

    const actionUserId = userId;

    if (!actionUserId) {
      return;
    }

    linkActionInFlightRef.current = true;
    const actionGeneration = linkActionGenerationRef.current + 1;
    linkActionGenerationRef.current = actionGeneration;
    setLinkActionPending(true);

    try {
      await TrustedLinksService.respond(requestId, accept);

      if (activeUserIdRef.current !== actionUserId) {
        return;
      }

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
      if (linkActionGenerationRef.current === actionGeneration) {
        linkActionInFlightRef.current = false;
      }
      if (
        activeUserIdRef.current === actionUserId &&
        linkActionGenerationRef.current === actionGeneration
      ) {
        setLinkActionPending(false);
      }
    }
  };

  const cancelRequest = async (requestId: string) => {
    if (linkActionInFlightRef.current) {
      return;
    }

    const actionUserId = userId;

    if (!actionUserId) {
      return;
    }

    linkActionInFlightRef.current = true;
    const actionGeneration = linkActionGenerationRef.current + 1;
    linkActionGenerationRef.current = actionGeneration;
    setLinkActionPending(true);

    try {
      await TrustedLinksService.cancel(requestId);

      if (activeUserIdRef.current !== actionUserId) {
        return;
      }

      await loadContacts();
    } catch (error) {
      Alert.alert(
        'Collegamento SafeMeLink',
        error instanceof Error ? error.message : 'Impossibile annullare la richiesta.',
      );
    } finally {
      if (linkActionGenerationRef.current === actionGeneration) {
        linkActionInFlightRef.current = false;
      }
      if (
        activeUserIdRef.current === actionUserId &&
        linkActionGenerationRef.current === actionGeneration
      ) {
        setLinkActionPending(false);
      }
    }
  };

  const receivedRequests = requests.filter(
    (request) => request.direction === 'received' && request.request_status === 'pending',
  );
  const sentRequests = requests.filter(
    (request) => request.direction === 'sent' && request.request_status === 'pending',
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.screen}>
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled">
      <View style={styles.header}>
        <Text style={styles.title}>Contatti fidati</Text>
        <Text style={styles.subtitle}>
          La tua cerchia personale, separata dalla rete generale SafeMeLink.
        </Text>
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
          <Text style={styles.sectionHelp}>
            Una richiesta accettata crea un contatto fidato personale e prioritario per gli SOS.
          </Text>
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
        <Text style={styles.sectionHelp}>
          Il numero telefonico viene sincronizzato come fallback SMS/WhatsApp, ma non collega un
          account SafeMeLink.
        </Text>
        <TextInput
          editable={!contactActionPending}
          style={styles.input}
          placeholder="Nome"
          placeholderTextColor="#687076"
          value={form.name}
          onChangeText={(name) => setForm((current) => ({ ...current, name }))}
        />
        <Text style={styles.channelLabel}>Canale locale preferito</Text>
        <View style={styles.channelRow}>
          {(['sms', 'whatsapp'] as const).map((channel) => (
            <Pressable
              disabled={contactActionPending}
              key={channel}
              onPress={() => setForm((current) => ({ ...current, preferredChannel: channel }))}
              style={[
                styles.channelButton,
                form.preferredChannel === channel && styles.channelButtonSelected,
              ]}>
              <Text
                style={[
                  styles.channelButtonText,
                  form.preferredChannel === channel && styles.channelButtonTextSelected,
                ]}>
                {channel === 'sms' ? 'SMS' : 'WhatsApp'}
              </Text>
            </Pressable>
          ))}
        </View>
        <TextInput
          editable={!contactActionPending}
          style={styles.input}
          placeholder="Numero di telefono"
          placeholderTextColor="#687076"
          keyboardType="phone-pad"
          value={form.phone}
          onChangeText={(phone) => setForm((current) => ({ ...current, phone }))}
        />
        <Pressable
          disabled={contactActionPending}
          style={[styles.primaryButton, contactActionPending && styles.disabledButton]}
          onPress={saveContact}>
          <Text style={styles.primaryButtonText}>
            {editingId ? 'Salva modifiche' : 'Aggiungi contatto'}
          </Text>
        </Pressable>
        {editingId && (
          <Pressable
            disabled={contactActionPending}
            style={styles.secondaryButton}
            onPress={resetForm}>
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
                <Text style={styles.contactMeta}>
                  {contact.userId
                    ? contact.phone
                      ? 'SafeMeLink collegato + numero locale'
                      : 'SafeMeLink collegato'
                    : 'Solo numero locale'}
                  {contact.phone
                    ? ` · Fallback ${contact.preferredChannel === 'whatsapp' ? 'WhatsApp' : 'SMS'}`
                    : ''}
                </Text>
              </View>
              <View style={styles.actions}>
                <Pressable
                  disabled={contactActionPending}
                  style={styles.smallButton}
                  onPress={() => startEdit(contact)}>
                  <Text style={styles.smallButtonText}>Modifica</Text>
                </Pressable>
                <Pressable
                  disabled={contactActionPending}
                  style={styles.dangerButton}
                  onPress={() => deleteContact(contact)}>
                  <Text style={styles.dangerButtonText}>Elimina</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#f7f9fb',
    flex: 1,
  },
  container: {
    backgroundColor: '#f7f9fb',
    flexGrow: 1,
    padding: 20,
    paddingBottom: 96,
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
  channelLabel: {
    color: '#52616b',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  channelRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  sectionHelp: {
    color: '#52616b',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  channelButton: {
    borderColor: '#c8d2da',
    borderRadius: 6,
    borderWidth: 1,
    flex: 1,
    padding: 10,
  },
  channelButtonSelected: {
    backgroundColor: '#0a7ea4',
    borderColor: '#0a7ea4',
  },
  channelButtonText: {
    color: '#52616b',
    fontWeight: '700',
    textAlign: 'center',
  },
  channelButtonTextSelected: {
    color: '#fff',
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
  contactMeta: {
    color: '#687076',
    fontSize: 12,
    marginTop: 4,
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
