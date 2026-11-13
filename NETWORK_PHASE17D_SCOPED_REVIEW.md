# Fase 17D — evidenze riportate e variante circoscritta al solo test DDL

## Stato

Preparazione locale, non esecuzione. Nessun accesso Supabase, SQL remoto, migrazione
applicata, build, installazione, commit, push o modifica applicativa.
Branch NETWORK e HEAD e8a6abb3964ae7c3ae3a634c179bb2ece9b78c35 invariati.
Backup 57/68 file e versioni SQL precedenti preservati. Il manifest 17C resta PENDING_EVIDENCE.

## Nuova consegna

- scripts/phase17d-network-v2-ddl-rollback.sql: unico file standalone completo.
- scripts/phase17d-event-trigger-expectations.json: dieci hash forniti da Tiziano,
  condizioni e provenienza; stato SCOPED_EXPECTATIONS_RECORDED, non autorizzazione.
- scripts/prepare-network-ddl-scoped-validation.cjs: generatore locale senza executor.
- scripts/test-network-ddl-scoped-validation.cjs: verifiche statiche/negative.
- Questo documento.

Al preparatore 17C è stata aggiunta soltanto l'esportazione delle espressioni di
fingerprint già usate: nessuna modifica al suo SQL, alla query o alle approvazioni.
Il nuovo generatore importa QUELLE espressioni, anziché reinterpretare gli hash.

## Evidenze impiegate, non inventate

I dieci digest sono sintatticamente SHA-256 completi. Sono valori attesi acquisiti
dall'output READ ONLY riferito dall'utente, NON confronti online eseguiti da Codex.
Il project ref nella documentazione e gli hash non provano l'identità del server.

Per i quattro hook filtrati si controllano esattamente inventario, nome, evento,
stato O, tag (incluse differenze NULL/lista vuota), owner trigger supabase_admin,
funzione extensions associata senza argomenti e triggerMetadataSha256 riportato.
Non si approvano prosrc, definizione o metadati funzione non forniti. In particolare
le tre differenze pg_net/pg_graphql/placeholder restano NON APPROVATE nei corpi.
Anche cron è trattato con la stessa regola di non applicabilità, indipendentemente
dal fatto che il suo corpo sia stato riportato coincidente.

Per entrambi i watcher pgrst si controllano inoltre source hash del riferimento
17.6.1.166 (dedotto dal sourceMatchesReference=true riportato), definitionSha256 e
functionMetadataSha256 completi. I digest di metadati includono owner/config/flags
come nella query 17C. L'owner fornito per il trigger non è inventato come owner della
funzione: quest'ultimo è vincolato dal suo fingerprint, non da una supposizione.
Il linguaggio deve essere plpgsql e la configurazione deve essere assente oppure
limitata al solo search_path sicuro pg_catalog,pg_temp o all'esatto `search_path=""`
riferito nella revisione 17C. Il percorso vuoto conserva la ricerca implicita di
pg_catalog: i corpi watcher vincolati dagli hash usano funzioni di catalogo, non
oggetti applicativi cercati in schemi arbitrari. La nuova alternativa confronta
la stringa esatta e non ammette ulteriori configurazioni nell'array. Riferimento:
https://www.postgresql.org/docs/17/ddl-schemas.html#DDL-SCHEMAS-CATALOG .
Qualsiasi altra impostazione
fa STOP anche se il digest atteso coincidesse; non è stata presunta valida in locale.

## Perché l'esclusione è limitata e non è approvazione dei corpi

La prova vale esclusivamente per il pacchetto originale LF-normalizzato SHA-256:
4bd7016f5f84c76a7f7cde222b3c1fb9644680105f4c2b1f994ff3aa952e64fe.
Il generatore blocca modifiche a quel testo o a una delle tre migrazioni.
Questo pin NON è verificabile dal server sul testo incollato: l'operatore deve
usare il file completo revisionato, senza aggiungere istruzioni o modificarne i corpi.

Comandi eseguibili verificati: CREATE TABLE, CREATE INDEX, CREATE FUNCTION,
CREATE TRIGGER, ALTER TABLE esclusivamente ENABLE RLS, GRANT, REVOKE, controlli DO
su cataloghi, SET LOCAL, SELECT del risultato, BEGIN/ROLLBACK.
I blocchi DO non eseguono DDL dinamico, CALL o funzioni applicative. Le 30 funzioni
sono definite, non invocate. I trigger DML nuovi non scattano senza DML/fixture.
Le espressioni PostGIS e la validazione delle funzioni restano responsabilità del
PostgreSQL/PostGIS installato; non è una prova contro un'infrastruttura compromessa.

