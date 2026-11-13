# NETWORK 2.0 — Fase 12: verifica locale e adattatore applicativo

## Risultato e limiti

Adattatore locale tipizzato per le RPC Fase 11, senza import del client globale,
senza createClient, navigazione, fixture o richieste reali. Il componente nativo,
controller, contratti e backend SQL precedenti restano invariati.
Non è una dichiarazione di disponibilità di NETWORK multiutente su Supabase.

Non sono stati rilevati psql, pg_ctl, Docker o un servizio PostgreSQL locale
utilizzabile. Non sono stati installati strumenti. I test PostgreSQL/PostGIS,
RLS effettiva, JWT/PostgREST, concorrenza SQL e piani di esecuzione NON sono stati
eseguiti. La revisione locale e i controlli lessicali non sono un parser SQL.

## Adattatore

`backend/repositories/NetworkV2Repository.ts` contiene:

- NetworkV2RpcArgs: soli cinque endpoint client, parametri coincidenti con le
  firme SQL locali; nessuna RPC di moderazione o service key nel client;
- createNetworkV2SupabaseTransport(client): usa la reale interfaccia
  rpc(name,args).abortSignal(signal), senza leggere credenziali o creare sessioni;
- NetworkV2Repository, compatibile con NetworkMapMarkerSource;
- tipi distinti per query, territori, pubblicazione, ricevuta e errori.

Le risposte restano unknown fino alla validazione runtime. Marker/dettagli usano
i guard V2 esistenti; copie con allowlist e freeze impediscono mutazioni della
sorgente. Territorio, categoria, stato, ID richiesto, scadenza e duplicati sono
controllati. Campi privati/extra o risultati incoerenti non diventano marker.
Nessuna cache di marker, dettagli o dati di un account precedente viene creata.

Le UUID di richiesta sono canoniche minuscole, come quelle restituite da
PostgreSQL. Il backend di questa fase limita il centro/punto di richiesta a +/-85
gradi: l'adattatore rifiuta valori maggiori, non li corregge silenziosamente.
Il centro pubblico di un territorio può invece essere valido fino a +/-90.

La factory è verificata staticamente contro il tipo reale SupabaseClient della
versione installata, con uno schema RPC locale tipizzato. Il Database globale
attuale non è stato aggiornato per fingere funzioni già distribuite: prima del
wiring reale, le firme devono essere verificate sul DB applicato e integrate nei
tipi generati. Non risolvere la differenza con cast any o conversioni legacy.

### Stato e autorizzazione

- `loadMarkers(query, signal)` restituisce solo operativi ACTIVE/RESOLVED validi;
  timeout/errori non producono una finta lista vuota. HISTORY fallisce in modo
  esplicito con UNSUPPORTED_HISTORY: non viene convertito dal legacy.
- `loadDetail(publicId, signal)` restituisce solo dettaglio operativo valido e
  non scaduto. Una nuova richiesta dettaglio rende obsolete le risposte della
  selezione precedente. La futura UI deve svuotare lo stato prima di attenderla.
- `loadTerritories(query, signal)` carica territori autorizzati e metadati pubblici,
  con cursori separati e pagina fino a 100. Non usa Cavriago o residenza fissa.
- `publish(request, signal)` richiede punto evento esplicito e operationId fornito
  dal chiamante. Una ricevuta ACTIVE + PENDING è una bozza server in attesa,
  NON un marker visibile. Anche APPROVED nella ricevuta non sostituisce la lettura
  autorizzata corrente; non inserire la ricevuta direttamente sulla mappa.
- `finish(id, kind, signal)` verifica il risultato void/null della RPC. Aggiornare
  controller e dettaglio tramite nuove letture solo dopo un esito confermato.

Il codice non può dimostrare che un server abbia davvero applicato RLS o
generalizzazione: sono responsabilità SQL, da verificare con ruoli/JWT reali.
Non visualizza autonomamente nulla: il binding nativo Fase 10 riceverà gli
snapshot del controller costruito con questa sorgente. Nessuna route modificata.

### Account, concorrenza, rete e scritture incerte

Il proprietario fornisce `getAccessKey(): string|null`, un epoch opaco derivato
dallo stato Auth verificato: NON un token, nickname o account hardcoded.
Su logout/cambio account/perdita autorizzazione deve cambiare subito l'epoch,
chiamare controller.setContext(null), repository.invalidate e svuotare il
dettaglio sensibile, prima di mostrare un'altra sessione. Nuovo contesto/query
vanno poi consegnati al controller. dispose termina definitivamente il repository.
Questa integrazione con il ciclo Auth dell'app resta da implementare separatamente;
non è simulata dall'adattatore e non basta smontare la sola vista della mappa.

