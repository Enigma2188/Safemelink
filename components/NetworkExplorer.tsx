import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { NETWORK_CATEGORIES, type NetworkFeedReport } from '@/services/NetworkModels';
import { NETWORK_PILOT } from '@/services/NetworkPilotConfig';
import { DEFAULT_NETWORK_FILTERS, filterNetworkReports, networkDistanceActivity, type NetworkFilters } from '@/services/NetworkTerritory';

type Props = { reports: NetworkFeedReport[]; radiusLabel: string; radiusMeters: number; loading: boolean; renderReport: (report: NetworkFeedReport) => ReactNode };
export function NetworkExplorer({ reports, radiusLabel, radiusMeters, loading, renderReport }: Props) {
  const [filters, setFilters] = useState(DEFAULT_NETWORK_FILTERS);
  const [view, setView] = useState<'territory' | 'feed'>('territory');
  const [now, setNow] = useState(Date.now());
  useEffect(() => { setNow(Date.now()); }, [reports]);
  useEffect(() => {
    const expiry = Math.min(...reports.filter(r => r.status === 'ACTIVE').map(r => Date.parse(r.expiresAt)).filter(t => Number.isFinite(t) && t > now));
    if (!Number.isFinite(expiry)) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.min(expiry - Date.now() + 1, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [reports, now]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => { if (state === 'active') setNow(Date.now()); });
    return () => listener.remove();
  }, []);
  const filtered = useMemo(() => filterNetworkReports(reports, filters, now), [reports, filters, now]);
  const rings = useMemo(() => networkDistanceActivity(filterNetworkReports(reports, { ...filters, band: null }, now)), [reports, filters, now]);
  const change = <K extends keyof NetworkFilters>(key: K, value: NetworkFilters[K]) => setFilters(old => ({ ...old, [key]: value }));
  return <View style={s.root}>
    <View style={s.search}><Ionicons accessible={false} name="search" size={22} color="#A9E4FF" />
      <TextInput accessibilityLabel="Cerca nelle segnalazioni caricate" placeholder="Cerca una via, un tema, una zona…" placeholderTextColor="#B6CDEB"
        value={filters.query} onChangeText={query => change('query', query)} style={s.input} maxLength={100} />
    </View>
    <Text style={s.hint}>Ricerca nei testi disponibili, non ricerca geografica di indirizzi.</Text>
    <Text style={s.hint}>Il periodo filtra la data di pubblicazione, non quella di chiusura.</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
      {[{ value: 'all', label: 'Tutte' }, ...NETWORK_CATEGORIES].map(item => <Chip key={item.value} label={item.label}
        selected={filters.category === item.value} onPress={() => change('category', item.value)} />)}
    </ScrollView>
    <View style={s.chips}>{NETWORK_PILOT.periods.map(days => <Chip key={days} label={days ? `${days} giorni` : 'Tutto il disponibile'}
      selected={filters.days === days} onPress={() => change('days', days)} />)}</View>
    <View style={s.chips}>{([{ value: 'all', label: 'Tutti gli stati' }, { value: 'ACTIVE', label: 'Presenti' }, { value: 'RESOLVED', label: 'Concluse' }] as const)
      .map(item => <Chip key={item.value} label={item.label} selected={filters.status === item.value} onPress={() => change('status', item.value)} />)}</View>
    <View style={s.switcher}><Chip label="Territorio" selected={view === 'territory'} onPress={() => setView('territory')} />
      <Chip label="Feed" selected={view === 'feed'} onPress={() => setView('feed')} /></View>
    <Text accessibilityRole="header" style={s.title}>{view === 'territory' ? 'Esplora le segnalazioni' : 'Il feed della comunità'}</Text>
    <Text style={s.hint}>{reports.length} segnalazioni caricate · raggio {radiusLabel} dalla tua posizione. Non è un censimento di Cavriago.</Text>
    {view === 'territory' ? <>
      <View style={s.mapUnavailable}>
        <View style={s.mapIcon}><Ionicons accessible={false} name="map-outline" size={52} color="#8ADFFF" /></View>
        <Text style={s.title}>La cartografia è da collegare</Text>
        <Text style={s.body}>Il backend attuale non restituisce coordinate pubbliche per i marker. Nessuna posizione viene inventata o ricavata dagli SOS.</Text>
        <Text style={s.hint}>La mappa Google già presente richiede inoltre una configurazione esterna autorizzata. Zoom e marker territoriali non sono ancora disponibili.</Text>
        <Chip label="ESPLORA IL FEED" selected onPress={() => setView('feed')} />
      </View>
      <View style={s.panel}>
        <Text style={s.title}>Attività per distanza</Text>
        <Text style={s.body}>Fasce approssimative, non quartieri. Solo segnalazioni caricate nel periodo e nei filtri selezionati.</Text>
        {rings.map(ring => <Pressable key={ring.id} accessibilityRole="button" disabled={ring.minimum > radiusMeters} accessibilityState={{ selected: filters.band === ring.id, disabled: ring.minimum > radiusMeters }}
          accessibilityLabel={`${ring.label}: ${ring.count === null ? 'dati insufficienti' : `${ring.count} segnalazioni`}. ${ring.activity.label}`}
          style={[s.ring, filters.band === ring.id && s.ringSelected]} onPress={() => change('band', filters.band === ring.id ? null : ring.id)}>
          <Text style={[s.symbol, { color: ring.activity.color }]}>{ring.activity.symbol}</Text>
          <View style={s.ringText}><Text style={s.body}>{ring.label}</Text><Text style={[s.hint, { color: ring.activity.color }]}>{ring.minimum > radiusMeters ? 'Fuori dal raggio caricato' : ring.activity.label}</Text></View>
          <Text style={s.count}>{ring.count ?? '—'}</Text><Ionicons accessible={false} name="chevron-forward" size={18} color="#A9E4FF" />
        </Pressable>)}
        <Text style={s.hint}>Legenda: verde {NETWORK_PILOT.minimumAggregateCount}–{NETWORK_PILOT.lowActivityMaximum}, giallo {NETWORK_PILOT.lowActivityMaximum + 1}–{NETWORK_PILOT.mediumActivityMaximum}, rosso da {NETWORK_PILOT.mediumActivityMaximum + 1} segnalazioni. Sotto {NETWORK_PILOT.minimumAggregateCount}: nessun indicatore.</Text>
        <Text style={s.hint}>I colori non misurano pericolo o sicurezza. Poche segnalazioni possono significare poca partecipazione.</Text>
      </View>
    </> : null}
    {filters.band ? <Chip label="Rimuovi filtro distanza" selected onPress={() => change('band', null)} /> : null}
    <Text accessibilityRole="header" style={s.title}>{filters.status === 'RESOLVED' ? 'Cronologia disponibile' : 'Segnalazioni disponibili'} · {filtered.length}</Text>
    <Text style={s.hint}>Le concluse sono visibili solo nella finestra concessa dal server (attualmente 24 ore nello schema versionato). Non è uno storico completo. Ordine: dalla più recente.</Text>
    {!loading && !filtered.length ? <View style={s.panel}><Text style={s.body}>Nessuna segnalazione disponibile con questi filtri.</Text>
      <Text style={s.hint}>Non significa che la zona sia sicura. Prova un altro periodo o carica altre segnalazioni.</Text>
      <Chip label="AZZERA FILTRI" selected onPress={() => setFilters(DEFAULT_NETWORK_FILTERS)} /></View> : null}
    {filtered.map(renderReport)}
  </View>;
}
function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[s.chip, selected && s.chipSelected]}>
    <Text style={[s.chipText, selected && s.chipSelectedText]}>{label}</Text></Pressable>;
}
const s = StyleSheet.create({
  root: { gap: 12 }, search: { borderColor: '#69D5FF', borderWidth: 1, borderRadius: 18, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#102E56' },
  input: { flex: 1, minHeight: 52, color: '#F5FAFF', fontSize: 16, paddingVertical: 12 },
  title: { color: '#F5FAFF', fontSize: 20, fontWeight: '800', flexShrink: 1 }, body: { color: '#F5FAFF', fontSize: 16, lineHeight: 23 }, hint: { color: '#BDD2EE', fontSize: 13, lineHeight: 19 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, switcher: { flexDirection: 'row', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#5CABDB', borderRadius: 24, paddingVertical: 11, paddingHorizontal: 15, minHeight: 46, justifyContent: 'center', backgroundColor: '#102E56' },
  chipSelected: { backgroundColor: '#8ADFFF', borderColor: '#B7F0FF' }, chipText: { color: '#F5FAFF', fontSize: 14, fontWeight: '700' }, chipSelectedText: { color: '#08213E' },
  panel: { backgroundColor: '#0C274A', borderColor: '#346A99', borderWidth: 1, borderRadius: 20, padding: 17, gap: 12 },
  mapUnavailable: { backgroundColor: '#0A2142', borderWidth: 1, borderColor: '#62C9FA', borderRadius: 24, padding: 22, gap: 14, minHeight: 280 },
  mapIcon: { width: 80, height: 80, borderRadius: 24, backgroundColor: '#123B66', justifyContent: 'center', alignItems: 'center' },
  ring: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 66, padding: 10, borderWidth: 1, borderColor: '#346A99', borderRadius: 15 },
  ringSelected: { borderColor: '#8ADFFF', backgroundColor: '#163C66' }, ringText: { flex: 1 }, symbol: { fontSize: 24 }, count: { color: '#FFF', fontSize: 24, fontWeight: '800' },
});
