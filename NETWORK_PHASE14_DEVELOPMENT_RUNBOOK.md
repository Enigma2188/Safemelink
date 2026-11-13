# NETWORK V2 — Fase 14: collaudo Development, preparazione non eseguita

## Stato e perimetro

Branch verificato: `codex/network-pilot-cavriago-2026-11-03`.
HEAD: `e8a6abb3964ae7c3ae3a634c179bb2ece9b78c35`.
All'inizio: 40 file non tracciati, nessuna modifica a file tracciati.
Questa fase aggiunge soltanto questo documento e due strumenti di preparazione.
Nessuna migration, policy, moderazione, contratto applicativo o fixture precedente
è stata modificata. Nessuna query SQL, connessione remota o prova PostgreSQL.

## 1. Prima di autorizzare qualsiasi operazione remota: backup

Il lavoro delle fasi 4–13 non è salvato nei commit: il solo branch remoto, un tag
o un `git bundle` di HEAD NON salvano questi 40 file non tracciati.

Proposta, da autorizzare separatamente:

1. Salvare l'elenco completo da `git status --short --untracked-files=all`, HEAD
   e branch in una cartella di backup locale con data/ora, esterna ai worktree.
2. Copiare preservando i percorsi SOLO i 40 file iniziali e i 3 di questa fase,
   senza spostare, sovrascrivere o cancellare gli originali. Confrontare SHA-256
   di ogni sorgente/copia e conservare il manifest degli hash.
3. Non includere `.env`, credenziali, `node_modules`, APK, cache o altri worktree.
   Nessuna pubblicazione automatica. Se emergono nuovi file o modifiche tracciate,
   fermarsi e aggiornare esplicitamente l'inventario prima della copia.
4. Un eventuale commit/push sarà un'autorizzazione distinta; non è stato eseguito.

## 2. Preflight: autorizzazione futura A, esclusivamente lettura

Tiziano verifica nel Dashboard che il progetto sia **lwkxufnbjrpsehdkfmgy**,
e che connessione/host siano quelli Development
`db.lwkxufnbjrpsehdkfmgy.supabase.co` (oppure il pooler ufficiale di quel progetto).
Nome database `postgres`, ruolo postgres e GUC non provano l'identità.
Se la verifica non è possibile: STOP. Non aprire Production.

Solo dopo autorizzazione, eseguire INTERO, in una singola connessione:
`scripts/phase14-network-development-preflight.sql`.
Il file usa REPEATABLE READ READ ONLY, SELECT sui cataloghi, SET LOCAL e ROLLBACK.
Non chiama RPC applicative e non legge righe di utenti, SOS o segnalazioni.
Le RPC di lettura V2 NON vanno usate come preflight READ ONLY: consumano quote.

Conservare il JSON completo in luogo controllato. Verificare, non presumere:

- Versione PostgreSQL e PostGIS nello schema `extensions`, ruoli attesi,
  auth.uid(), profiles, NETWORK base e helper eleggibilità/restrizioni.
- Colonne, tipi, vincoli, indici validi e firme RPC rispetto ai sorgenti.
- Owner, SECURITY DEFINER, search_path, grants effettivi e ACL sulle colonne;
  CREATE su public/extensions deve essere negato ad anon/authenticated.
- RLS e policy; FORCE RLS non è automaticamente obbligatorio, ma il bypass
  dell'owner postgres e del service_role deve essere considerato nei test.
- Definizioni helper e trigger confrontate con i file versionati. Gli hash
  servono al confronto prima/dopo e all'individuazione di differenze, NON provano
  che il corpo distribuito sia corretto. Non confrontare l'hash di un intero
  file migration con pg_get_functiondef: sono rappresentazioni diverse.
- Se lo storico migration è assente, non dedurre quali migration siano applicate.
  Il preflight ne rileva la presenza, non legge lo storico né certifica l'ordine.
- pg_depend non copre tutti i riferimenti testuali PL/pgSQL: va unito al confronto
  delle definizioni versionate. Corpi/argomenti trigger non sono stampati perché
  potrebbero contenere segreti; solo hash e metadati.

### Classificare lo schema prima di scegliere un pacchetto