Ogni lettura ha una generazione: markers/detail/territories hanno corsie separate,
una selezione corrente ciascuna. I risultati vecchi sono scartati anche se il
trasporto ignora AbortSignal. Timeout predefinito 12 secondi e cancellazione sono
limitati; niente polling, retry automatici, code o servizi aggiuntivi.
Istanze separate sono necessarie per controller indipendenti contemporanei.

Gli errori hanno motivi controllati (accesso, rete, server, timeout, dati invalidi,
conflitto, quota, RPC assente, contesto/risposta obsoleti), senza messaggi grezzi,
stack o payload del server propagati come diagnostica applicativa.
Una scrittura partita e poi interrotta può essere stata committata: outcome UNKNOWN
per timeout, rete, risposta non valida o cambio contesto. Non confermare creazione
o chiusura e NON creare una nuova operationId per riprovare la stessa azione.
Solo errori server espliciti conosciuti vengono classificati NOT_CONFIRMED.
Nessuno dei due esiti significa messaggio pubblicato/letto dal cittadino.

La conservazione duratura dell'operationId, il recupero dopo crash e la finestra
di replay dopo purge non sono implementati qui: richiedono un contratto dedicato
di recupero e conservazione. Non introdurre un outbox con luogo originale o testo
personale senza definire prima privacy e durata. Per il funzionamento pubblico
questi aspetti restano prerequisiti, non garanzie offerte dai test locali.

## Pacchetto PostgreSQL riproducibile, solo locale usa-e-getta

`scripts/prepare-network-v2-local-validation.cjs` legge i file effettivi:

1. blocco profiles dello schema iniziale;
2. migration NETWORK del 07/09;
3. colonne/nome e funzione di eleggibilità del 14/09;
4. migration territoriale del 03/11;
5. migration eventi del 07/11;
6. test SQL sintetico Fase 11.

Il generatore verifica ed elimina SOLO gli involucri transazionali esterni,
usando un lexer che distingue commenti/stringhe/body dollar-quoted. L'output ha
un unico BEGIN e un unico ROLLBACK, nessun COMMIT intermedio. Non modifica gli
originali. Il bootstrap auth.uid legge claims simulati: NON verifica JWT.
Le altre tabelle/RPC NETWORK sono quelle locali versionate, non mock dei writer.

Il pacchetto richiede ruolo postgres, database vuoto con prefisso
`safemelink_network_v2_disposable_`, PostGIS GIÀ disponibile nello schema extensions
e ruoli anon/authenticated/service_role GIÀ esistenti. Rifiuta un database con
profiles, schema auth o cron.job preesistenti. Non è eseguibile sul progetto
Supabase esistente. Il bootstrap auth e la revoca CREATE sul public del database
scratch sono interamente nella transazione e vengono annullati.
Nessun ruolo globale viene creato/modificato e nessuna estensione viene installata
dal generatore. I CREATE EXTENSION IF NOT EXISTS del sorgente richiedono PostGIS
già presente, verificato prima. Non è un pacchetto di deploy né una migrazione
applicabile in produzione.

### Procedura futura, non eseguita in questa fase

Prerequisito: ambiente PG17/PostGIS locale isolato già predisposto e autorizzato,
con database scratch vuoto e ruoli richiesti. Se manca, STOP: non installare,
non ripiegare su Supabase e non usare un database condiviso. L'esempio presume
un cluster dedicato verificato su 127.0.0.1:55432; non sostituirlo con host remoti.
Confermare esternamente assenza di automazioni/worker sul cluster usa-e-getta.

1. Dalla cartella NETWORK, eseguire solo il controllo senza SQL:
   `node scripts/prepare-network-v2-local-validation.cjs`
   L'output atteso è PACKAGE_CHECKED_NOT_EXECUTED con hash degli input.
2. Preparare e revisionare il pacchetto completo. In PowerShell 7:

   ```powershell
   node scripts/prepare-network-v2-local-validation.cjs --emit-sql |
     Set-Content -Encoding utf8 .expo/network-v2-local-validation.sql
   ```

   Non eseguire se compare un COMMIT o se differisce dagli input revisionati.
   Non includere il file generato in commit o archivi build.
