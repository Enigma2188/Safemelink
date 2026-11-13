import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NetworkPrototypeMap, NETWORK_PROTOTYPE_ICONS } from '@/components/NetworkPrototypeMap';
import { buildNetworkPrototypeActivity } from '@/components/NetworkPrototypeActivity';
import { NetworkPrototypeConversation, appendNetworkDemoComment, seedNetworkDemoComments } from '@/components/NetworkPrototypeConversation';
import { NETWORK_CATEGORY_IDS_V2, NETWORK_CATEGORY_REGISTRY_V2 } from '@/services/NetworkCategoryRegistryV2';
import { NETWORK_DEMO_EVENTS, NETWORK_DEMO_RADII, clusterNetworkDemoEvents, filterNetworkDemoEvents, networkDemoDistance,
  type NetworkDemoEvent, type NetworkDemoFilters } from '@/services/NetworkPrototypeDemo';

const statusLabels = { ACTIVE: 'Attiva', RESOLVED: 'Conclusa', CONCLUDED: 'Storico revisionato' } as const;
const formatDate = (value: string) => new Date(value).toLocaleString('it-IT', {
  timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
export function NetworkPrototypeScreen({ onClose }: { onClose: () => void }) {
  const { height, width } = useWindowDimensions();
  const wide = width >= 1024;
  const [filters, setFilters] = useState<NetworkDemoFilters>({ status: 'ACTIVE', category: null, query: '', radiusMeters: 2500 });
  const [showFilters, setShowFilters] = useState(false);
  const [sheet, setSheet] = useState<'compact' | 'list' | 'detail'>('compact');
  const [selected, setSelected] = useState<NetworkDemoEvent | null>(null);
  const [groupIds, setGroupIds] = useState<readonly string[] | null>(null);
  const [confirmed, setConfirmed] = useState<ReadonlyMap<string, string>>(new Map());
  const [followed, setFollowed] = useState<ReadonlySet<string>>(new Set());
  const [comments, setComments] = useState(() => seedNetworkDemoComments(NETWORK_DEMO_EVENTS));
  const [panel, setPanel] = useState<'events' | 'activity'>('events');
  const [activityLimit, setActivityLimit] = useState(8);
  const [focusToken, setFocusToken] = useState(0);
  const [compose, setCompose] = useState(false);
  const [recenter, setRecenter] = useState(0);
  const [cellMeters, setCellMeters] = useState(250);
  const [headerHeight, setHeaderHeight] = useState(wide ? 145 : 200);
  const [stageHeight, setStageHeight] = useState(height);
  const visible = useMemo(() => filterNetworkDemoEvents(NETWORK_DEMO_EVENTS, filters), [filters]);
  const clusters = useMemo(() => clusterNetworkDemoEvents(visible, cellMeters), [visible, cellMeters]);
  const list = groupIds ? visible.filter(entry => groupIds.includes(entry.detail.marker.publicId)) : visible;
  const activity = useMemo(() => buildNetworkPrototypeActivity(NETWORK_DEMO_EVENTS, confirmed), [confirmed]);
  const updateFilters = (patch: Partial<NetworkDemoFilters>) => {
    setFilters(old => ({ ...old, ...patch })); setSelected(null); setGroupIds(null); setSheet('compact'); setPanel('events'); setFocusToken(0);
  };
  const openEvent = (entry: NetworkDemoEvent) => {
    const point = entry.detail.marker.publicPosition;
    const radius = NETWORK_DEMO_RADII.find(value => value >= networkDemoDistance(point)) ?? 10000;
    setFilters(old => ({ ...old, status: entry.detail.marker.kind === 'REVIEWED_HISTORY' ? 'HISTORY' : entry.detail.marker.status,
      category: null, query: '', radiusMeters: Math.max(old.radiusMeters, radius) }));
    setSelected(entry); setPanel('events'); setSheet('detail'); setFocusToken(old => old + 1);
  };
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dy) > 12 && Math.abs(gesture.dx) < 25,
    onPanResponderRelease: (_event, gesture) => { if (gesture.dy > 25) setSheet('compact'); else if (gesture.dy < -25) setSheet('list'); },
  }), []);
  const detail = selected?.detail;
  const operational = detail && 'authorNickname' in detail ? detail : null;
  const marker = detail?.marker;
  const category = marker ? NETWORK_CATEGORY_REGISTRY_V2[marker.categoryId] : null;
  const sheetHeight = sheet === 'compact' ? 112 : Math.max(180, Math.min(wide ? 680 : stageHeight * (sheet === 'detail' ? 0.64 : 0.50), stageHeight - headerHeight - 36));
  const eventActivity = marker ? activity.filter(item => item.eventPublicId === marker.publicId) : [];
  const latestUpdate = eventActivity.find(item => item.kind === 'AUTHOR_UPDATE');
  const focusTarget = useMemo(() => selected && focusToken ? { coordinate: selected.detail.marker.publicPosition, token: focusToken } : undefined, [selected, focusToken]);
  // Optional presentation hints are consumed only by the Web adapter; native map is unchanged.
  const mapProps = { clusters, radiusMeters: filters.radiusMeters, recenterToken: recenter, onZoom: setCellMeters,
    topInset: headerHeight + 8, bottomInset: wide ? 16 : sheetHeight + 18,
    rightInset: wide && sheet !== 'compact' ? 440 : 90, focusTarget,
    onSelect: (cluster: (typeof clusters)[number]) => {
      setGroupIds(cluster.entries.map(entry => entry.detail.marker.publicId)); setPanel('events');
      if (cluster.entries.length === 1) openEvent(cluster.entries[0]);
      else { setSelected(null); setSheet('list'); setFocusToken(0); }
    } };
  const first = visible[0];
  return <SafeAreaView style={s.root} edges={['top', 'bottom']}>
    <KeyboardAvoidingView style={s.stage} behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}>
    <View style={s.stage} onLayout={event => setStageHeight(event.nativeEvent.layout.height)}>
      <NetworkPrototypeMap {...mapProps} />
      <View style={[s.header, wide && s.headerDesktop]} onLayout={event => setHeaderHeight(event.nativeEvent.layout.height)}>
        <View style={[s.headerTop, wide && s.headerTopDesktop]}>
        <View style={[s.topRow, wide && s.brandRowDesktop]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Esci dal prototipo NETWORK" onPress={onClose} style={s.iconButton}>
            <Ionicons accessible={false} name="arrow-back" size={24} color="#F4F8FD" />
          </Pressable>
          <View style={s.flex}><Text style={s.brand}>SafeMeLink <Text style={s.brandAccent}>NETWORK</Text></Text><Text style={s.sub}>Cavriago · una comunità vicina</Text></View>
          <View style={s.demoTag}><Text style={s.demoTagText}>DEMO</Text></View>
        </View>
        <View style={[s.search, wide && s.searchDesktop]}>
          <Ionicons accessible={false} name="search-outline" size={23} color="#B8D5F0" />
          <TextInput accessibilityLabel="Cerca negli eventi demo" placeholder="Cerca una via o un tema…" placeholderTextColor="#B8CBE0"
            value={filters.query} maxLength={80} onChangeText={query => updateFilters({ query })} style={s.input} />
          <Pressable accessibilityRole="button" accessibilityLabel="Mostra filtri e raggio" accessibilityState={{ expanded: showFilters }}
            onPress={() => setShowFilters(old => !old)} style={s.iconButton}><Ionicons accessible={false} name="options-outline" size={23} color="#F4F8FD" /></Pressable>
        </View>
        </View>
        <View style={s.tabs}>{([{ value: 'ACTIVE', label: 'Attive' }, { value: 'RESOLVED', label: 'Concluse' }, { value: 'HISTORY', label: 'Storico' }] as const).map(tab =>
          <Pressable key={tab.value} accessibilityRole="tab" accessibilityState={{ selected: filters.status === tab.value }}
            onPress={() => updateFilters({ status: tab.value })} style={[s.tab, filters.status === tab.value && s.selectedTab]}>
            <Text style={[s.tabText, filters.status === tab.value && s.selectedText]}>{tab.label}</Text>
          </Pressable>)}</View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow}>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: filters.category === null }} onPress={() => updateFilters({ category: null })}
            style={[s.chip, filters.category === null && s.activeChip]}><Text style={s.chipText}>Tutte</Text></Pressable>
          {NETWORK_CATEGORY_IDS_V2.map(id => { const item = NETWORK_CATEGORY_REGISTRY_V2[id]; return <Pressable key={id}
            accessibilityRole="button" accessibilityState={{ selected: filters.category === id }}
            onPress={() => updateFilters({ category: filters.category === id ? null : id })} style={[s.chip, filters.category === id && { borderColor: item.color, borderWidth: 2 }]}>
            <Ionicons accessible={false} name={NETWORK_PROTOTYPE_ICONS[id]} size={21} color={item.color} /><Text style={s.chipText}>{item.label}</Text>
          </Pressable>; })}
        </ScrollView>
        {showFilters ? <View style={s.filterPanel}>
          <Text style={s.body}>Raggio dal centro demo, non dalla tua posizione</Text>
          <View style={s.radii}>{NETWORK_DEMO_RADII.map(radius => <Pressable key={radius} accessibilityRole="button"
            accessibilityLabel={`Raggio demo ${radius === 2500 ? '2,5' : radius / 1000} km`} accessibilityState={{ selected: filters.radiusMeters === radius }}
            onPress={() => { updateFilters({ radiusMeters: radius }); setRecenter(old => old + 1); }} style={[s.radius, filters.radiusMeters === radius && s.activeChip]}>
            <Text style={s.chipText}>{radius === 2500 ? '2,5' : radius / 1000} km</Text></Pressable>)}</View>
          <Text style={s.sub}>Colori = categorie, non pericolosità. Ricerca soltanto negli esempi locali.</Text>
        </View> : null}
      </View>
      {sheet === 'compact' ? <View style={[s.mapTools, { bottom: wide ? 152 : sheetHeight + 24 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Ricentra su Cavriago demo" onPress={() => { setFocusToken(0); setCellMeters(250); setRecenter(old => old + 1); }} style={s.toolButton}>
          <Ionicons accessible={false} name="locate-outline" size={27} color="#F4F8FD" /><Text style={s.toolText}>Ricentra</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Scegli il raggio demo" onPress={() => setShowFilters(old => !old)} style={s.toolButton}>
          <Text style={s.toolText}>{filters.radiusMeters === 2500 ? '2,5' : filters.radiusMeters / 1000} km</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Segnala, anteprima senza pubblicazione" onPress={() => setCompose(true)} style={s.reportButton}>
          <Ionicons accessible={false} name="add" size={26} color="#061B36" /><Text style={s.reportText}>Segnala</Text>
        </Pressable>
      </View> : null}
      <View accessibilityLabel="Pannello NETWORK" style={[s.sheet, wide ? s.sheetDesktop : s.sheetMobile, { height: sheetHeight }]}>
        <View {...pan.panHandlers} accessibilityRole="adjustable" accessibilityLabel="Pannello eventi demo"
          accessibilityActions={[{ name: 'increment', label: 'Espandi elenco' }, { name: 'decrement', label: 'Riduci anteprima' }]}
          onAccessibilityAction={event => setSheet(event.nativeEvent.actionName === 'increment' ? 'list' : 'compact')} style={s.handleArea}><View style={s.handle} /></View>
        {sheet !== 'compact' ? <View style={s.panelHeading}><View style={s.flex}><Text style={s.eyebrow}>SOLO DATI DEMO</Text><Text style={s.title}>{sheet === 'detail' ? 'La voce del quartiere' : panel === 'activity' ? 'Attività recente' : 'Esplora la tua zona'}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Riduci pannello NETWORK" onPress={() => setSheet('compact')} style={s.closePanel}><Ionicons accessible={false} name="chevron-down" size={24} color="#D5E9FA" /></Pressable>
        </View> : null}
        {sheet !== 'compact' ? <View style={s.sheetTabs}>{(['compact', 'list', 'detail'] as const).map((value, index) => <Pressable key={value}
          accessibilityRole="button" accessibilityState={{ selected: sheet === value, disabled: value === 'detail' && !selected }}
          disabled={value === 'detail' && !selected} onPress={() => { setSheet(value); setPanel('events'); }} style={[s.sheetTab, value === 'detail' && !selected && s.disabled]}>
          <Text style={[s.sub, sheet === value && s.sheetTabSelected]}>{['Anteprima', 'Elenco zona', 'Dettaglio'][index]}</Text>
        </Pressable>)}</View> : null}
        {sheet === 'compact' ? <View style={s.compactRow}><Pressable accessibilityRole="button" accessibilityLabel="Apri elenco degli eventi demo" onPress={() => { setGroupIds(null); setPanel('events'); setSheet('list'); }} style={s.preview}>
          <View style={s.flex}><Text style={s.title}>{visible.length} esempi nel territorio</Text><Text style={s.sub} numberOfLines={1}>{first ? first.title : 'Nessun esempio con questi filtri'}</Text><Text style={s.link}>Esplora la tua zona ↑</Text></View>
        </Pressable><Pressable accessibilityRole="button" accessibilityLabel="Apri Attività recente demo" onPress={() => { setPanel('activity'); setActivityLimit(8); setSheet('list'); }} style={s.activityShortcut}>
          <Ionicons accessible={false} name="people-outline" size={23} color="#BDE9FF" /><Text style={s.activityShortcutText}>Attività{ '\n' }recente</Text>
        </Pressable></View> : <ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets style={s.sheetScroll} contentContainerStyle={s.sheetContent}>
          {sheet === 'list' && panel === 'activity' ? <>
            <Text style={s.body}>Le informazioni utili nascono dalla partecipazione.</Text>
            <Text style={s.sub}>Tutti gli eventi demo. Le conferme senza data non sono inventate come attività recenti.</Text>
            {activity.slice(0, activityLimit).map(item => {
              const entry = NETWORK_DEMO_EVENTS.find(event => event.detail.marker.publicId === item.eventPublicId)!;
              const icon = item.kind === 'RESOLVED' ? 'checkmark-circle-outline' : item.kind === 'LOCAL_CONFIRMATION' ? 'checkmark-done-outline' : item.kind === 'AUTHOR_UPDATE' ? 'chatbubble-ellipses-outline' : 'location-outline';
              return <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`Apri attività demo: ${item.label} — ${entry.title}`} onPress={() => openEvent(entry)} style={s.activityCard}>
                <View style={s.activityIcon}><Ionicons accessible={false} name={icon} size={23} color="#BDE9FF" /></View>
                <View style={s.flex}><Text style={s.eyebrow}>{item.local ? 'INTERAZIONE LOCALE' : 'SCENARIO DEMO'}</Text><Text style={s.eventTitle}>{item.label}</Text><Text style={s.body} numberOfLines={2}>{entry.title}</Text><Text style={s.sub}>{formatDate(item.occurredAt)}</Text></View>
                <Ionicons accessible={false} name="chevron-forward" size={20} color="#A4C4DF" />
              </Pressable>;
            })}
            {activityLimit < activity.length ? <Pressable accessibilityRole="button" onPress={() => setActivityLimit(old => old + 8)} style={s.followButton}><Text style={s.followText}>Mostra altre attività demo</Text></Pressable> : null}
          </> : sheet === 'list' ? <>
            <View style={s.topRow}><Text accessibilityRole="header" style={[s.title, s.flex]}>{groupIds ? 'Selezione sulla mappa' : 'Nel territorio demo'}</Text>
              {groupIds ? <Pressable accessibilityRole="button" onPress={() => setGroupIds(null)} style={s.smallButton}><Text style={s.link}>Mostra tutte</Text></Pressable> : null}</View>
            <Text style={s.sub}>{list.length} esempi · nessuna statistica reale</Text>
            {!list.length ? <Text style={s.body}>Nessun esempio disponibile. Cambia categoria, ricerca o raggio.</Text> : list.map(entry => {
              const item = NETWORK_CATEGORY_REGISTRY_V2[entry.detail.marker.categoryId];
              return <Pressable key={entry.detail.marker.publicId} accessibilityRole="button" accessibilityLabel={`Dettaglio demo: ${entry.title}`}
                onPress={() => openEvent(entry)} style={s.eventCard}>
                <View style={[s.categoryIcon, { backgroundColor: item.color }]}><Ionicons accessible={false} name={NETWORK_PROTOTYPE_ICONS[entry.detail.marker.categoryId]} size={24} color="#061B36" /></View>
                <View style={s.flex}><Text style={s.eventTitle}>{entry.title}</Text><Text style={s.sub}>{entry.areaLabel}</Text><Text style={s.status}>{statusLabels[entry.detail.marker.status]}</Text></View>
                <Ionicons accessible={false} name="chevron-forward" size={22} color="#B8D5F0" />
              </Pressable>;
            })}
          </> : selected && detail && marker && category ? <>
            <View style={s.detailCategory}><View style={[s.categoryIcon, { backgroundColor: category.color }]}><Ionicons accessible={false} name={NETWORK_PROTOTYPE_ICONS[marker.categoryId]} size={24} color="#061B36" /></View><View style={s.flex}><Text style={[s.categoryLabel, { color: category.color }]}>{category.label}</Text><Text style={s.status}>{statusLabels[marker.status]} · demo</Text></View></View>
            <Text accessibilityRole="header" style={s.detailTitle}>{selected.title}</Text>
            <Text style={s.body}>{selected.areaLabel} · posizione illustrativa</Text>
            {operational ? <>
              <View style={s.authorRow}><View style={s.avatar}><Text style={s.avatarText}>{operational.authorNickname.replace('Demo_', '').slice(0, 1)}</Text></View><View><Text style={s.author}>{operational.authorNickname}</Text><Text style={s.sub}>Autore · profilo dimostrativo</Text></View></View>
              <Text style={s.body}>{operational.description}</Text>
              <Text style={s.sub}>Creata: {formatDate(operational.marker.createdAt)}{operational.marker.resolvedAt ? `\nConclusa: ${formatDate(operational.marker.resolvedAt)}` : ''}</Text>
              <View style={s.social}><Text style={s.title}>{operational.confirmations.confirmedCount + (confirmed.has(marker.publicId) ? 1 : 0)} conferme demo</Text>
                {marker.status === 'ACTIVE' ? <Pressable accessibilityRole="button" disabled={confirmed.has(marker.publicId)}
                  accessibilityState={{ disabled: confirmed.has(marker.publicId) }} style={[s.confirmButton, confirmed.has(marker.publicId) && s.disabled]}
                  onPress={() => setConfirmed(old => { if (old.has(marker.publicId)) return old; const next = new Map(old); next.set(marker.publicId, new Date().toISOString()); return next; })}><Text style={s.confirmText}>{confirmed.has(marker.publicId) ? 'Confermato · demo' : 'Confermo · demo'}</Text></Pressable> : null}
                {confirmed.has(marker.publicId) ? <Text accessibilityLiveRegion="polite" style={s.feedback}>La tua conferma demo è stata aggiunta. Nessun invio reale.</Text> : null}
                <Pressable accessibilityRole="button" accessibilityLabel={followed.has(marker.publicId) ? 'Smetti di seguire segnalazione demo' : 'Segui segnalazione demo'} accessibilityState={{ selected: followed.has(marker.publicId) }}
                  onPress={() => setFollowed(old => { const next = new Set(old); if (next.has(marker.publicId)) next.delete(marker.publicId); else next.add(marker.publicId); return next; })}
                  style={[s.followButton, followed.has(marker.publicId) && s.following]}><Ionicons accessible={false} name={followed.has(marker.publicId) ? 'bookmark' : 'bookmark-outline'} size={20} color="#BDE9FF" /><Text style={s.followText}>{followed.has(marker.publicId) ? 'Seguita · demo' : 'Segui segnalazione · demo'}</Text></Pressable>
                <Text accessibilityLiveRegion="polite" style={s.sub}>{followed.has(marker.publicId) ? 'La segui soltanto in questa sessione. Nessuna notifica reale.' : 'Segui gli sviluppi nella demo, senza attivare notifiche.'}</Text>
              </View>
              {latestUpdate ? <View style={s.latestUpdate}><Text style={s.eyebrow}>ULTIMO AGGIORNAMENTO DELL’AUTORE</Text><Text style={s.body}>{latestUpdate.body}</Text><Text style={s.sub}>{formatDate(latestUpdate.occurredAt)}</Text></View> : null}
              <Text accessibilityRole="header" style={s.title}>Cronologia e aggiornamenti</Text>
              {[...eventActivity].reverse().map(item => <View key={item.id} style={[s.timeline, item.id === eventActivity[0]?.id && s.latestTimeline]}><Text style={s.author}>{item.label}</Text>{item.kind === 'AUTHOR_UPDATE' ? <Text style={s.body}>{item.body}</Text> : null}<Text style={s.sub}>{formatDate(item.occurredAt)} · {item.local ? 'azione locale' : 'scenario demo'}</Text></View>)}
              <NetworkPrototypeConversation key={marker.publicId} eventPublicId={marker.publicId} authorNickname={operational.authorNickname}
                comments={comments} onPublish={comment => setComments(old => appendNetworkDemoComment(old, NETWORK_DEMO_EVENTS, comment))} />
              <Text style={s.sub}>Conversazioni e conferme soltanto in memoria. Nessun messaggio pubblico reale.</Text>
            </> : 'summary' in detail && marker.kind === 'REVIEWED_HISTORY' ? <>
              <Text style={s.body}>{detail.summary}</Text><Text style={s.author}>Periodo: settembre 2026</Text>
              <Text style={s.sub}>Scheda revisionata demo · revisione {marker.revision}. Nessun nickname o identità dell’autore nello storico.</Text>
            </> : null}
            <Text style={s.demoFootnote}>PROTOTIPO: tutti i contenuti e le posizioni degli eventi sono inventati.</Text>
          </> : null}
        </ScrollView>}
      </View>
      <Modal visible={compose} transparent animationType="fade" onRequestClose={() => setCompose(false)}>
        <View style={s.scrim}><View accessibilityViewIsModal style={s.dialog}>
          <Text accessibilityRole="header" style={s.detailTitle}>Una voce per il tuo quartiere</Text>
          <Text style={s.body}>Qui potrai scegliere il luogo del problema e aggiungere una segnalazione.</Text>
          <Text style={s.demoFootnote}>Anteprima locale: pubblicazione non collegata. Nessun invio, GPS o accesso al database.</Text>
          <Pressable accessibilityRole="button" onPress={() => setCompose(false)} style={s.confirmButton}><Text style={s.confirmText}>Torna alla mappa demo</Text></Pressable>
        </View></View>
      </Modal>
    </View>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#061B36' }, stage: { flex: 1, overflow: 'hidden' }, flex: { flex: 1 },
  header: { position: 'absolute', top: 8, left: 12, right: 12, gap: 6 }, headerDesktop: { top: 16, left: 20, right: 160, maxWidth: 1040 },
  headerTop: { gap: 6 }, headerTopDesktop: { flexDirection: 'row', alignItems: 'center', gap: 12 }, brandRowDesktop: { width: 345 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brand: { color: '#F4F8FD', fontSize: 17, fontWeight: '800' }, brandAccent: { color: '#79B8FF' }, sub: { color: '#B8CBE0', fontSize: 14, lineHeight: 20 },
  demoTag: { backgroundColor: '#BDE9FF', padding: 7, borderRadius: 8 }, demoTagText: { color: '#061B36', fontSize: 12, fontWeight: '900' },
  disclaimer: { color: '#D2E6F7', backgroundColor: '#061B36E8', fontSize: 12, lineHeight: 18, paddingHorizontal: 10, borderRadius: 6 },
  search: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#08233FF5', borderColor: '#527B9D', borderWidth: 1, borderRadius: 16, paddingLeft: 12 },
  searchDesktop: { flex: 1 }, input: { flex: 1, minHeight: 46, color: '#F4F8FD', paddingHorizontal: 8, fontSize: 16 },
  iconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#08233FEF' },
  tabs: { flexDirection: 'row', backgroundColor: '#08233FF5', padding: 3, borderRadius: 14 }, tab: { flex: 1, minHeight: 40, justifyContent: 'center', alignItems: 'center', borderRadius: 10 },
  selectedTab: { backgroundColor: '#BDE9FF' }, tabText: { color: '#D2E6F7', fontSize: 16, fontWeight: '700' }, selectedText: { color: '#061B36' },
  chipRow: { gap: 7, paddingVertical: 2 }, chip: { minHeight: 44, borderRadius: 22, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: '#456C8C', backgroundColor: '#08233FF5' },
  activeChip: { borderColor: '#BDE9FF', borderWidth: 2, backgroundColor: '#174566' }, chipText: { color: '#F4F8FD', fontSize: 15, fontWeight: '600' },
  filterPanel: { backgroundColor: '#08233FF5', borderRadius: 14, padding: 12, gap: 8 }, radii: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  radius: { minHeight: 44, minWidth: 60, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#527B9D', paddingHorizontal: 9 },
  mapTools: { position: 'absolute', right: 12, gap: 9, alignItems: 'flex-end' }, toolButton: { minHeight: 48, minWidth: 70, padding: 10, backgroundColor: '#08233FF5', borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#527B9D' },
  toolText: { color: '#F4F8FD', fontSize: 13, fontWeight: '700' }, reportButton: { minHeight: 54, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 27, backgroundColor: '#79B8FF' },
  reportText: { color: '#061B36', fontSize: 17, fontWeight: '800' },
  sheet: { position: 'absolute', backgroundColor: '#08233FF5', borderRadius: 22, borderWidth: 1, borderColor: '#527B9D', overflow: 'hidden' },
  sheetDesktop: { width: 400, right: 20, bottom: 20 }, sheetMobile: { left: 10, right: 10, bottom: 8 },
  handleArea: { height: 18, alignItems: 'center', justifyContent: 'center' }, handle: { width: 38, height: 4, borderRadius: 2, backgroundColor: '#83A9C7' },
  panelHeading: { flexDirection: 'row', alignItems: 'center', paddingLeft: 18, paddingRight: 10, paddingBottom: 8 },
  closePanel: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#163F5D', alignItems: 'center', justifyContent: 'center' },
  sheetTabs: { flexDirection: 'row', paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: '#254B6A' }, sheetTab: { minHeight: 44, flex: 1, alignItems: 'center', justifyContent: 'center' }, sheetTabSelected: { color: '#BDE9FF', fontWeight: '800' },
  compactRow: { flex: 1, flexDirection: 'row', alignItems: 'stretch' },
  preview: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 8 }, sheetScroll: { flex: 1 }, sheetContent: { padding: 18, gap: 14, paddingBottom: 28 },
  activityShortcut: { minWidth: 96, margin: 6, marginTop: 0, padding: 8, borderRadius: 16, alignItems: 'center', justifyContent: 'center', gap: 3, backgroundColor: '#153F5D' },
  activityShortcutText: { color: '#D7F0FF', fontSize: 14, lineHeight: 18, fontWeight: '700', textAlign: 'center' },
  title: { color: '#F4F8FD', fontSize: 18, fontWeight: '700', lineHeight: 25 }, body: { color: '#E2ECF6', fontSize: 16, lineHeight: 24 },
  eventCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: '#10314C', minHeight: 94 },
  categoryIcon: { height: 44, width: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, eventTitle: { color: '#F4F8FD', fontSize: 17, lineHeight: 24, fontWeight: '700' },
  status: { color: '#AFDFEE', fontSize: 14, fontWeight: '600', marginTop: 4 }, smallButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }, link: { color: '#9EDAFF', fontSize: 14 },
  detailCategory: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  categoryLabel: { fontSize: 15, fontWeight: '700' }, detailTitle: { color: '#F4F8FD', fontSize: 25, fontWeight: '800', lineHeight: 32 }, author: { color: '#D4EEFF', fontSize: 16, fontWeight: '600', lineHeight: 23 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }, avatar: { height: 42, width: 42, borderRadius: 21, backgroundColor: '#234C69', alignItems: 'center', justifyContent: 'center' }, avatarText: { color: '#D4EEFF', fontWeight: '800', fontSize: 19 },
  social: { padding: 14, borderRadius: 16, backgroundColor: '#123957', gap: 12 }, confirmButton: { minHeight: 48, padding: 12, backgroundColor: '#BDE9FF', borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, confirmText: { color: '#061B36', fontSize: 16, fontWeight: '800' },
  followButton: { flexDirection: 'row', minHeight: 48, gap: 8, alignItems: 'center', justifyContent: 'center', padding: 12, borderWidth: 1, borderColor: '#638AAA', borderRadius: 12 },
  following: { backgroundColor: '#214C68', borderColor: '#BDE9FF' }, followText: { color: '#D4EEFF', fontSize: 15, fontWeight: '700' },
  feedback: { color: '#A8E7D8', fontSize: 14, lineHeight: 21 }, latestUpdate: { borderRadius: 16, backgroundColor: '#153E58', padding: 14, gap: 8, borderLeftWidth: 3, borderLeftColor: '#79B8FF' },
  eyebrow: { color: '#A7CDE6', fontSize: 11, lineHeight: 17, letterSpacing: 1, fontWeight: '800' },
  activityCard: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#234763' },
  activityIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: '#153F5D', alignItems: 'center', justifyContent: 'center' },
  timeline: { borderLeftWidth: 2, borderLeftColor: '#527B9D', paddingLeft: 14, paddingVertical: 4, gap: 5 }, latestTimeline: { borderLeftColor: '#79B8FF', backgroundColor: '#0E304B', padding: 12, borderRadius: 10 },
  demoFootnote: { color: '#C8DDF0', fontSize: 13, lineHeight: 20 }, disabled: { opacity: 0.5 },
  scrim: { flex: 1, padding: 24, backgroundColor: '#020C1ACF', justifyContent: 'center' }, dialog: { backgroundColor: '#08233F', borderColor: '#527B9D', borderWidth: 1, borderRadius: 22, padding: 22, gap: 18 },
});
