# NETWORK 2.0 — controller dati e binding nativo (Fase 10)

## Cosa è collegato

`NetworkMapController` è un external store tipizzato indipendente da React.
`NetworkMapConnected.native.tsx` usa useSyncExternalStore per trasferirne gli
snapshot al NetworkMap nativo esistente. Non modifica navigazione, prototipo,
NETWORK legacy o componenti social. Nessun servizio viene creato implicitamente.

La composition root futura deve costruire il controller con un servizio reale
che implementi NetworkMapMarkerSource.loadMarkers(query, signal), quindi fornire
contesto e camera al binding. Non esiste un fallback demo o un generatore di dati.
Il servizio deve usare l'autenticazione effettiva, rispettare AbortSignal e
restituire uno snapshot completo di soli marker V2 autorizzati, non una pagina
parziale. Autorizzazioni, generalizzazione del punto evento e filtro geografico
devono essere garantiti dal server; la validazione client non li dimostra.

## Incompatibilità backend esplicita

La migration territoriale locale del 03/11 espone list_network_map_cells_v2:
ritorna zone/geometrie, disponibilità e fasce aggregate; NON marker evento V2.
Non è stata chiamata, modificata o reinterpretata come lista di eventi.
Un adattatore Supabase non è quindi implementato contro firme immaginarie.
Serve autorizzazione separata per concordare il contratto backend pubblicabile
e il relativo adattatore reale. L'attuale controller può riceverne gli esiti
senza dipendere da Cavriago, nickname demo o accordi con Comuni.

## Ciclo di vita e concorrenza

- setContext({authorizationKey, query}) avvia il caricamento. La chiave è un
  namespace opaco di identità/accesso, mai visualizzato o trasmesso al servizio.
  Il chiamante deve cambiarla quando cambiano account, sessione o autorizzazioni.
- Territorio, centro pubblico di consultazione, raggio, stato e categoria sono
  dinamici. Un cambiamento genera un nuovo scope cartografico e svuota i marker.
  Query identiche non producono richieste duplicate; refresh è esplicito.
- Ogni richiesta sostituisce/annulla la precedente. Generation e AbortSignal
  scartano risultati tardivi, anche se la sorgente ignora la cancellazione.
- IDLE, LOADING, READY, EMPTY ed ERROR sono distinti. Errori classificati NETWORK,
  SERVER, ACCESS_DENIED, INVALID_DATA, TIMEOUT; nessun messaggio grezzo del server,
  stack o contenuto utente viene copiato nello stato o nei log.
- Timeout predefinito 15 secondi, configurabile e limitato. Nessun retry infinito,
  coda di richieste, polling o invio automatico. refresh consente un tentativo
  esplicito dopo errore o ritorno della rete.
- Snapshot validati, copiati mediante allowlist pubblica e congelati. Duplicati,
  campi extra, territorio/stato/categoria errati causano errore con marker vuoti.
  Oltre 2000 marker non vengono presentati conteggi parziali: occorrono filtri o
  un futuro contratto di aggregazione/paginazione adeguato al renderer.
- Ogni risposta completa sostituisce i dati precedenti: i marker omessi perché
  ritirati non restano in cache. invalidate() svuota subito e richiede nuovamente
  lo snapshot autorevole. Un futuro evento server di ritiro può chiamarla solo
  dopo controllo del contesto/autorizzazione della sottoscrizione.
- I validUntil sono controllati alla ricezione e alla scadenza locale. Il binding
  rivaluta le scadenze al foreground senza avviare una richiesta. L'orologio e i
  timer client NON garantiscono revoca immediata, specialmente in background:
  una futura invalidazione server/controller rimane indispensabile.
- setContext(null) va chiamato sincronicamente su logout/perdita accesso. dispose
  cancella richieste, timer, contesto e dati, senza possibilità di riavvio.
  Il proprietario del controller gestisce dispose; smontare solo la vista rimuove
  la sottoscrizione ma non distrugge un controller eventualmente condiviso.

Il binding riceve configurazione provider, camera e callback dall'app. Non legge
GPS, credenziali o account, non si collega a SOS e non incorpora territorio fisso.
I commenti social non vengono caricati o associati automaticamente: futura
integrazione con controller/detail autorizzati separati, senza nickname storico.

## Verifiche e limiti

`node scripts/test-network-map-controller.cjs` usa il controller reale con sorgenti
controllate e scheduler locale: nessun Supabase, tile, GPS o dati reali.
Copre scope/account/filtri, race, abort ignorato, timeout, errori, ritiro via
snapshot sostitutivo, scadenza, immutabilità, binding e subscriber reentranti.
TypeScript noEmit ed ESLint non compilano il motore nativo.

Prima del servizio pubblico servono contratto backend e autorizzazioni server,
test autentici multiutente/cross-account, revoche concorrenti, rete instabile,
carico, paginazione e collaudi Android/iOS diversi. Nessuna di queste prove è
sostituita dai test locali. Il percorso è predisposto per un servizio reale,
ma NON è ancora un NETWORK multiutente collegato a Supabase.
