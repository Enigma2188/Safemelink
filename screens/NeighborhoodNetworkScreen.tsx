import { Ionicons } from '@expo/vector-icons';
import { type Href, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/backend/auth/AuthProvider';
import { KeyboardSafeScrollView as ScrollView, KeyboardSafeTextInput as TextInput } from '@/components/KeyboardSafeForm';
import type { Database } from '@/backend/database.types';
import { NeighborhoodNetworkService } from '@/services/NeighborhoodNetworkService';

type Overview = Database['public']['Functions']['get_my_neighborhood_overview']['Returns'][number];
type Member = Database['public']['Functions']['list_my_neighborhood_members']['Returns'][number];
type Invitation = Database['public']['Functions']['list_my_neighborhood_invitations']['Returns'][number];
type InviteToken = Database['public']['Functions']['generate_my_neighborhood_invite_token']['Returns'][number];
type Discussion = Database['public']['Functions']['list_my_neighborhood_discussions']['Returns'][number];
type NeighborhoodMessage = Database['public']['Functions']['list_neighborhood_messages']['Returns'][number];

type ScreenData = {
  network: Overview | null;
  members: Member[];
  invitations: Invitation[];
  discoveryOptIn: boolean;
  discussions: Discussion[];
};

const EMPTY_DATA: ScreenData = { network: null, members: [], invitations: [], discoveryOptIn: false, discussions: [] };

export function NeighborhoodNetworkScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const mountedRef = useRef(true);
  const accountRef = useRef(userId);
  accountRef.current = userId;
  const requestRef = useRef(0);
  const sessionGenerationRef = useRef(0);
  const actionSequenceRef = useRef(0);
  const actionRef = useRef<number | null>(null);
  const presenceRefreshRef = useRef<string | null>(null);
  const [data, setData] = useState<ScreenData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [networkName, setNetworkName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [myInviteToken, setMyInviteToken] = useState<InviteToken | null>(null);
  const [discussionTitle, setDiscussionTitle] = useState('');
  const [discussionCategory, setDiscussionCategory] = useState<'Sicurezza' | 'Aiuto' | 'Informazioni' | 'Altro'>('Informazioni');
  const [selectedDiscussionId, setSelectedDiscussionId] = useState<string | null>(null);
  const [discussionMessages, setDiscussionMessages] = useState<NeighborhoodMessage[]>([]);
  const [messageDraft, setMessageDraft] = useState('');
  const [activeTab, setActiveTab] = useState<'chat' | 'members' | 'invites'>('chat');

  const load = useCallback(async (showSpinner = true) => {
    const requestedUserId = userId;
    const requestedGeneration = sessionGenerationRef.current;
    const requestId = ++requestRef.current;
    if (!requestedUserId) {
      setData(EMPTY_DATA);
      setLoading(false);
      return;
    }
    if (showSpinner) setLoading(true);
    try {
      const next = await NeighborhoodNetworkService.load();
      if (
        mountedRef.current
        && accountRef.current === requestedUserId
        && sessionGenerationRef.current === requestedGeneration
        && requestRef.current === requestId
      ) setData(next);
    } catch (error) {
      if (
        mountedRef.current
        && accountRef.current === requestedUserId
        && sessionGenerationRef.current === requestedGeneration
        && requestRef.current === requestId
      ) {
        setMessage(error instanceof Error ? error.message : 'Impossibile caricare la rete.');
      }
    } finally {
      if (
        mountedRef.current
        && accountRef.current === requestedUserId
        && sessionGenerationRef.current === requestedGeneration
        && requestRef.current === requestId
      ) setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    mountedRef.current = true;
    sessionGenerationRef.current += 1;
    actionRef.current = null;
    setBusy(false);
    setMessage(null);
    setData(EMPTY_DATA);
    setNetworkName('');
    setInviteCode('');
    setMyInviteToken(null);
    setDiscussionTitle('');
    setSelectedDiscussionId(null);
    setDiscussionMessages([]);
    setMessageDraft('');
    setActiveTab('chat');
    presenceRefreshRef.current = null;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
      sessionGenerationRef.current += 1;
      actionRef.current = null;
    };
  }, [load]);

  useFocusEffect(useCallback(() => {
    presenceRefreshRef.current = null;
    void load();
  }, [load]));

  useEffect(() => {
    if (!userId || !data.discoveryOptIn || loading || presenceRefreshRef.current === userId) return;
    presenceRefreshRef.current = userId;
    void NeighborhoodNetworkService.refreshDiscoveryPresence(userId).catch(() => {
      if (mountedRef.current && accountRef.current === userId) {
        setMessage('Disponibilità attiva, ma posizione non aggiornata. Riapri la schermata e riprova.');
      }
    });
  }, [data.discoveryOptIn, loading, userId]);

  const runAction = useCallback(async <T,>(
    operation: () => Promise<T>,
    success: string,
    onSuccess?: (result: T) => void,
  ) => {
    if (actionRef.current !== null) return;
    const actionUserId = userId;
    if (!actionUserId) {
      setMessage('Accedi per completare questa operazione.');
      return;
    }
    const actionGeneration = sessionGenerationRef.current;
    const operationId = ++actionSequenceRef.current;
    actionRef.current = operationId;
    setBusy(true);
    setMessage(null);
    try {
      const result = await operation();
      if (
        !mountedRef.current
        || accountRef.current !== actionUserId
        || sessionGenerationRef.current !== actionGeneration
        || actionRef.current !== operationId
      ) return;
      onSuccess?.(result);
      setMessage(success);
      await load(false);
    } catch (error) {
      if (
        mountedRef.current
        && accountRef.current === actionUserId
        && sessionGenerationRef.current === actionGeneration
        && actionRef.current === operationId
      ) {
        setMessage(error instanceof Error ? error.message : 'Operazione non riuscita. Riprova.');
        void load(false);
      }
    } finally {
      if (
        mountedRef.current
        && accountRef.current === actionUserId
        && sessionGenerationRef.current === actionGeneration
        && actionRef.current === operationId
      ) {
        actionRef.current = null;
        setBusy(false);
      }
    }
  }, [load, userId]);

  const createNetwork = () => void runAction(
    () => NeighborhoodNetworkService.create(networkName),
    'Rete di quartiere creata.',
    () => setNetworkName(''),
  );

  const sendInvitation = () => {
    if (!data.network) return;
    void runAction(
      () => NeighborhoodNetworkService.invite(data.network!.network_id, inviteCode),
      'Invito inviato.',
      () => setInviteCode(''),
    );
  };

  const generateInviteToken = () => void runAction(
    () => NeighborhoodNetworkService.generateInviteToken(),
    'Codice temporaneo generato. Condividilo soltanto con la persona che deve invitarti.',
    setMyInviteToken,
  );

  const toggleDiscovery = (enabled: boolean) => {
    if (!userId) return;
    if (enabled) presenceRefreshRef.current = userId;
    else presenceRefreshRef.current = null;
    void runAction(
      async () => {
        try {
          await NeighborhoodNetworkService.setDiscoveryPreference(userId, enabled);
        } catch (error) {
          presenceRefreshRef.current = null;
          throw error;
        }
      },
      enabled ? 'Disponibilità agli inviti attivata.' : 'Disponibilità agli inviti disattivata.',
    );
  };

  const inviteNearby = () => {
    if (!userId || !data.network) return;
    void runAction(
      () => NeighborhoodNetworkService.inviteNearby(userId, data.network!.network_id),
      'Ricerca completata. Eventuali inviti sono stati inviati alle persone disponibili nelle vicinanze.',
    );
  };

  const openDiscussion = async (discussion: Discussion) => {
    setSelectedDiscussionId(discussion.discussion_id);
    try {
      const messages = await NeighborhoodNetworkService.listMessages(discussion.discussion_id);
      if (mountedRef.current && accountRef.current === userId) setDiscussionMessages(messages);
    } catch (error) {
      if (mountedRef.current) setMessage(error instanceof Error ? error.message : 'Impossibile caricare i messaggi.');
    }
  };

  const createDiscussion = () => {
    if (!data.network) return;
    void runAction(
      () => NeighborhoodNetworkService.createDiscussion(data.network!.network_id, discussionTitle, discussionCategory),
      'Discussione creata.',
      () => setDiscussionTitle(''),
    );
  };

  const sendDiscussionMessage = async () => {
    if (!selectedDiscussionId || !messageDraft.trim() || busy) return;
    const discussionId = selectedDiscussionId;
    const text = messageDraft;
    await runAction(
      () => NeighborhoodNetworkService.createMessage(discussionId, text),
      'Messaggio inviato.',
      () => setMessageDraft(''),
    );
    try {
      const messages = await NeighborhoodNetworkService.listMessages(discussionId);
      if (mountedRef.current && accountRef.current === userId) setDiscussionMessages(messages);
    } catch { /* the success feedback remains visible; a later refresh can reload messages */ }
  };

  const closeSelectedDiscussion = (discussion: Discussion) => {
    void runAction(
      () => NeighborhoodNetworkService.closeDiscussion(discussion.discussion_id),
      'Discussione chiusa.',
      () => setSelectedDiscussionId(null),
    );
  };

  const confirmLeave = () => {
    if (!data.network) return;
    const isAdmin = data.network.my_role === 'admin';
    Alert.alert(
      isAdmin ? 'Eliminare la rete?' : 'Lasciare la rete?',
      isAdmin
        ? 'Puoi eliminare la rete soltanto dopo aver rimosso gli altri membri.'
        : 'Non farai più parte di questa Rete di quartiere.',
      [
        { text: 'Annulla', style: 'cancel' },
        {
          text: isAdmin ? 'Elimina' : 'Lascia',
          style: 'destructive',
          onPress: () => void runAction(
            () => NeighborhoodNetworkService.leave(data.network!.network_id),
            isAdmin ? 'Rete eliminata.' : 'Hai lasciato la rete.',
          ),
        },
      ],
    );
  };

  const openMenu = () => Alert.alert('Rete di quartiere', undefined, [
    { text: 'Chat', onPress: () => setActiveTab('chat') },
    { text: 'Membri', onPress: () => setActiveTab('members') },
    { text: 'Inviti', onPress: () => setActiveTab('invites') },
    { text: 'Aggiorna', onPress: () => void load() },
    { text: 'Annulla', style: 'cancel' },
  ]);

  const received = data.invitations.filter((item) => item.direction === 'received');
  const sent = data.invitations.filter((item) => item.direction === 'sent');
  const isAdmin = data.network?.my_role === 'admin';

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Torna indietro"
          accessibilityRole="button"
          hitSlop={12}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
          style={styles.iconButton}>
          <Ionicons color="#3656A3" name="arrow-back" size={24} />
        </Pressable>
        <Text style={styles.headerTitle}>Rete di quartiere</Text>
        <Pressable
          accessibilityLabel="Apri menu Rete di quartiere"
          accessibilityRole="button"
          disabled={busy || loading}
          hitSlop={12}
          onPress={openMenu}
          style={styles.iconButton}>
          <Ionicons color="#3656A3" name="ellipsis-vertical" size={24} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <ScrollView
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          contentContainerStyle={styles.content}
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor="#45B7FF" />}>
          <View style={styles.hero}>
            <Ionicons color="#45B7FF" name="home-outline" size={42} />
            <Text style={styles.title}>La tua comunità privata</Text>
            <Text style={styles.subtitle}>
              Crea un gruppo controllato con persone che conosci. Sono visibili soltanto i nickname.
            </Text>
          </View>

          {message ? (
            <View accessibilityLiveRegion="polite" style={styles.messageCard}>
              <Text style={styles.messageText}>{message}</Text>
              <Pressable accessibilityLabel="Chiudi messaggio" onPress={() => setMessage(null)}>
                <Ionicons color="#C8D5EC" name="close" size={20} />
              </Pressable>
            </View>
          ) : null}

          {!userId ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Accedi per continuare</Text>
              <Text style={styles.body}>La Rete di quartiere è disponibile soltanto per account autenticati.</Text>
              <PrimaryButton disabled={false} label="ACCEDI" onPress={() => router.push('/login' as Href)} />
            </View>
          ) : null}

          {userId && !loading && (!data.network || activeTab === 'invites') ? (
            <Section title="Inviti da reti vicine">
              <Text style={styles.body}>
                Se scegli di renderti disponibile, potrai ricevere inviti da Reti di quartiere vicine. La posizione è approssimata, privata e aggiornata solo quando apri questa schermata.
              </Text>
              <View style={styles.preferenceRow}>
                <Text style={styles.itemTitle}>Disponibile agli inviti</Text>
                <Switch
                  accessibilityLabel="Disponibile agli inviti da reti vicine"
                  disabled={busy}
                  onValueChange={toggleDiscovery}
                  value={data.discoveryOptIn}
                />
              </View>
              <Text style={styles.itemMeta}>Puoi disattivare questa scelta in qualsiasi momento.</Text>
            </Section>
          ) : null}

          {userId && received.length > 0 && (!data.network || activeTab === 'invites') ? (
            <Section title="Inviti ricevuti">
              {received.map((invitation) => (
                <View key={invitation.invitation_id} style={styles.listItem}>
                  <View style={styles.listText}>
                    <Text style={styles.itemTitle}>{invitation.network_name}</Text>
                    <Text style={styles.itemMeta}>
                      {invitation.invitation_source === 'NEARBY'
                        ? 'Una Rete di quartiere vicina ti invita a partecipare.'
                        : `Invito di ${invitation.counterpart_nickname}`}
                    </Text>
                  </View>
                  <View style={styles.inlineActions}>
                    <SmallButton
                      disabled={busy}
                      label="RIFIUTA"
                      onPress={() => void runAction(
                        () => NeighborhoodNetworkService.respond(invitation.invitation_id, false),
                        'Invito rifiutato.',
                      )}
                    />
                    <SmallButton
                      accent
                      disabled={busy || Boolean(data.network)}
                      label="ACCETTA"
                      onPress={() => void runAction(
                        () => NeighborhoodNetworkService.respond(invitation.invitation_id, true),
                        'Invito accettato.',
                      )}
                    />
                  </View>
                </View>
              ))}
              {data.network ? (
                <Text style={styles.hint}>Per accettare un altro invito devi prima lasciare la rete attuale.</Text>
              ) : null}
            </Section>
          ) : null}

          {userId && !data.network && !loading ? (
            <>
              <Section title="Fatti invitare">
                <Text style={styles.body}>
                  Genera un codice temporaneo e comunicalo volontariamente all’amministratore della rete.
                </Text>
                {myInviteToken ? (
                  <View style={styles.tokenCard}>
                    <Text selectable style={styles.tokenText}>{myInviteToken.invite_token}</Text>
                    <Text style={styles.itemMeta}>
                      Valido fino al {new Date(myInviteToken.expires_at).toLocaleString('it-IT')} e utilizzabile una sola volta.
                    </Text>
                  </View>
                ) : null}
                <PrimaryButton disabled={busy} label="GENERA CODICE INVITO" onPress={generateInviteToken} />
              </Section>
              <Section title="Crea una rete">
                <Text style={styles.body}>
                  Il creatore diventa amministratore. Nell’MVP puoi appartenere a una sola rete alla volta.
                </Text>
                <TextInput
                  accessibilityLabel="Nome della Rete di quartiere"
                  autoCapitalize="sentences"
                  editable={!busy}
                  maxLength={60}
                  onChangeText={setNetworkName}
                  placeholder="Es. Quartiere Centro"
                  placeholderTextColor="#71809D"
                  style={styles.input}
                  value={networkName}
                />
                <PrimaryButton disabled={busy || networkName.trim().length < 3} label="CREA RETE" onPress={createNetwork} />
              </Section>
            </>
          ) : null}

          {data.network ? (
            <>
              <View style={styles.networkCard}>
                <Text style={styles.networkName}>{data.network.network_name}</Text>
                <Text style={styles.itemMeta}>
                  {isAdmin ? 'Amministratore' : 'Membro'} · {data.network.member_count} membri
                </Text>
              </View>

              {activeTab !== 'chat' ? <Pressable accessibilityRole="button" onPress={() => setActiveTab('chat')} style={styles.backToChat}><Ionicons color="#3656A3" name="arrow-back" size={18} /><Text style={styles.backToChatText}>Torna alle discussioni</Text></Pressable> : null}

              {activeTab === 'members' ? <Section title="Membri">
                {data.members.map((member) => (
                  <View key={member.membership_id} style={styles.listItem}>
                    <View style={styles.avatar}><Ionicons color="#7BCBFF" name="person" size={18} /></View>
                    <View style={styles.listText}>
                      <Text style={styles.itemTitle}>{member.nickname}</Text>
                      <Text style={styles.itemMeta}>
                        {member.member_role === 'admin' ? 'Amministratore' : 'Membro'}{member.is_me ? ' · Tu' : ''}
                      </Text>
                    </View>
                    {isAdmin && member.member_role === 'member' ? (
                      <SmallButton
                        disabled={busy}
                        label="RIMUOVI"
                        onPress={() => Alert.alert(
                          'Rimuovere il membro?',
                          `${member.nickname} non farà più parte della rete.`,
                          [
                            { text: 'Annulla', style: 'cancel' },
                            {
                              text: 'Rimuovi',
                              style: 'destructive',
                              onPress: () => void runAction(
                                () => NeighborhoodNetworkService.removeMember(data.network!.network_id, member.membership_id),
                                'Membro rimosso.',
                              ),
                            },
                          ],
                        )}
                      />
                    ) : null}
                  </View>
                ))}
              </Section> : null}

              {isAdmin && activeTab === 'invites' ? (
                <Section title="Invita utenti Safe vicini">
                  <Text style={styles.body}>Cerca una volta le persone che hanno scelto di ricevere inviti entro circa 500 metri. Non vedrai nomi, posizioni o il numero di persone trovate.</Text>
                  <PrimaryButton disabled={busy} label={busy ? 'RICERCA IN CORSO…' : 'INVITA UTENTI SAFE VICINI'} onPress={inviteNearby} />
                  <Text style={styles.itemMeta}>Per tutelare la privacy, puoi ripetere la ricerca dopo 30 minuti.</Text>
                </Section>
              ) : null}

              {isAdmin && activeTab === 'invites' ? (
                <Section title="Invita con codice">
                  <Text style={styles.body}>Inserisci il codice temporaneo NQ-… che la persona ha scelto di condividere. Non usare il codice pubblico del profilo.</Text>
                  <TextInput
                    accessibilityLabel="Codice temporaneo Rete di quartiere"
                    autoCapitalize="characters"
                    autoCorrect={false}
                    editable={!busy}
                    maxLength={35}
                    onChangeText={setInviteCode}
                    placeholder="NQ-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                    placeholderTextColor="#71809D"
                    style={styles.input}
                    value={inviteCode}
                  />
                  <PrimaryButton disabled={busy || inviteCode.trim().length === 0} label="INVIA INVITO" onPress={sendInvitation} />
                  {sent.map((invitation) => (
                    <View key={invitation.invitation_id} style={styles.listItem}>
                      <View style={styles.listText}>
                        <Text style={styles.itemTitle}>{invitation.counterpart_nickname}</Text>
                        <Text style={styles.itemMeta}>Invito in attesa</Text>
                      </View>
                      <SmallButton
                        disabled={busy}
                        label="ANNULLA"
                        onPress={() => void runAction(
                          () => NeighborhoodNetworkService.cancelInvitation(invitation.invitation_id),
                          'Invito annullato.',
                        )}
                      />
                    </View>
                  ))}
                </Section>
              ) : null}

              {activeTab === 'chat' ? <Section title="Discussioni">
                <Text style={styles.body}>Parla per argomenti con i membri della tua rete. Sono visibili solo nickname e messaggi, mai email, telefoni o coordinate.</Text>
                <TextInput
                  accessibilityLabel="Titolo nuova discussione"
                  autoCapitalize="sentences"
                  editable={!busy}
                  maxLength={100}
                  onChangeText={setDiscussionTitle}
                  placeholder="Es. Illuminazione della strada"
                  placeholderTextColor="#71809D"
                  style={styles.input}
                  value={discussionTitle}
                />
                <View style={styles.categoryRow}>
                  {(['Sicurezza', 'Aiuto', 'Informazioni', 'Altro'] as const).map((category) => (
                    <Pressable key={category} accessibilityRole="button" disabled={busy} onPress={() => setDiscussionCategory(category)} style={[styles.categoryChip, discussionCategory === category && styles.categoryChipActive]}>
                      <Text style={[styles.categoryText, discussionCategory === category && styles.categoryTextActive]}>{category}</Text>
                    </Pressable>
                  ))}
                </View>
                <PrimaryButton disabled={busy || discussionTitle.trim().length < 3} label="NUOVO ARGOMENTO" onPress={createDiscussion} />
                {data.discussions.map((discussion) => {
                  const selected = discussion.discussion_id === selectedDiscussionId;
                  return (
                    <View key={discussion.discussion_id} style={styles.discussionItem}>
                      <Pressable accessibilityRole="button" onPress={() => void openDiscussion(discussion)} style={styles.discussionHeader}>
                        <View style={styles.listText}>
                          <Text style={styles.itemTitle}>{discussion.title}{discussion.is_general ? ' · Generale' : ''}</Text>
                          <Text style={styles.itemMeta}>{discussion.category} · {discussion.message_count} messaggi · {new Date(discussion.updated_at).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}</Text>
                          {discussion.last_message ? <Text numberOfLines={2} style={styles.itemMeta}>{discussion.last_message}</Text> : null}
                        </View>
                        <Ionicons color="#7BCBFF" name={selected ? 'chevron-up' : 'chevron-forward'} size={20} />
                      </Pressable>
                      {selected ? (
                        <View style={styles.chatBox}>
                          {discussionMessages.map((item) => {
                            const ownMessage = item.author_nickname === data.members.find((member) => member.is_me)?.nickname;
                            return <View key={item.message_id} style={[styles.chatMessage, ownMessage ? styles.chatMessageOwn : styles.chatMessageOther]}><Text style={styles.chatAuthor}>{item.author_nickname}</Text><Text style={ownMessage ? styles.chatBodyOwn : styles.chatBodyOther}>{item.body}</Text><Text style={styles.chatTime}>{new Date(item.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</Text></View>;
                          })}
                          {discussion.status === 'open' ? (
                            <>
                              <TextInput accessibilityLabel="Nuovo messaggio" editable={!busy} maxLength={2000} multiline onChangeText={setMessageDraft} placeholder="Scrivi un messaggio" placeholderTextColor="#71809D" style={styles.input} value={messageDraft} />
                              <PrimaryButton disabled={busy || !messageDraft.trim()} label="INVIA MESSAGGIO" onPress={() => void sendDiscussionMessage()} />
                            </>
                          ) : <Text style={styles.hint}>Discussione chiusa.</Text>}
                          {discussion.can_close && discussion.status === 'open' ? <SmallButton disabled={busy} label="CHIUDI DISCUSSIONE" onPress={() => closeSelectedDiscussion(discussion)} /> : null}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </Section> : null}

              <Pressable
                accessibilityRole="button"
                disabled={busy || Boolean(isAdmin && data.network.member_count > 1)}
                onPress={confirmLeave}
                style={[styles.leaveButton, (busy || (isAdmin && data.network.member_count > 1)) && styles.disabled]}>
                <Text style={styles.leaveText}>{isAdmin ? 'ELIMINA RETE' : 'ESCI DALLA RETE'}</Text>
              </Pressable>
              {isAdmin && data.network.member_count > 1 ? (
                <Text style={styles.hint}>Per eliminare la rete devi prima rimuovere gli altri membri.</Text>
              ) : null}
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Section({ children, title }: { children: ReactNode; title: string }) {
  return <View style={styles.card}><Text style={styles.cardTitle}>{title}</Text>{children}</View>;
}

function PrimaryButton({ disabled, label, onPress }: { disabled: boolean; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.primaryButton, disabled && styles.disabled]}><Text style={styles.primaryText}>{label}</Text></Pressable>;
}

function SmallButton({ accent, disabled, label, onPress }: { accent?: boolean; disabled: boolean; label: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[styles.smallButton, accent && styles.smallAccent, disabled && styles.disabled]}><Text style={[styles.smallText, accent && styles.smallAccentText]}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F7F9FC' },
  flex: { flex: 1 },
  header: { minHeight: 58, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FFFFFF', borderBottomColor: '#E3E8F0', borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { color: '#18243D', fontSize: 20, fontWeight: '700' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 18, paddingBottom: 48, gap: 16 },
  hero: { alignItems: 'center', gap: 6, paddingVertical: 10 },
  title: { color: '#18243D', fontSize: 23, fontWeight: '800', textAlign: 'center' },
  subtitle: { color: '#5D6A82', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  card: { backgroundColor: '#FFFFFF', borderColor: '#E1E6EF', borderWidth: 1, borderRadius: 14, padding: 14, gap: 10 },
  cardTitle: { color: '#18243D', fontSize: 18, fontWeight: '700' },
  body: { color: '#526078', fontSize: 14, lineHeight: 21 },
  input: { minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: '#CBD5E4', color: '#18243D', paddingHorizontal: 14, backgroundColor: '#FFFFFF' },
  primaryButton: { minHeight: 48, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#3656A3', paddingHorizontal: 16 },
  primaryText: { color: '#FFFFFF', fontWeight: '800', letterSpacing: 0.4 },
  disabled: { opacity: 0.45 },
  messageCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#EEF3FF', borderRadius: 12, padding: 13 },
  messageText: { color: '#263A68', flex: 1, lineHeight: 20 },
  networkCard: { borderRadius: 14, padding: 14, backgroundColor: '#EEF3FF', borderColor: '#CFDAF4', borderWidth: 1 },
  networkName: { color: '#1B2F68', fontSize: 20, fontWeight: '800', marginBottom: 5 },
  listItem: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopColor: '#E3E8F0', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 },
  listText: { flex: 1 },
  itemTitle: { color: '#202D46', fontSize: 15, fontWeight: '700' },
  itemMeta: { color: '#71809A', fontSize: 13, marginTop: 3 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E7EEFF' },
  inlineActions: { flexDirection: 'row', gap: 7 },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  categoryChip: { borderWidth: 1, borderColor: '#CBD5E4', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 8 },
  categoryChipActive: { backgroundColor: '#E8EEFF', borderColor: '#6B83C5' },
  categoryText: { color: '#65738B', fontSize: 12, fontWeight: '700' },
  categoryTextActive: { color: '#27458F' },
  discussionItem: { borderTopColor: '#E3E8F0', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, gap: 8 },
  discussionHeader: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 8 },
  chatBox: { gap: 9, paddingTop: 4 },
  chatMessage: { maxWidth: '86%', borderRadius: 14, padding: 10, gap: 3 },
  chatMessageOther: { alignSelf: 'flex-start', backgroundColor: '#FFFFFF', borderColor: '#E0E6EF', borderWidth: 1, borderBottomLeftRadius: 4 },
  chatMessageOwn: { alignSelf: 'flex-end', backgroundColor: '#DCE8FF', borderColor: '#C5D6FA', borderWidth: 1, borderBottomRightRadius: 4 },
  chatAuthor: { color: '#3656A3', fontSize: 12, fontWeight: '700' },
  chatBodyOther: { color: '#25324A', fontSize: 15, lineHeight: 21 },
  chatBodyOwn: { color: '#182C62', fontSize: 15, lineHeight: 21 },
  chatTime: { color: '#7A879B', fontSize: 10, textAlign: 'right' },
  preferenceRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  smallButton: { minHeight: 40, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1, borderColor: '#CBD5E4', alignItems: 'center', justifyContent: 'center' },
  smallAccent: { backgroundColor: '#3656A3', borderColor: '#3656A3' },
  smallText: { color: '#526078', fontSize: 11, fontWeight: '800' },
  smallAccentText: { color: '#FFFFFF' },
  hint: { color: '#9A6B11', fontSize: 13, lineHeight: 18 },
  tokenCard: { borderRadius: 12, backgroundColor: '#F0F5FF', padding: 13, gap: 5 },
  tokenText: { color: '#3656A3', fontSize: 14, fontWeight: '800', letterSpacing: 0.4 },
  backToChat: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 7 },
  backToChatText: { color: '#3656A3', fontWeight: '700' },
  leaveButton: { minHeight: 48, borderWidth: 1, borderColor: '#A94255', borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  leaveText: { color: '#FF8397', fontWeight: '800' },
});
