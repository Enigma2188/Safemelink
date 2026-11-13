import { useEffect, useState, useSyncExternalStore } from 'react';
import { Alert, AppState, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NetworkMapConnected } from '@/components/network/NetworkMapConnected.native';
import { NetworkEventSocial, type NetworkV2SocialSlots } from '@/components/network/NetworkEventSocial.native';
import type { NetworkV2ScreenController } from '@/components/network/NetworkV2ScreenController';
import { NETWORK_CATEGORY_IDS_V2, NETWORK_CATEGORY_REGISTRY_V2 } from '@/services/NetworkCategoryRegistryV2';
import type { NetworkOperationalMarkerV2 } from '@/services/NetworkMapContractV2';

/** Real native presenter. Backend access is controlled by the app composition and server. */
export function NetworkV2Screen({ runtime, configuration, onClose, socialSlots, mapProvider }: {
  runtime: NetworkV2ScreenController; configuration: 'READY' | 'MISSING'; onClose?: () => void; socialSlots?: NetworkV2SocialSlots;
  mapProvider?: 'PLATFORM_DEFAULT' | 'GOOGLE_ANDROID';
}) {
  const state = useSyncExternalStore(runtime.subscribe, runtime.getState, runtime.getState);
  const { height, width } = useWindowDimensions(); const wide = width >= 1024;
  const [headerHeight, setHeaderHeight] = useState(200), [stageHeight, setStageHeight] = useState(height), [listLimit, setListLimit] = useState(30);
  useEffect(() => {
    runtime.start(); const subscription = AppState.addEventListener('change', value => { if (value === 'active') void runtime.onForeground(); });
    // Owner retains the runtime across navigation, including uncertain writes;
    // Auth subscription remains active until owner.stop/dispose clears private state.
    return () => { subscription.remove(); };
  }, [runtime]);
  const draft = state.draft, locked = draft?.state === 'SUBMITTING' || draft?.state === 'UNKNOWN';
  const choosingPoint = state.panel === 'DRAFT' && !!draft && !draft.locked;
  const expanded = state.panel !== 'NONE' || !state.territory;
  const panelHeight = expanded ? Math.max(140, Math.min(choosingPoint && !draft?.confirmed ? 190 : wide ? 620 : stageHeight * 0.54, stageHeight - headerHeight - 20)) : 100;
  const rows = state.feed.snapshot.markers.filter((marker): marker is NetworkOperationalMarkerV2 => marker.kind === 'OPERATIONAL_EVENT' && state.clusterIds.includes(marker.publicId));
  const button = (label: string, action: () => void, disabled = false) => <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled}
    onPress={action} style={[s.button, disabled && s.disabled]}><Text style={s.buttonText}>{label}</Text></Pressable>;
  const finish = (id: string, kind: 'RESOLVED' | 'WITHDRAWN') => Alert.alert(kind === 'RESOLVED' ? 'Concludere la tua segnalazione?' : 'Ritirare la tua segnalazione?',
    'L’operazione è consentita soltanto all’autore. Il server verifica l’account: il nickname non prova la proprietà.',
    [{ text: 'Annulla', style: 'cancel' }, { text: 'Conferma', onPress: () => { void runtime.finishEvent(id, kind); } }]);
  return <SafeAreaView style={s.root} edges={['top', 'bottom']}><KeyboardAvoidingView style={s.root}
    behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}>
    <View style={s.stage} onLayout={event => setStageHeight(event.nativeEvent.layout.height)}>
      <NetworkMapConnected controller={runtime.map} configuration={configuration} provider={mapProvider} camera={state.camera} selectedPublicId={state.selectedId}
        contentInsets={{ top: headerHeight + 8, bottom: wide ? 16 : panelHeight + 16, right: wide ? 440 : 8, left: 8 }}
        onViewportChange={region => runtime.setViewport(region)} onSelect={selection => { setListLimit(30); runtime.showEvents(selection); }}
        eventDraft={choosingPoint ? { point: draft?.point ?? null, onChoose: point => runtime.chooseEventPoint(point) } : undefined} />
      <View style={[s.header, wide && s.headerWide]} onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}>
        <View style={s.row}><View style={s.flex}><Text style={s.title}>SafeMeLink NETWORK</Text><Text style={s.muted}>{state.territory?.label ?? 'Scegli un territorio autorizzato'}</Text></View>
          {onClose ? button('Chiudi', onClose) : null}</View>
        <Text style={s.muted}>Luoghi degli eventi generalizzati dal server · NETWORK non sostituisce il SOS</Text>
        <View style={s.row}>{button('Cerca territori qui', () => { void runtime.discover(); }, !state.authenticated || state.territoryStatus === 'LOADING' || locked)}
          {button('Aggiorna', () => { if (state.panel === 'OWN') void runtime.showOwn(); else if (state.panel === 'HISTORY') void runtime.showHistory(); else void runtime.refresh(); }, state.panel !== 'OWN' && (!state.territory || state.feed.status === 'LOADING'))}
          {button('I miei invii', () => { void runtime.showOwn(); }, !state.authenticated || locked)}
          {button('Segnala', () => runtime.beginDraft(), !state.territory || !state.authenticated)}</View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          {[1000, 2500, 5000, 10000].map(radius => <Pressable key={radius} accessibilityRole="button" accessibilityLabel={`Raggio ${radius / 1000} km`}
            accessibilityState={{ selected: state.radius === radius }} onPress={() => { void runtime.setFilters({ radius: radius as 1000 | 2500 | 5000 | 10000 }); }} style={[s.chip, state.radius === radius && s.selected]}>
            <Text style={s.body}>{radius === 2500 ? '2,5' : radius / 1000} km</Text></Pressable>)}
          {button('Attive', () => { void runtime.setFilters({ status: 'ACTIVE' }); })}{button('Concluse', () => { void runtime.setFilters({ status: 'RESOLVED' }); })}
          {button('Storico revisionato', () => { void runtime.showHistory(); }, !state.territory || locked)}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          {button('Tutte', () => { void runtime.setFilters({ categoryId: null }); })}
          {NETWORK_CATEGORY_IDS_V2.map(id => <Pressable key={id} accessibilityRole="button" accessibilityState={{ selected: state.categoryId === id }}
            onPress={() => { void runtime.setFilters({ categoryId: state.categoryId === id ? null : id }); }} style={[s.chip, { borderColor: NETWORK_CATEGORY_REGISTRY_V2[id].color }, state.categoryId === id && s.selected]}>
            <Text style={[s.body, { color: NETWORK_CATEGORY_REGISTRY_V2[id].color }]}>{NETWORK_CATEGORY_REGISTRY_V2[id].label}</Text></Pressable>)}
        </ScrollView>
      </View>
      <View accessibilityLabel="Pannello NETWORK V2" style={[s.panel, wide ? s.panelWide : s.panelMobile, { height: panelHeight }]}>
        <View style={s.row}><Text style={[s.title, s.flex]}>{state.panel === 'DRAFT' ? 'Nuova segnalazione' : state.panel === 'DETAIL' ? 'Dettaglio' : state.panel === 'LIST' ? 'Segnalazioni' : state.panel === 'HISTORY' ? 'Storico revisionato' : state.panel === 'OWN' ? 'I miei invii' : 'Territorio'}</Text>
          {expanded && (state.territory || state.panel !== 'NONE') ? button('Mappa', () => runtime.closePanel()) : null}</View>
        <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={s.content}>
          {!state.authenticated ? <Text style={s.body}>Sessione assente o non verificata. Nessun dato NETWORK viene caricato.</Text> : null}
          {state.notice ? <Text accessibilityLiveRegion="polite" style={s.warning}>{state.notice}</Text> : null}
          {state.finish ? <View><Text style={s.warning}>{state.finish.state === 'SENDING' ? 'Verifica chiusura in corso…' : 'Esito chiusura non ancora verificato.'}</Text>
            {button('Riprova la stessa chiusura', () => { if (state.finish) void runtime.finishEvent(state.finish.publicId, state.finish.kind); }, state.finish.state === 'SENDING')}</View> : null}
          {state.feed.status === 'ERROR' ? <View><Text style={s.warning}>Segnalazioni non disponibili ({state.feed.errorCode}). Nessun risultato precedente è mostrato come valido.</Text>
            {button('Riprova caricamento', () => { void runtime.retryFeed(); })}</View> : null}
          {state.panel === 'OWN' ? <>
            <Text style={s.muted}>Metadati privati del tuo account. PENDING non significa pubblicato. Nessuna posizione o testo non approvato viene mostrato sulla mappa.</Text>
            {state.own.phase === 'LOADING' ? <Text style={s.body}>Verifica invii…</Text> : null}
            {state.own.phase === 'READY' && !state.own.rows.length ? <Text style={s.body}>Nessun invio disponibile in questa pagina.</Text> : null}
            {state.own.rows.map(row => <View key={row.publicId} style={s.card}><Text style={s.body}>{NETWORK_CATEGORY_REGISTRY_V2[row.categoryId].label}</Text>
              <Text style={s.muted}>{row.publicationState} · {row.status === 'ACTIVE' ? 'Attiva' : 'Conclusa'} · {new Date(row.createdAt).toLocaleString()}</Text>
              {row.publicationState !== 'WITHDRAWN' ? button('Ritira questo mio invio', () => finish(row.publicId,'WITHDRAWN'), !!state.finish) : null}
              {row.status === 'ACTIVE' && row.publicationState !== 'WITHDRAWN' ? button('Concludi questo mio invio', () => finish(row.publicId,'RESOLVED'), !!state.finish) : null}
            </View>)}
            {state.own.hasMore ? button('Invii precedenti', () => { void runtime.showOwn(true); }, state.own.phase === 'LOADING') : null}
            {button('Rileggi i miei invii', () => { void runtime.showOwn(); }, state.own.phase === 'LOADING')}
          </> : state.panel === 'DRAFT' && draft ? <>
            {!draft.confirmed && !draft.locked ? <>
              <Text style={s.body}>Sposta la mappa e tocca il luogo del problema, anche a distanza. Non viene usato il tuo GPS.</Text>
              {button(draft.point ? 'Conferma questo luogo evento' : 'Tocca un punto sulla mappa', () => runtime.confirmEventPoint(), !draft.point)}
            </> : null}
            {draft.confirmed || draft.locked ? <>
              <Text style={s.muted}>Luogo evento scelto esplicitamente. La posizione pubblica verrà calcolata dal server.</Text>
              <View style={s.wrap}>{NETWORK_CATEGORY_IDS_V2.map(id => <Pressable key={id} accessibilityRole="button" disabled={draft.locked}
                accessibilityState={{ selected: draft.categoryId === id, disabled: draft.locked }} style={[s.chip, draft.categoryId === id && s.selected]}
                onPress={() => runtime.editDraft({ categoryId: id })}><Text style={{ color: NETWORK_CATEGORY_REGISTRY_V2[id].color }}>{NETWORK_CATEGORY_REGISTRY_V2[id].label}</Text></Pressable>)}</View>
              <TextInput accessibilityLabel="Descrizione della segnalazione" placeholder="Descrivi il problema senza dati personali o accuse" placeholderTextColor="#B8CBE0"
                multiline maxLength={500} editable={!draft.locked} value={draft.description} onChangeText={description => runtime.editDraft({ description })} style={s.input} />
              <Text style={s.muted}>{draft.description.length}/500 · minimo 10 caratteri</Text>
              <Text style={s.muted}>La segnalazione resta privata in attesa di moderazione. NETWORK non è un canale di emergenza.</Text>
              {draft.state === 'UNKNOWN' ? <Text style={s.warning}>Esito invio incerto. Non è provato che la segnalazione sia fallita. Verifica lo stesso tentativo, non crearne uno nuovo.</Text> : null}
              {draft.error ? <Text style={s.warning}>{draft.error}</Text> : null}
              {draft.receipt ? <View><Text accessibilityLiveRegion="polite" style={s.body}>{draft.receipt.publicationState === 'PENDING' ? 'Invio ricevuto: PENDING al momento della risposta, in attesa di moderazione. Non è un marker pubblico.' : `Risposta invio: ${draft.receipt.publicationState} · ${draft.receipt.status}. Verifica la visibilità con Aggiorna.`}</Text></View> :
                button(draft.state === 'SUBMITTING' ? 'Invio in corso…' : draft.locked ? 'Verifica lo stesso tentativo' : 'Invia per revisione', () => { void runtime.publishDraft(); },
                  draft.state === 'SUBMITTING' || !draft.confirmed || !draft.categoryId || draft.description.trim().length < 10)}
            </> : null}
            {draft.receipt ? button('Ritira il mio invio', () => finish(draft.receipt!.publicId, 'WITHDRAWN'), !!state.finish) : null}
            {button(draft.state === 'UNKNOWN' || draft.state === 'SUBMITTING' ? 'Torna alla mappa · tentativo conservato' : draft.receipt ? 'Ho letto, torna alla mappa' : 'Annulla bozza', () => runtime.cancelDraft())}
          </> : state.panel === 'HISTORY' ? <>
            <Text style={s.muted}>Schede territoriali revisionate: nessuna archiviazione automatica, nessun autore. Categorie storiche originarie, non convertite nei cinque filtri degli eventi V2.</Text>
            {state.history.phase === 'LOADING' ? <Text style={s.body}>Verifica dello storico autorizzato…</Text> : null}
            {state.history.phase !== 'LOADING' && !state.history.zones.length ? <Text style={s.body}>Nessuna scheda verificata disponibile. Dati insufficienti o accesso non disponibile non significano assenza di eventi.</Text> : null}
            {state.history.zones.map(zone => <View key={zone.zoneId} style={s.card}>
              {button(zone.label, () => { void runtime.openHistoryZone(zone.zoneId); }, state.history.phase === 'LOADING' || zone.availability !== 'PUBLISHED')}
              {zone.availability === 'INSUFFICIENT_DATA' ? <Text style={s.muted}>Dati insufficienti per la pubblicazione.</Text> : null}
            </View>)}
            {state.history.page?.availability === 'INSUFFICIENT_DATA' ? <Text style={s.body}>Nessuna scheda revisionata pubblicabile per questa zona.</Text> : null}
            {state.history.page?.entries.map(entry => <View key={entry.entryId} style={s.card}>
              <Text style={s.body}>{entry.summary}</Text><Text style={s.muted}>Conclusa · mese {entry.month.slice(0,7)} · categoria originaria {entry.category}</Text>
            </View>)}
            {state.history.page?.nextCursor && state.history.zoneId ? button('Pagina successiva dello storico', () => { if (state.history.zoneId) void runtime.openHistoryZone(state.history.zoneId, true); }) : null}
            {button('Aggiorna storico', () => { void runtime.showHistory(); }, state.history.phase === 'LOADING')}
          </> : state.panel === 'DETAIL' ? <>
            {state.detailStatus === 'LOADING' ? <Text style={s.body}>Verifica del dettaglio autorizzato…</Text> : null}
            {state.detail ? <>
              <Text style={s.title}>{NETWORK_CATEGORY_REGISTRY_V2[state.detail.marker.categoryId].label} · {state.detail.marker.status === 'ACTIVE' ? 'Attiva' : 'Conclusa'}</Text>
              <View style={s.row}><View style={s.avatar}><Text style={s.body}>{state.detail.authorNickname.slice(0, 1)}</Text></View><Text style={s.body}>{state.detail.authorNickname}</Text></View>
              <Text style={s.body}>{state.detail.description}</Text><Text style={s.muted}>{new Date(state.detail.marker.createdAt).toLocaleString()}</Text>
              <NetworkEventSocial detail={state.detail} slots={socialSlots} />
              {state.detail.marker.status === 'ACTIVE' ? button('Concludi la mia segnalazione', () => finish(state.detail!.marker.publicId, 'RESOLVED'), !!state.finish) : null}
              {button('Ritira la mia segnalazione', () => finish(state.detail!.marker.publicId, 'WITHDRAWN'), !!state.finish)}
            </> : state.detailStatus !== 'LOADING' ? <Text style={s.muted}>Dettaglio non disponibile. Aggiorna prima di riprovare.</Text> : null}
          </> : state.panel === 'LIST' ? <>
            {!rows.length ? <Text style={s.body}>Nessuna segnalazione disponibile nella selezione.</Text> : rows.slice(0, listLimit).map(marker => <Pressable key={marker.publicId} accessibilityRole="button"
              accessibilityLabel={`Apri dettaglio ${NETWORK_CATEGORY_REGISTRY_V2[marker.categoryId].label}`} onPress={() => { void runtime.openDetail(marker.publicId); }} style={s.card}>
              <Text style={[s.body, { color: NETWORK_CATEGORY_REGISTRY_V2[marker.categoryId].color }]}>{NETWORK_CATEGORY_REGISTRY_V2[marker.categoryId].label}</Text>
              <Text style={s.muted}>{marker.status === 'ACTIVE' ? 'Attiva' : 'Conclusa'} · {new Date(marker.createdAt).toLocaleString()}</Text>
            </Pressable>)}
            {rows.length > listLimit ? button('Mostra altre segnalazioni', () => setListLimit(value => value + 30)) : null}
          </> : !state.territory ? <>
            <Text style={s.body}>{state.territoryStatus === 'LOADING' ? 'Caricamento territori autorizzati…' : state.territoryStatus === 'EMPTY' ? 'Nessun territorio disponibile qui. Sposta la mappa e cerca di nuovo.' : 'Sposta la mappa e cerca, poi scegli un territorio.'}</Text>
            {state.territories.map(territory => <Pressable key={territory.territoryId} accessibilityRole="button" onPress={() => { void runtime.chooseTerritory(territory.territoryId); }} style={s.card}>
              <Text style={s.body}>{territory.label}</Text><Text style={s.muted}>{territory.geometrySource} · {territory.geometryLicense}</Text>
            </Pressable>)}
            {state.hasMoreTerritories ? button('Altri territori', () => { void runtime.discover(true); }) : null}
          </> : <View style={s.row}><Text style={[s.body, s.flex]}>{state.feed.status === 'LOADING' ? 'Caricamento segnalazioni…' : `${state.feed.snapshot.markers.length} segnalazioni disponibili`}</Text>
            {button('Elenco', () => { setListLimit(30); runtime.showEvents(); })}</View>}
        </ScrollView>
      </View>
    </View>
  </KeyboardAvoidingView></SafeAreaView>;
}
const s = StyleSheet.create({ root: { flex: 1, backgroundColor: '#061B36' }, stage: { flex: 1, overflow: 'hidden' }, flex: { flex: 1, minWidth: 0 },
  header: { position: 'absolute', top: 8, left: 12, right: 12, padding: 10, borderRadius: 18, gap: 7, backgroundColor: '#08233FF2' }, headerWide: { right: 440 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }, wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  title: { color: '#F4F8FD', fontSize: 18, fontWeight: '800', lineHeight: 25 }, body: { color: '#E2ECF6', fontSize: 15, lineHeight: 23 }, muted: { color: '#B8CBE0', fontSize: 12, lineHeight: 18 },
  button: { minHeight: 44, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, backgroundColor: '#BDE9FF' },
  buttonText: { color: '#061B36', fontSize: 13, fontWeight: '700' }, disabled: { opacity: 0.5 }, chips: { gap: 7 },
  chip: { minHeight: 44, padding: 10, borderWidth: 1, borderColor: '#527B9D', borderRadius: 16, justifyContent: 'center', backgroundColor: '#123957' }, selected: { borderColor: '#FFFFFF', borderWidth: 2 },
  panel: { position: 'absolute', padding: 12, borderRadius: 18, backgroundColor: '#08233FF5', borderWidth: 1, borderColor: '#527B9D' }, panelMobile: { left: 10, right: 10, bottom: 8 }, panelWide: { right: 20, bottom: 20, width: 400 },
  content: { gap: 12, paddingTop: 10, paddingBottom: 20 }, warning: { color: '#FFE2A3', fontSize: 14, lineHeight: 21 },
  card: { padding: 12, gap: 6, borderRadius: 12, backgroundColor: '#123957', minHeight: 64 },
  input: { minHeight: 90, maxHeight: 180, textAlignVertical: 'top', padding: 10, borderRadius: 12, borderWidth: 1, borderColor: '#638AAA', color: '#F4F8FD', fontSize: 16 },
  avatar: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', backgroundColor: '#234C69' } });