| Risultato reale | Azione consentibile dopo revisione |
| --- | --- |
| Tutti gli oggetti territoriali 03/11 assenti, eventi 07/11 assenti | Pacchetto `--territorial=absent`: prova entrambe le migration nella stessa transazione |
| Territorialità 03/11 presente e compatibile esattamente; eventi assenti | Pacchetto `--territorial=present`: prova soltanto 07/11 più fixture |
| Schema parziale, firme incompatibili, nomi funzione/indice già occupati, grants inattesi | STOP; nessuna riparazione automatica |
| Eventi 07/11 già presenti | STOP per questo generatore; serve procedura test-only approvata sullo schema verificato |

La verifica iniziale del generatore controlla le 7/5 tabelle attese, non prova
da sola compatibilità di colonne, RPC, indici e trigger: serve il preflight.
Le dipendenze da applicare in ordine sono NETWORK base/eleggibilità, territorialità
03/11, eventi 07/11. Non riapplicare migration vecchie per ricostruire uno storico.

## 3. Effetti esterni: prerequisito bloccante prima delle fixture

Verificare le configurazioni EFFETTIVAMENTE distribuite, non solo il repository:

1. Corpi di ogni trigger su auth.users, profiles, network_preferences, tabelle
   NETWORK e su eventuali tabelle secondarie raggiunte dai trigger. Cercare email
   automatiche, trasporti HTTP/pg_net, notifiche e code consumate esternamente.
2. Database Webhooks nel Dashboard e funzioni/worker/consumer esterni che reagiscono
   a queste scritture. Un trigger generico può esistere fuori dai file versionati.
3. pg_cron: elenco effettivo di job attivi, hash/identità del comando, funzione
   invocata e dipendenze; non copiare comandi o parametri contenenti credenziali.
   Il preflight rileva catalogo/estensione, NON legge cron.job né ne verifica i job.
4. Eventuali email/Auth hook e servizi esterni: un INSERT sintetico diretto in
   auth.users non è una normale registrazione, ma può comunque eseguire trigger.

Non disabilitare cron, trigger o worker. Se l'assenza di effetti esterni sulle
fixture non è dimostrabile: NO-GO per il test su Development condiviso.
I processi esterni non si possono dichiarare inattivi dai soli cataloghi SQL.

## 4. Prova transazionale: autorizzazione futura B, scritture reversibili

Usare il NUOVO `scripts/prepare-network-v2-development-validation.cjs`, non il
generatore `prepare-network-v2-local-validation.cjs` (solo database locale vuoto).
Il nuovo generatore non si connette, non esegue SQL e non scrive file.
Legge le due migration e il test sintetico già preparato, verifica i controlli
transazionali con il lexer esistente, rimuove SOLO gli involucri esterni e produce
un unico BEGIN/ROLLBACK. Non crea schema auth o tabelle base su Development.

Esempio di SOLA generazione futura da esaminare, NON esecuzione database:

```powershell
node scripts/prepare-network-v2-development-validation.cjs --emit-sql --territorial=absent
```

Scegliere `present` solo nel caso già verificato sopra. Non inviare mai al SQL
Editor il testo delle migration originali seguito dai test: contengono COMMIT.
Salvare/revisionare il pacchetto e i suoi hash dopo l'autorizzazione; non usare
pipe dirette verso un client database.

Nella STESSA connessione del pacchetto, l'operatore autorizzato deve impostare
prima gli acknowledgement seguenti. Non inserirli stabilmente nei ruoli/database
e non considerarli prove di identità o assenza di effetti esterni:

```sql
SET safemelink.event_test_target = 'lwkxufnbjrpsehdkfmgy';
SET safemelink.event_test_external_review = 'confirmed-no-side-effects';
SET safemelink.phase14_baseline_review = 'absent'; -- oppure present, dopo preflight
```

Finché queste conferme mancano, il pacchetto fallisce prima del DDL.
In SQL Editor non presumere che due clic distinti condividano una connessione:
gli acknowledgement e il pacchetto intero devono essere sottoposti insieme in
un'unica esecuzione. Con psql usare una sola sessione e ON_ERROR_STOP.
Se il client non garantisce un'unica connessione/transazione: STOP.

Il pacchetto testa le RPC vere su fixture sintetiche con UUID nuovi, email
example.invalid e geometrie artificiali. I valori di precisione/retention nelle
fixture NON scelgono policy di produzione. Nessun SOS o invio viene chiamato.
I dati di persone reali non vengono usati come fixture o destinatari.

### Cosa può e non può essere annullato

- ROLLBACK annulla DDL ordinario incluso, tabelle/righe fixture, grant, trigger,
  indici, aggiornamenti quote e impostazioni LOCAL; rilascia lock transazionali.
