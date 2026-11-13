# NETWORK 2.0 — Fase 13: integrazione nativa isolata

## Stato

Schermata nativa riutilizzabile, NON collegata a route/tab di produzione, Expo Web
o al prototipo. Nessun servizio remoto avviato e nessuna fixture nel percorso
applicativo. Le funzioni reali richiedono un servizio autenticato e le RPC V2
applicate/collaudate: questo lavoro non dimostra che lo siano.

## Composizione

- `screens/NetworkV2Screen.native.tsx`: superficie Android/iOS con mappa geografica,
  territori, raggi, categorie, elenco/dettaglio e form di pubblicazione.
- `components/network/NetworkV2ScreenController.ts`: orchestrazione delle istanze
  ESISTENTI NetworkV2Repository e NetworkMapController; nessuna replica dei writer
  o del controllo geografico server.
- `NetworkMapConnected.native.tsx`: riutilizzato senza modifiche.
- `NetworkMap.native.tsx`/tipi: aggiunto SOLO input opzionale eventDraft, separato
  da snapshot/marker pubblici. Tap su mappa, ignorando tap propagati dai marker;
  coordinate invalide/callback obsolete non selezionano un punto. Nessun GPS.
- `NetworkEventSocial.native.tsx`: presenter senza stato social, con dati
  autorizzati e slot per future integrazioni, non un secondo backend social.

Il proprietario costruisce un'istanza stabile di NetworkV2ScreenController con:

1. trasporto ottenuto da createNetworkV2SupabaseTransport(client) SOLO quando
   l'ambiente e lo schema sono verificati; nessun client viene creato dalla vista;
2. access context con getKey/subscribe sincroni sul cambio sessione/autorizzazioni;
   chiave opaca di epoch, mai un token, nickname o account fisso;
3. provider affidabile di UUID per operationId, già disponibile nell'host;
   nessun Math.random, generatore demo o dipendenza nuova. La validazione UUID
   prova il formato, NON l'entropia del provider;
4. initialRegion dinamica pubblica di consultazione: nessuna coordinata autore
   richiesta e nessun territorio predefinito incorporato.

La vista riceve runtime, configuration READY/MISSING del provider cartografico,
onClose opzionale e socialSlots opzionali. Non passare una regione privata GPS
come default implicito. Non inserire service key o operatori moderazione nel client.
Nessun file in app/ e nessuna navigazione principale sono stati modificati.

Il runtime va mantenuto dall'owner oltre un semplice cambio schermata. La vista
avvia start idempotente e rimuove il SOLO listener AppState al proprio smontaggio:
il tentativo incerto non viene distrutto da una normale uscita. onClose rimane
utilizzabile, anche durante un invio, per non ostacolare altre funzioni dell'app.
L'owner deve chiamare stop/dispose alla fine effettiva del contesto e non creare
istanze ad ogni render; l'ascolto Auth rimane attivo per ripulire i dati anche
quando la schermata non è visibile. Logout/cambio account cancellano subito
dettagli, punto scelto, testo, tentativi e risultati; le risposte tardive sono scartate.
La distruzione dell'app perde ancora i tentativi in memoria: non è un outbox duraturo.

## Percorso operativo

L'apertura con sessione disponibile cerca territori attraverso la RPC reale
predisposta, usando la regione fornita. Zero territori o errori non generano esempi
fittizi. Ricerca manuale sulla regione navigata e pagine successive da 50 permettono
territori diversi senza residenza o accordo comunale hardcoded.

La scelta territorio alimenta il controller con ID, centro, raggio 1/2,5/5/10 km,
stato ACTIVE/RESOLVED e categoria. Aggiorna effettua una nuova lettura anche per
query identica; gli aggiornamenti non sono simulati. La mappa nativa esistente
gestisce pan, zoom, cluster, icone e Ricentra. Caricamento/errori svuotano dati
precedenti; il dettaglio è richiesto solo per un marker disponibile e non scaduto.
Elenco locale limitato progressivamente e pulsante Mostra altre non richiedono
nuove RPC o conteggi inventati. Le descrizioni/nickname arrivano solo dal dettaglio.

Al ritorno in foreground vengono cancellati i dettagli precedenti e richiesta
una lettura del contesto corrente, non un reinvio di pubblicazioni. Nessun polling
o servizio di connettività aggiunto. Offline/timeout mostrano errore e retry;
non viene dichiarato che il telefono sia certamente offline usando solo un errore.
Le scadenze sono rivalutate e i marker ritirati scompaiono nello snapshot successivo.
Non c'è invalidazione realtime: un ritiro remoto mentre la vista è aperta non è
conoscibile prima di refresh/foreground/scadenza. Prima del pubblico serve una
decisione su TTL di visibilità e/o invalidazioni autorizzate; non promettere revoca
istantanea o assenza di copie già viste. Il validUntil SQL attuale è legato alla
scadenza dell'evento e non costituisce un breve grant di lettura rinnovabile.

