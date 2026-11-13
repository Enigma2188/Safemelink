# NETWORK 2.0 — backend eventi geografici V2 (Fase 11)

**Preparazione locale, non applicata. Nessun backend dichiarato operativo.**

## Oggetti e dipendenze

Migration additiva `20261107120000_network_event_markers_v2.sql`, da eseguire solo
dopo una verifica separata dello schema reale e con ruolo controllato postgres.
Richiede PostGIS in `extensions`, strutture della migration territoriale del
03/11, profiles/network_preferences/network_config e helper di eleggibilità e
restrizioni NETWORK. La definizione di eleggibilità attesa è quella versionata
il 14/09: non vengono indeboliti termini, identità o restrizioni esistenti.
Non richiede pgcrypto/digest in uno schema presunto: gen_random_uuid è PostgreSQL.

Cinque nuove tabelle private:

- network_event_policies_v2: policy per territorio, OFF di default;
- network_event_members_v2: solo eventuale accesso PILOT;
- network_events_v2: identità privata e contenuto, solo luogo pubblico derivato;
- network_event_read_buckets_v2: un contatore corrente per account;
- network_event_write_buckets_v2: contatori ora/giorno correnti per account.

Riusa geometrie, zone BASE, fonti/licenze territoriali, non segnalazioni legacy.
Aggiunge un indice geografico alla tabella territori già predisposta; non cambia
colonne, RPC o dati precedenti. La creazione dell'indice non è CONCURRENTLY e può
bloccare scritture sui territori durante l'applicazione: finestra da pianificare.
Non inserisce territori/account/configurazioni, non modifica gate aggregati,
cron, webhook o funzioni SOS. RLS senza policy client e assenza di grants diretti.
Anche service_role non ha DML/SELECT diretto sugli eventi; usa RPC specifiche.

## RPC preparate

### Client autenticato

1. `list_network_event_territories_v2(center_latitude, center_longitude,
   radius_meters=10000, page_size=50, after_code=null, after_id=null)`
   restituisce territori abilitati/autorizzati: territoryId, code, label,
   publicCenter, locationPolicyVersion e metadati fonte/licenza/versione geometria.
   Niente conteggi o informazioni sui membri. Pagine fino a 100, cursore code+ID
   dell'ultimo elemento; scelte territoriali dinamiche, nessuna lista hardcoded.

2. `create_network_event_v2(target_operation uuid, target_territory uuid,
   event_latitude float8, event_longitude float8, location_selection text,
   target_category text, target_description text)`
   richiede `location_selection='EXPLICIT_EVENT_POINT'`. Input: cinque categorie
   del registro V2, descrizione 10–500 caratteri, punto esplicito nel territorio
   e in una zona BASE. Risposta `{publicId,status,publicationState,replayed}`.
   `publicationState=PENDING` NON significa visibile: serve revisione.

3. `list_network_event_markers_v2(target_territory uuid, center_latitude float8,
   center_longitude float8, radius_meters int, target_status='ACTIVE',
   target_category=null)` restituisce un **array completo** di marker operativi
   V2 per ACTIVE o RESOLVED. Raggi 1000/2500/5000/10000. Oltre 2000 risultati
   restituisce errore 54000, mai uno snapshot incompleto o conteggi troncati.

4. `get_network_event_detail_v2(target_public_id uuid)` restituisce il dettaglio
   operativo V2 solo se l'evento è ancora pubblicabile e il lettore autorizzato.
   Nickname e descrizione sono quelli sottoposti a revisione. Nessun account ID,
   telefono, operazione privata o luogo originale nell'output.

5. `finish_my_network_event_v2(target_public_id uuid, finish_kind text)` accetta
   RESOLVED/WITHDRAWN, solo proprietario. Ripetibile senza riattivazione. Il ritiro
   rimane possibile anche dopo restrizioni/perdita accesso di pubblicazione.

### Solo servizio fidato di moderazione

6. `list_network_event_review_queue_v2(target_territory uuid, page_size=50,
   before_created=null, before_public_id=null)`: pendenti non scaduti, massimo 100.
   Output con marker, descrizione, nickname, stato e cursore privato della pagina.
   Usare il `cursor.createdAt` completo, NON la data arrotondata del marker.

7. `review_network_event_v2(target_public_id uuid, expected_revision int,
   decision text, review_reference text)` ammette APPROVED/REJECTED/WITHDRAWN.
   La revisione attesa impedisce di approvare contenuti cambiati nel frattempo.
   Dopo WITHDRAWN non è possibile ripubblicare quella identità pubblica.