- Le acknowledgement SET di sessione non sono dati applicativi: chiudere la
  sessione dedicata dopo la prova. Non riusarla per altro.
- Il CREATE INDEX ordinario può bloccare scritture sui territori anche se poi
  annullato. lock_timeout 3s e statement_timeout limitano l'attesa, non eliminano
  impatto/preparazione/tempo totale. Usare finestra di collaudo concordata.
- Invii HTTP/email/SMS già effettuati da trigger, log esterni e avanzamenti di
  sequenze NON sono annullati dal rollback. Le fixture usano UUID, ma i trigger
  distribuiti possono usare sequenze: controllarli prima. WAL/statistiche/log non
  diventano inesistenti dopo ROLLBACK. NOTIFY PostgreSQL transazionale non viene
  consegnato se la transazione è annullata; non estendere questa proprietà a HTTP.

## 5. Matrice delle prove e limiti

Le assertions sequenziali sono in `scripts/test-network-event-development.sql`,
incluse nel pacchetto. Le assertion su risultati mancanti usano confronti espliciti
IS DISTINCT FROM. Nessuna prova PostgreSQL è stata eseguita in questa fase.

| Area | Prova predisposta / risultato da ottenere |
| --- | --- |
| Default OFF | Policy incompleta non abilitabile; accesso negato con gate OFF |
| Pubblicazione | Punto esplicito richiesto; fuori territorio respinto; PENDING invisibile |
| Privacy | Punto pubblico generalizzato; nessun ID autore/payload privato nel marker/dettaglio |
| Idempotenza | Replay stesso autore/operation restituisce stesso ID; payload cambiato respinto; altro autore non eredita l'operazione |
| Moderazione | APPROVED pubblicabile; revisione vecchia rifiutata; WITHDRAWN non riattivabile |
| Isolamento | Ritiro da altro autore negato; membership/revoca e autore ristretto nascondono eventi |
| Scadenza | Fixture già scaduta non letta; risoluzione/replay non riaprono; ritiro nasconde dettaglio |
| Privilegi | EXECUTE anon negato; lettura tabella e moderazione negate con SET LOCAL ROLE authenticated |
| Antiabuso | Duplicati/limiti di pubblicazione esercitati; non equivale a test di carico |

Da aggiungere alla successiva validazione prima di dichiarare copertura completa:

- RPC coda moderazione e catalogo territori: pagine/cursori, filtri, termini,
  ritiro tra pagine e limiti; le assertions esistenti non esauriscono queste varianti.
- Ruolo service_role effettivo per coda/review e anon effettivo per tutte le RPC;
  distinguere ACL testate da simulazione auth.uid() sotto postgres. PostgreSQL
  admin può bypassare RLS: claims simulati NON dimostrano JWT/PostgREST validi.
- Caso RLS senza grant diretto vs grant/policy accidentali; verificare sia catalogo
  sia esito con ruolo client effettivo. Non concedere SELECT per far passare test.
- Raggi 1/2,5/5/10 km, bordi zona, coordinate non finite/limiti, geometrie/CRS reali,
  limite 2000 marker, errori quota lettura e tempi di esecuzione su volumi sintetici.
- Test territoriale aggregazioni/storico già presente in
  `scripts/test-network-territorial-development.sql`: revisione separata dei suoi
  guard/effetti prima dell'esecuzione; NON è automaticamente incluso nel pacchetto.

### Concorrenza: protocollo distinto, NON coperto dal test sequenziale

Due sessioni NON vedono fixture non committate dall'altra. Non promettere un test
completo multi-sessione con setup invisibile e soltanto ROLLBACK finale.
Prima scelta: cluster locale isolato/snapshot usa-e-getta con baseline sintetica
visibile ad entrambe le sessioni. Su Development servirebbe autorizzazione distinta
per setup sintetico committato e cleanup mirato: NON autorizzati da questa fase.

Protocollo da predisporre nel successivo collaudo isolato, con barrier controllate:

1. Stesso autore/operation: A mantiene lock fino al termine della creazione;
   B tenta la stessa operazione. Atteso attesa limitata/55P03, oppure un solo ID
   dopo commit controllato di A e replay; mai due righe. Variare il payload: 22023.
2. Quote: A/B con operazioni diverse dello stesso autore al limite; massimo
   numero consentito, nessun incremento perso. Con autori diversi niente leakage.