3. Solo con successiva autorizzazione, aprire una singola connessione locale:

   ```text
   psql -X --set ON_ERROR_STOP=1 --host 127.0.0.1 --port 55432 --username postgres --dbname safemelink_network_v2_disposable_phase12
   ```

   Nella stessa sessione, dopo verifica manuale del target:

   ```sql
   SET safemelink.local_validation_ack = 'LOCAL_DISPOSABLE_NO_REMOTE';
   SET safemelink.event_test_target = 'VERIFIED_LOCAL_DISPOSABLE';
   SET safemelink.event_test_external_review = 'confirmed-no-side-effects';
   ```

   Poi `\i .expo/network-v2-local-validation.sql` dalla directory NETWORK.
   Le conferme non provano identità/assenza worker: dichiarano verifiche esterne
   dell'operatore. In caso di errore: ROLLBACK e stop, nessuna riparazione automatica.
4. Registrare versione PG/PostGIS, SQLSTATE/posizione degli errori, esito delle
   assertions e ROLLBACK finale. Verificare da nuova connessione che auth/profiles
   e network_events_v2 creati dal pacchetto siano assenti, PostGIS preesistente
   sia rimasto invariato e nessuna fixture sia persistita.

Il test sequenziale non prova tutte le RPC/catalogo/coda in ogni variante né
concorrenza. Preparare poi due connessioni sullo stesso cluster isolato per prove
di replay/quota/review/ritiro concorrenti, con fixture dedicate e piano cleanup
autorizzato: non improvvisare fixture committate su Development condiviso.
Solo dopo passare a una validazione JWT/PostgREST locale e, separatamente,
a preflight/applicazione Development autorizzati.

## Decisioni di prodotto: proposte, nessuna regola cambiata

### Moderazione senza presidio continuo

La soluzione corrente può funzionare senza presenza continua SOLO accettando
tempi di attesa: PENDING rimane privato, con finestre di revisione dichiarate,
scadenza e possibilità di ritiro. La futura UI deve dirlo chiaramente e non
presentare NETWORK come canale di emergenza o promettere pubblicazione immediata.
Per un primo rilascio controllato questa è l'opzione più coerente col SQL attuale.

Alternativa da approvare: trattamento differenziato per categorie, contenuti
strutturati e livelli di fiducia, con controlli automatici come supporto e una
coda di escalation umana. Buche/lampioni non sono automaticamente privi di rischi:
testi, nickname, foto e punti possono contenere dati personali/accuse. Filtri
automatici non equivalgono a moderazione garantita. Eventuale auto-pubblicazione
richiede nuova policy e valutazione abusi; non è stata abilitata.
Moderatori di comunità possono distribuire il carico, ma richiedono ruoli server
per territorio, audit, formazione, ricorsi e revoca; mai service key ai volontari.
Decisione a Tiziano: accettare attesa dichiarata o finanziare/progettare il modello
di revisione differenziato. Non è necessario un accordo con un Comune.

### Precisione per buche e lampioni

Non esiste una risoluzione di produzione scelta: 500 metri nelle fixture sono
solo numeri sintetici. Una griglia ampia può essere insufficiente per distinguere
due lampioni o un lato della strada; min_cell_area non prova utilità o anonimato.
Il punto dell'evento NON è quello dell'autore: si può segnalare da lontano.
Tuttavia punto, nickname, orario e descrizione possono comunque identificare
indirettamente persone o indirizzi sensibili.

Proposta futura: policy differenziate per categoria/contesto. Per viabilità e
illuminazione, preferire selezione di un asset pubblico noto o tratto stradale
(ID lampione/segmento se esistono dati aperti adeguati), non un punto personale.
Il server convalida l'asset e produce il punto pubblico; la mappa rimane riusabile.
Per segnalazioni sensibili, area più ampia e revisione esplicita; niente precisione
di abitazioni come default. Qualità/licenze dati e luoghi sensibili vanno valutati.
Scegliere le soglie solo dopo prove di utilità su strade reali e revisione privacy.
Nessuna precisione, categoria o regola SQL è stata modificata automaticamente.

## Prima del collegamento reale

Mancano esecuzione PG/PostGIS, prove ruoli/JWT e concorrenza, decisioni privacy e
moderazione, retention/purge e recupero scritture incerte, schema realmente
distribuito e tipi RPC verificati. Poi integrazione Auth sincrona con controller
e dettaglio, UI di stato PENDING/errore, adattatore storico autorizzato e collaudi
multiutente/dispositivi/carico. Nessuna nuova funzione sostituisce le prove reali.