Non ci sono CREATE EXTENSION, DROP EXTENSION, DROP, ALTER distruttivi,
ON COMMIT DROP o chiamate applicative che li eseguano. ROLLBACK è annullamento
transazionale, non un comando DROP. Il corpo pgrst_ddl_watch corrispondente esegue
letture di catalogo e NOTIFY: non introduce CREATE/DROP EXTENSION annidati.
Quindi i quattro filtri extension restano fuori dal percorso, mentre l'unico hook
DDL previsto è pgrst_ddl_watch. Il drop watcher viene comunque vincolato integralmente.
NOTIFY viene consegnato solo al COMMIT, assente dal pacchetto; non confondere questa
garanzia con HTTP o log esterni. Nessun corpo sconosciuto viene invocato per verificarlo.

## Guard e condizioni operative

Le condizioni/digest di TUTTI i sei trigger vengono confrontati prima del primo
CREATE e nuovamente prima della conclusione. Trigger aggiuntivi (anche disabilitati),
modifiche a tag, identità o digest e configurazioni inattese causano STOP.
Nessun trigger viene disabilitato o modificato. Restano timeout 2s/15s/90s, ROLLBACK,
17 tabelle temporaneamente create, 150 colonne, 30 funzioni, 21 indici espliciti,
2 trigger e controlli legacy/SOS/gate OFF della Fase 17. Nessuna fixture Auth/Radar/SOS.

Le verifiche ripetute rilevano drift, ma non eliminano la race con un cambio
amministrativo nel mezzo. Non vengono imposti lock invasivi sui cataloghi.
Rimangono i lock temporanei e i trigger FK interni sui riferimenti preesistenti;
la prova non certifica assenza di log/WAL/allocazioni OID non annullabili.

Tre acknowledgement rimangono UNCONFIRMED per default:
1. phase17_target_review: identità Development verificata fuori SQL;
2. phase17d_health_review: SERVICE_HEALTH_REVIEWED_NO_ACTIVE_BLOCKER;
3. phase17d_execution_review: AUTHORIZED_DDL_ONLY_QUIET_WINDOW.
Le attestazioni registrano verifiche/autorizzazioni umane, non le producono.
L'avviso tecnico Supabase NON è stato dichiarato risolto. Occorre verificare
Dashboard/stato pertinente e una finestra senza deploy/upgrade/DDL concorrenti.

## Procedura futura minima — serve autorizzazione esplicita

1. Non occorrono nuove query generiche: i valori forniti sono già registrati.
2. Confermare identità Development, salute operativa e finestra concordata.
3. Richiedere autorizzazione al SOLO test DDL con rollback, inclusi i lock temporanei.
4. Nella copia da eseguire, impostare i tre acknowledgement con i valori attesi
   descritti nel file (identità: AUTHORIZED_DEVELOPMENT_lwkxufnbjrpsehdkfmgy).
   Non cambiare manifest, hash, filtri, migrazioni o istruzioni per far passare il test.
5. Un solo invio integrale/connessione nello SQL Editor. Nessun COMMIT o altro SQL.
   Il guard confronterà gli hash installati IN QUEL MOMENTO: nessun MATCH live è
   dichiarato da questa preparazione. Se non coincidono, STOP e raccolta del solo errore.
6. Confermare il ROLLBACK e, con lettura separata autorizzata, l'assenza dei nuovi
   oggetti e l'integrità business legacy/SOS secondo la Fase 17. Nessun DROP/cleanup
   improvvisato. In caso di errore, ROLLBACK nella stessa sessione o verifica della
   terminazione del backend; niente retry automatico.

## Verdetto

Variante tecnica locale pronta per revisione: esclusioni circoscritte e controlli
fail-closed predisposti. NON è un'approvazione generale delle definizioni differenti.
NO-GO attuale all'esecuzione: stato operativo e finestra senza deploy non confermati,
autorizzazione al test non concessa in questa preparazione. Nessun parsing/esecuzione
PostgreSQL reale, JWT, RLS su dati, concorrenza o collaudo dispositivi eseguito.
