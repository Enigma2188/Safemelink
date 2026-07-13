import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ContactsService, type TrustedContact } from '@/services/ContactsService';

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

  const loadContacts = useCallback(async () => {
    try {
      setContacts(await ContactsService.list());
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

  const canAddContact = contacts.length < ContactsService.maxContacts || Boolean(editingId);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Contatti fidati</Text>
        <Text style={styles.subtitle}>Puoi salvare fino a 3 contatti per il modulo SOS.</Text>
      </View>

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
        <Pressable
          disabled={!canAddContact}
          style={[styles.primaryButton, !canAddContact && styles.disabledButton]}
          onPress={saveContact}>
          <Text style={styles.primaryButtonText}>
            {editingId ? 'Salva modifiche' : 'Aggiungi contatto'}
          </Text>
        </Pressable>
        {editingId && (
          <Pressable style={styles.secondaryButton} onPress={resetForm}>
            <Text style={styles.secondaryButtonText}>Annulla modifica</Text>
          </Pressable>
        )}
        {!canAddContact && (
          <Text style={styles.limitText}>Hai gia salvato 3 contatti fidati.</Text>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Contatti salvati ({contacts.length}/3)</Text>
        {contacts.length === 0 ? (
          <Text style={styles.emptyText}>Nessun contatto salvato.</Text>
        ) : (
          contacts.map((contact) => (
            <View key={contact.id} style={styles.contactRow}>
              <View style={styles.contactInfo}>
                <Text style={styles.contactName}>{contact.name}</Text>
                <Text style={styles.contactPhone}>{contact.phone}</Text>
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
  limitText: {
    color: '#687076',
    fontSize: 13,
    marginTop: 10,
    textAlign: 'center',
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