Helper interni e trigger non sono concessi ad anon/authenticated/service_role.
Le funzioni SECURITY DEFINER hanno search_path fissato a pg_catalog,pg_temp e
riferimenti qualificati; l'owner previsto è il ruolo che applica la migration,
obbligatoriamente postgres. Prima del rilascio verificare owner, ACL, privilegi
CREATE sugli schemi, dipendenze helper ed effettivo bypass RLS dell'owner.
La service key non deve mai essere distribuita nell'app. Il futuro host di
moderazione deve autorizzare gli operatori e mantenere l'audit delle review_ref;
la tabella conserva l'ultima decisione/riferimento, non un audit immutabile completo.

## Luogo scelto, posizione pubblica e identità

Non esiste lettura della posizione dell'autore. Il punto può essere scelto anche
a distanza; non si confronta con GPS, accuratezza o presenza nel Comune.
L'API non può provare che il cittadino abbia realmente toccato una mappa: il futuro
client deve richiedere una selezione/anteprima esplicita, non passare GPS di default.

Il server verifica coordinate finite (latitudine -85..85), confine e zona. Per
geometrie sovrapposte/bordi sceglie una sola zona, ordinando zone_code+UUID.
Proietta il punto in un CRS metrico configurato/revisionato, trova una cella
stabile, la interseca con zona/confine e rifiuta area insufficiente. Pubblica un
punto interno all'intersezione, ritrasformato in WGS84. La posizione originale
serve solo al calcolo: non è conservata. request_payload conserva la cella
generalizzata e contenuto, NON latitudine/longitudine originali o loro hash.

precision_meters è risoluzione della policy, NON raggio di anonimato/accuratezza.
Distorsione CRS, aree piccole, strade/edifici sensibili e identificazione indiretta
richiedono revisione territoriale. Le regioni polari oltre +/-85 sono rifiutate;
geometrie all'antimeridiano/CRS locali e qualità dei dati richiedono prove dedicate.
Il controllo +units=m non certifica che la proiezione scelta sia appropriata.
L'infrastruttura deve inoltre evitare log di body RPC/parametri/content sensibili:
non persistere il punto nelle tabelle non garantisce assenza nei log distribuiti.

## Accesso, moderazione e concorrenza

Accesso generale NETWORK: account eleggibile, termini richiesti accettati e nessun
blocco applicabile. Non servono appartenenza al pilota, residenza o convenzioni
comunali. PILOT è una modalità opzionale separata, con membri versionati,
revocabili e a scadenza. Sono ricontrollati anche autore, termini e sue restrizioni;
la revoca del suo accesso PILOT nasconde i relativi eventi in tale modalità.

La pubblicazione nasce PENDING; nessuna approvazione automatica o falsa garanzia
di rilevamento PII. Il moderatore deve valutare testo, nickname e punto pubblico.
Un cambiamento di contenuto invalida la review. Il trigger protegge provenienza,
revisioni, terminalità e impedisce estensioni della scadenza. updated_at usa
clock_timestamp monotono rispetto alla riga precedente per i lock tardivi.

Creazioni concorrenti dello stesso autore sono serializzate con advisory lock
transazionale, lock_timeout 3s e vincolo univoco (autore,operation_id). Il replay
restituisce la stessa identità senza riaprire eventi. Un payload diverso causa
22023. Punti diversi nella medesima cella/zona, con medesimo contenuto/policy,
sono intenzionalmente la stessa richiesta pubblica: il luogo originale non viene
conservato per confrontarli. Una nuova segnalazione richiede nuova operazione.

Duplicati dello stesso autore/cella/categoria/descrizione vengono respinti per
10 minuti. Contatori atomici globali per autore, con finestre fisse UTC ora/giorno,
non dipendono dalla conservazione degli eventi. Non sono finestre mobili e non
impediscono ogni abuso/coordinamento. Letture hanno contatore minuto corrente;
catalogo ha tetto 120, marker/dettagli il limite della policy. Nessuno storico
per-richiesta viene creato. Quote ed errori non sostituiscono protezioni gateway,
limiti di traffico, rilevazione abusi e capacità di moderazione reali.

Le letture finali ricontrollano riga corrente, policy, restrizioni, termini e
membership nello stesso statement: non serializzano un record privato catturato
prima di un ritiro già committato. Rimane il limite MVCC: un cambiamento dopo
l'inizio dello statement può non essere osservato dalla lettura in corso; nessun
sistema può ritirare dati già visualizzati/copiati. Il client deve invalidare le
letture e rispettare validUntil; cache/in-flight e revoche richiedono collaudi.

## Compatibilità e confini

La migration territoriale precedente resta invariata. Le sue pubblicazioni sono
aggregati di zone e storico revisionato, NON eventi automaticamente convertibili.
Nessuna categoria legacy viene reinterpretata, nessuna coordinata ambigua viene
importata. La nuova tabella non alimenta trigger, notifiche o cron NETWORK legacy.