3. Review/ritiro e review/review stessa expected_revision: esito coerente con
   serializzazione, revisione obsoleta 40001 o ritiro terminale, mai resurrezione.
4. Lettura contro revoca/ritiro/expiry: distinguere snapshot prima/dopo commit;
   dopo revoca committata e nuovo statement nessun evento. Una risposta già
   consegnata non può essere ritirata retroattivamente (limite MVCC/privacy).
5. Gate/termini/membership cambiati mentre una RPC attende: ricontrollo autorizzazione
   e nessuna pubblicazione non autorizzata. Registrare SQLSTATE, lock e tempi,
   senza payload personali. Timeout/deadlock devono annullare la transazione.

## 6. Legacy e SOS invariati: prova prima/dopo

Confrontare JSON cataloghi preflight prima e dopo il ROLLBACK: hash funzioni,
firme, owner, ACL, colonne, vincoli, policy e trigger legacy/SOS devono coincidere.
Ignorare OID di oggetti nuovi temporanei; confrontare per schema/nome/firma.
Non usare dati SOS reali e non invocare RPC SOS per verificare la non-regressione.
Durante il test l'unico oggetto aggiunto a tabella preesistente dal 07/11 è
l'indice geografico dei territori; nessun trigger è aggiunto a SOS o NETWORK legacy.
Se la base territoriale era assente, deve tornare assente; se presente, identica.
Tutti i cinque oggetti tabellari eventi nuovi devono essere assenti dopo rollback.
Un nuovo preflight non dimostra da solo assenza di fixture nelle tabelle base:
preparare, dopo autorizzazione, conteggi limitati ai prefissi sintetici dedicati
prima/dopo (nessun contenuto o ID reale esportato); differenza attesa zero.
Regression test client legacy locali restano separati dal confronto DB.

## 7. Recupero in caso di errore

- Primo errore: STOP. Nella stessa connessione eseguire ROLLBACK; non COMMIT,
  non proseguire ignorando eccezioni, non ripetere automaticamente il pacchetto.
- Disconnessione: il server annulla la transazione non committata quando termina
  la sessione. Verificare in sola lettura la fine della sessione/lock e gli oggetti,
  senza presumere che la chiusura del browser termini immediatamente il backend.
- Raccogliere solo SQLSTATE, posizione, fase e hash dei sorgenti; rimuovere valori
  di fixture/parametri da errori o log prima di condividerli.
- Se compaiono oggetti/fixture persistenti, oppure un invio esterno: sospendere,
  verificare sessione e confini transazionali. Nessun DROP/DELETE o ripristino a
  memoria; piano mirato e autorizzazione separata. Un effetto esterno non è cancellato.
- Se una futura migration reale fosse già committata, ROLLBACK non la annulla:
  mantenere gate OFF, fermare l'attivazione e pianificare una migration correttiva
  additiva. Non eliminare tabelle o dati per ripristinare l'app legacy.

## 8. Checklist GO/NO-GO e autorizzazioni

1. Backup locale selettivo verificato: autorizzazione separata, non creato ora.
2. Identità Development certa; preflight remoto READ ONLY: autorizzazione A.
3. Schema/estensioni/ACL compatibili; nessun oggetto parziale o CREATE non fidato.
4. Trigger, webhook, cron e worker effettivi senza effetti esterni sulle fixture.
5. Pacchetto revisionato, una connessione, nessun COMMIT, guard non aggirati.
6. Test transazionale DDL+fixture+ROLLBACK: autorizzazione B distinta da A.
7. Assertions PASS, rollback verificato da nuova lettura e legacy/SOS invariati.
8. Concorrenza/JWT/performance non eseguiti restano limiti espliciti: programmare
   il collaudo isolato prima di uso multiutente, non dichiarare backend operativo.
9. Solo dopo revisione risultati: autorizzazione C per applicare 03/11 se necessaria
   e poi 07/11, con gate OFF e finestra lock concordata. Nessun obbligo di applicarle
   insieme; controllare il risultato tra le due. Non eseguire i test come migration.
10. Attivazione territoriale, precisione, retention, purge e moderazione richiedono
    decisioni approvate e autorizzazione ulteriore D. Nessuna policy reale scelta
    dalle fixture, nessuna esposizione automatica di legacy o storico.

Verdetto della preparazione: pronta per revisione del pacchetto e autorizzazione
del SOLO preflight. NO-GO attuale per applicazione/attivazione, finché le evidenze
remote e i test PostgreSQL effettivi non sono disponibili.
