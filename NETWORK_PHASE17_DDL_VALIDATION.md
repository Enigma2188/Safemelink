# Fase 17 — backup aggiornato e prima prova DDL PostgreSQL

## Consegna locale, non eseguita

Branch `codex/network-pilot-cavriago-2026-11-03`, HEAD
`e8a6abb3964ae7c3ae3a634c179bb2ece9b78c35`, invariati.
Non sono stati modificati componenti applicativi, migrazioni originali o altri worktree.
Nessuna connessione Supabase/MCP, SQL remoto, build, installazione, commit o push.

## Backup fino alla Fase 16

Cartella nuova, separata dal repository:
`C:\Users\FISA\Desktop\SAFEMELINK_BACKUPS\NETWORK2_Phase17_2026-11-08T10-48-51-449Z`.
68 file di progetto: tutti i 54 non tracciati e 14 file dei commit NETWORK già salvati.
Manifesto `manifest-sha256.json`, checksum del manifesto e `RIPRISTINO.md`.
Ogni sorgente è stata controllata prima/dopo copia e confrontata SHA-256 con la copia.
Non sono stati copiati .env, credenziali, node_modules, cache, APK o dati personali
identificati dalla scansione. Nessun file necessario escluso dall'inventario selezionato.
La scansione automatica non è una certificazione generale dell'assenza di PII nel testo.
Il backup contiene codice/fixture sintetiche e documentazione, non dati estratti da utenti.

Il backup Fase 14B è preservato e separato. Il nuovo backup NON contiene i quattro
strumenti/documenti preparati dopo la copia durante la Fase 17.
È un backup del delta NETWORK: per ripristinare l'intero progetto servono i file
invariati del commit HEAD, non inclusi nella copia. Non contiene il database Git.
Ripristino soltanto su nuova cartella/worktree verificata, senza sovrascrivere file
diversi o usare reset/restore/clean. La guida contiene la procedura, NON eseguita.
**Stesso disco: nessuna protezione da guasto fisico.** Serve una copia indipendente
su supporto sicuro, con autorizzazione separata; non è stata creata automaticamente.

## File SQL da revisionare

`scripts/phase17-network-v2-ddl-rollback.sql` è il SINGOLO pacchetto completo.
Deriva da `scripts/prepare-network-ddl-validation.cjs`, che legge senza eseguire:

1. `20261103120000_network_territorial_map_history.sql`;
2. `20261107120000_network_event_markers_v2.sql`;
3. `20261108120000_network_social_v2.sql` (nome effettivo social).

Sono inclusi i corpi completi nell'ordine originale, eliminando soltanto gli involucri
BEGIN/COMMIT esterni; i fine-riga possono essere normalizzati. Gli originali restano
identici al backup. Le definizioni delle funzioni contengono DML per il futuro uso,
ma NON vengono invocate: nel pacchetto non si eseguono INSERT/UPDATE/DELETE applicativi.
Non vengono caricati gli script di fixture delle Fasi 11/16 né creati utenti Auth.

Il generatore non è un esecutore e non installa nulla. Il test statico confronta
il file completo con quello generato e verifica transazioni, ordine, assenza di fixture,
guard, whitelist delle istruzioni DDL e rifiuto di comandi/guard non ammessi.
Non è un parser PostgreSQL o una prova del contenuto runtime di tutte le funzioni.

## Cosa farà la prova, solo dopo autorizzazione

- BEGIN unico; timeout locale lock 2s, statement 15s, transazione 90s, idle 30s.
  transaction_timeout richiede PostgreSQL 17+, coerente con Development 17.6 riferito.
- Identità Development verificata manualmente fuori SQL, ruolo postgres, dipendenze,
  PostGIS in extensions e assenza CREATE non fidato.
- STOP se QUALSIASI event trigger DDL è abilitato: nessuna disattivazione o allowlist
  automatica. Anche un hook Supabase apparentemente innocuo richiede revisione separata.
- STOP se tabelle/tipi/indici, prefissi di nomi generati, funzioni/overload o trigger
  previsti sono già occupati. Questo file non è per schema parzialmente installato.
- Fingerprint dei metadati preesistenti public/auth, senza leggere dati delle tabelle.
- Creazione temporanea di 17 tabelle, 30 funzioni, 21 indici espliciti e 2 trigger.
- Assertions su 150 colonne/tipi/nullabilità/ACL, vincoli validati, indici pronti,
  firme e ritorni, linguaggi, owner, volatility, SECURITY DEFINER, search_path,
  EXECUTE effettivo anon/authenticated/service_role, grants tabellari e RLS.
- Nessuna policy client aggiunta alle nuove tabelle; i tre gate devono avere default OFF.
- Confronto fingerprint prima/dopo per le definizioni business preesistenti e SOS.
- Risultato JSON `DDL_ASSERTIONS_PASSED_ROLLBACK_FOLLOWS`, poi ROLLBACK obbligatorio.
  Il JSON non certifica ancora che il successivo rollback sia terminato: serve post-check.

`check_function_bodies=on` richiede validazione dei corpi al CREATE, ma PostgreSQL
rinvia parte della risoluzione/pianificazione PL/pgSQL alla prima invocazione.
Questo test NON prova ogni query interna, regola di autorizzazione o percorso applicativo.

## Effetti residui: perché non basta ROLLBACK

Nessuna scrittura in auth.users/profiles/radar_preferences/NETWORK legacy/sos;
quindi i loro normali trigger DML non sono attivati dal pacchetto. Non viene
chiamato handle_new_auth_user. Il cron di scadenza legacy non viene modificato,
fermato o invocato. Gli altri processi non vedono normalmente nuovi oggetti non committati.