Array e campi dei marker ACTIVE/RESOLVED corrispondono al contratto TypeScript V2:
UTC con millisecondi, representation GENERALIZED_EVENT_POINT, nessun campo extra.
Un futuro NetworkMapMarkerSource può validare l'array e passarne lo snapshot al
controller Fase 10, che già protegge da risposte tardive/cambio contesto.
Non è stato scritto un adattatore TypeScript né modificato un contratto esistente.

HISTORY non è supportato da questa RPC operativa: va instradato a un contratto
storico revisionato autorizzato separatamente. Non rispondere con eventi o uno
storico fittizio per soddisfare quel filtro. Il dettaglio iniziale ha conferme
reali pari a zero e updates vuoto: non esistono ancora writer V2 per queste
interazioni né per i commenti. Non trasferire le interazioni demo nel backend.

## Test preparati e verifiche effettive

- `scripts/test-network-event-backend.cjs`: controlli statici/lessicali locali su
  transazioni, ACL, allowlist DTO, separazione legacy, guard e formule SQL.
  NON è un parser PostgreSQL né una prova di comportamento SQL.
- `scripts/test-network-event-development.sql`: unica transazione con fixture
  casuali sintetiche e ROLLBACK; bloccata di default prima delle fixture.
  Richiede schema già predisposto e verifica esterna di identità del progetto,
  trigger auth/profile, webhook/worker ed eventuali effetti non transazionali.
  Un GUC di conferma non prova da solo l'identità: non usarlo come bypass.

La prova sequenziale copre gate OFF, policy incompleta, selezione esplicita,
confine, pending, replay/conflitto, duplicati/quote, approvazione stale, lettori
generali/pilota, revoca membership/restrizioni autore, risoluzione, ritiro,
scadenza, output e privilegi. Non chiama funzioni SOS, SMS, HTTP o push.
Auth/users e profili vengono creati solo come fixture: i trigger distribuiti
potrebbero differire dal repository e vanno revisionati PRIMA dell'esecuzione.
In caso di errore eseguire ROLLBACK/chiudere la connessione; mai COMMIT.

Non è stato rilevato un PostgreSQL/PostGIS locale configurato né un parser SQL
adatto fra gli strumenti disponibili. SQL NON eseguito/compilato, RLS/JWT non
provati, prestazioni e concorrenza PostgreSQL non validate. Nessuna installazione.

Test futuri obbligatori su DB isolato: due connessioni stesso autore/operation
(una sola riga, replay corretto), quota all'ultimo slot (un solo successo), account
diversi (nessun ID incrociato), review contro resolve/withdraw/policy OFF,
ritiro durante lettura, deadlock/timeout e retry controllato. Ripetere con ruoli
SQL effettivi e JWT/PostgREST, non soltanto claims simulati da postgres.
Load test su indici spaziali, contese contatori, query dense >2000, piani EXPLAIN,
moderazione e CRS diversi prima di utenti reali. Non eseguire prove concorrenti
con fixture committate su un database condiviso senza piano dedicato e cleanup.

## Gate prima di Development e di attivazione pubblica

Prima di applicare: autorizzazione separata, identità Development verificata,
schema/extension/helper/owner/grants confrontati col database reale, revisione SQL
PostgreSQL e piano per lock dell'indice. Prima scelta prudente: DDL e test nello
stesso DB locale usa-e-getta/transaction rollback, senza COMMIT intermedio.
Se si include la migration nel test reversibile occorre un pacchetto dedicato
che rimuova i suoi BEGIN/COMMIT in modo verificato: non concatenare i file.
Non è stato applicato nulla e non è stato creato un esecutore remoto automatico.

**BLOCCANTI PER ATTIVAZIONE/RILASCIO:** approvazione di precisione/CRS/area,
termini e informativa per nuove categorie, pubblicazione nickname, basi/consensi,
conservazione e gestione contenuti rifiutati, moderazione e ritiro. Nessun valore
di produzione viene scelto da questa bozza. Policy inesistenti/OFF = nessuna
pubblicazione possibile. Cambiare una policy pubblicabile richiede spegnimento,
nuova versione/revisione e trattamento esplicito dei record della vecchia policy;
non riutilizzare versioni per riattivare record né cambiare geometrie in silenzio.

purge_after è un limite di lettura e pianificazione, NON cancella fisicamente i
dati. Prima di attivare servono procedura/worker di conservazione autorizzati,
retention dei contatori, gestione cancellazioni e audit, e definizione del periodo
di idempotenza/tombstone dopo eventuale purge. Non è garantito il replay di una
operazione il cui record sia stato successivamente eliminato: il futuro contratto
di purge/retry deve prevenire reinvii fuori finestra. Non è stato implementato un
DELETE o uno scheduler senza queste decisioni. Nessuno storico è creato
automaticamente alla risoluzione/scadenza e nessuna retention definitiva è fissata.

Il backend resta **non operativo e non pronto al rilascio pubblico** finché non
sarà applicato e collaudato con autorizzazioni separate.