## Pubblicazione

Segnala apre una bozza con scelta manuale del punto sulla mappa. Il punto scelto
è distinto dalla posizione pubblica e dai marker server; può essere distante
dall'utente. Occorrono conferma esplicita, categoria e descrizione prima dell'invio.
Il server conserva il controllo di confine, zona, precisione, eleggibilità e quote:
la UI non può certificare questi requisiti. Il form informa PRIMA dell'invio che
PENDING è privato/in revisione e che NETWORK non è un canale di emergenza.

OperationId generato una volta per tentativo. Il payload viene congelato all'avvio;
doppio tap non invia due richieste. Timeout/rete/esito UNKNOWN conservano lo stesso
tentativo in memoria e non permettono modifiche o nuova operazione silenziosa.
Il pulsante di verifica ripete ESPLICITAMENTE la stessa richiesta/idempotency key.
Un successivo errore di una verifica non cancella l'incertezza precedente.
Una ricevuta confermata resta separata dalla mappa: PENDING non è mostrato come
evento attivo pubblicato e APPROVED non sostituisce una nuova lettura autorizzata.

Non sono implementati persistenza dopo crash, recupero duraturo dell'esito,
cronologia privata delle proprie submission o writer social. Non garantire replay
dopo purge del backend senza il contratto già richiesto nella Fase 11.
Risoluzione/ritiro sono disponibili nell'adattatore, ma non sono esposti come
azioni "del proprietario" basandosi sul nickname: il dettaglio pubblico non dà
una prova di ownership. Servono capability/private-submission autorevoli per
quei controlli UI, senza aggiungere account ID ai marker pubblici.

## Social: riuso e confini

I renderer del prototipo incorporano fixture, nickname demo e interazioni in
memoria: importarli direttamente nel percorso reale sarebbe scorretto. Sono
riutilizzati contratto, registro categorie e linguaggio grafico navy/anteprime;
NON i generatori, contatori locali o la finta conversazione.
NetworkEventSocial mostra conferme/aggiornamenti solo dai DTO autorizzati, offre
slot confirmations/follow/conversation/activity e segnala le funzioni non collegate.
Nessun listener, cache o modello social parallelo; nessun click Confermo/Segui
finge una scrittura. I futuri slot dovranno essere alimentati da servizi/RPC
autorizzati e rispettare lo stesso ciclo Auth. Non collegarvi widget demo.
Lo storico revisionato rimane disabilitato, distinto dalle segnalazioni concluse;
non vi vengono trasferiti nickname, commenti o eventi risolti automaticamente.

## Validazione effettuata e procedura SQL

Nessun psql/pg_ctl/Docker/Podman o servizio PostgreSQL/Docker utilizzabile rilevato
nei comandi, servizi e percorsi standard verificati. Nessun ambiente esplicitamente
usa-e-getta identificato: NON eseguito SQL, niente installazioni e nessun fallback
su Supabase remoto o database aziendali.
Resta valida la procedura riproducibile Fase 12 in
NETWORK_PHASE12_VALIDATION_AND_ADAPTER.md e il generatore
scripts/prepare-network-v2-local-validation.cjs: singola transazione e ROLLBACK,
database vuoto locale con prefisso dedicato, PostGIS/ruoli già predisposti, gate
di conferma espliciti, mai un pacchetto di deployment. Prove SQL concorrenti e
JWT/PostgREST restano NON eseguite; nessuna applicazione della migration dichiarata.

Test locali: test-network-v2-screen.cjs esercita i veri controller/repository
con trasporto simulato e scheduler controllato, comprese le race e le risposte
vecchie; il renderer React Native è sostituito da primitive per controlli struttura
smartphone/desktop e altezza ridotta dalla tastiera. test-network-native-map.cjs
verifica anche tap, draft separato, marker-press ignorato, coordinate e callback
obsolete. TypeScript noEmit e lint non compilano Swift/Kotlin né mostrano la mappa.
Rendering, tastiera reale, screen reader, provider/tile, consumo e fluidità su
Android/iOS restano da collaudare con autorizzazione separata.

## Decisioni e prossimo blocco

Restano moderazione/tempi di attesa, precisione per categoria/asset pubblici,
termini/consensi, retention/idempotenza dopo purge, recupero dopo crash e modalità
di invalidazione dei ritiri. Nessuna regola backend è stata cambiata in questa fase.
Prima di collegare un ambiente reale servono validazione PG/PostGIS, ruoli/JWT,
concorrenza, tipi RPC verificati e composition root Auth/provider/UUID affidabili.
Passo consigliato: predisporre e autorizzare l'ambiente locale usa-e-getta per la
validazione SQL effettiva, prima di montare questa schermata contro Development.
L'app non è dichiarata pronta per il pubblico o per sperimentazione reale.