Tuttavia CREATE/GRANT/ALTER/CREATE INDEX sono DDL: possono attivare event trigger
o hook infrastrutturali e generano lock, WAL, allocazioni OID e log anche con rollback.
I log esterni e un HTTP già inviato non si annullano. Nessun NEXTVAL/SETVAL applicativo
è richiesto: gli ID dichiarati usano UUID, ma non si promette assenza di ogni traccia fisica.

Le foreign key nuove verso profiles e network_reports richiedono lock sui riferimenti
preesistenti e creano temporaneamente trigger interni di integrità referenziale sui
genitori. Non sono trigger business e non inviano avvisi, ma sono effetti DDL e possono
ritardare scritture concorrenti. Nessuna colonna/RPC/dato legacy viene sostituita.
Il fingerprint esclude intenzionalmente questi trigger interni; le nuove dipendenze
devono scomparire con il rollback. L'indice di discovery opera sui territori nuovi,
non su una tabella territoriale già popolata (il pacchetto ne richiede l'assenza).

Il guard degli event trigger non protegge da un amministratore che ne abiliti uno
dopo il controllo, né certifica ogni hook esterno del provider. Prima di autorizzare
la prova occorre una finestra senza altre operazioni DDL/deploy e conferma della
configurazione distribuita rilevante. Non prendere lock invasivi sui cataloghi e
non disabilitare protezioni per rendere eseguibile questo script.

## Unico controllo mirato ancora necessario prima del test

Da autorizzare separatamente ed eseguire manualmente SOLO su Development:

```sql
BEGIN TRANSACTION READ ONLY;
SELECT e.evtname, e.evtevent, e.evtenabled,
       n.nspname AS function_schema, p.proname AS function_name,
       md5(pg_get_functiondef(p.oid)) AS function_definition_hash
FROM pg_event_trigger e
JOIN pg_proc p ON p.oid=e.evtfoid
JOIN pg_namespace n ON n.oid=p.pronamespace
ORDER BY e.evtname;
ROLLBACK;
```

Non stampa corpi o credenziali. Un risultato con enabled diverso da D significa
NO-GO per il pacchetto attuale. Analizzare privatamente le funzioni e le dipendenze,
senza copiarne eventuali segreti, e preparare una successiva proposta autorizzata.
Non rimuovere semplicemente il guard: le fixture sono state eliminate proprio per
ridurre gli effetti non verificati. I controlli generali già forniti non vanno ripetuti.

## Procedura semplice per Tiziano — non avviata

1. Conservare il backup e revisionare questo documento e il file SQL completo.
2. Confermare nel Dashboard il ref `lwkxufnbjrpsehdkfmgy`, non solo nome database.
3. Autorizzare e raccogliere il controllo event trigger; confermare hook esterni
   e finestra senza altri DDL. Se ci sono trigger abilitati: STOP, nessun bypass.
4. Richiedere autorizzazione ESPLICITA al SOLO test DDL transazionale, inclusi i
   lock temporanei sui riferimenti legacy. Non è autorizzazione alle migration vere.
5. Solo allora, nella copia da eseguire, cambiare UNCONFIRMED nell'unico SET LOCAL
   di acknowledgement in `AUTHORIZED_DEVELOPMENT_lwkxufnbjrpsehdkfmgy`.
   Questo valore registra una conferma umana, NON verifica l'identità da solo.
   Non cambiare altro e non selezionare singoli blocchi.
6. In SQL Editor inviare il file INTERO in una sola esecuzione/connessione.
   Non usare strumenti che spezzano/riconnettono o committano ogni istruzione.
7. Registrare JSON, NOTICE, errori/SQLSTATE e risultato finale. Nessun COMMIT.
   Non considerare la sola dicitura generica Success come prova di tutti i controlli.
8. Da una nuova verifica READ ONLY controllare l'assenza di tutte le relazioni e
   funzioni nominate nei guard del file e confrontare i metadati legacy/SOS con
   il preflight già raccolto. Nessun controllo richiede lettura di SOS o utenti reali.

## Recupero in caso di errore

Alla prima eccezione fermarsi, non continuare e non riprovare automaticamente.
ROLLBACK nella stessa sessione, se ancora disponibile. transaction_timeout può
terminare il backend e annullare la transazione; una disconnessione del browser
non prova da sola che questo sia già avvenuto. Verificare fine sessione/lock in
sola lettura prima di altre prove. Non eseguire DROP, cleanup di dati o modifiche
ai trigger per recuperare. Se restano oggetti, serve diagnosi e autorizzazione
distinta: non presumere un rollback riuscito. Nessun effetto esterno è ritirabile.

## Esclusioni e verdetto

Nessuna fixture, autenticazione/JWT reale, prova effettiva di RLS su righe,
pubblicazione, moderazione, idempotenza, scadenza, concorrenza, performance,
trasporto push/SMS, cartografia o test Android/iOS. Restano prove successive.
Nessuna nuova policy privacy o moderazione scelta. Nessun gate viene abilitato.

Preparazione locale completata; controlli statici PASS. PostgreSQL locale non
disponibile tra gli strumenti rilevati: parsing/esecuzione NON eseguiti.
Nessuna incompatibilità certa di versione emersa; applicabilità reale non certificata.

**NO-GO attuale all'esecuzione**, perché event trigger DDL/hook infrastrutturali e
finestra di collaudo non sono stati verificati. Il file resta bloccato per default.
GO eventualmente limitato al test, dopo le conferme sopra, non ad applicazione
permanente, attivazione V2 o rilascio pubblico.
