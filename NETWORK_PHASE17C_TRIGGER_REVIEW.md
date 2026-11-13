# Fase 17C — variante esatta, ancora bloccata

Nessun SQL remoto, connessione al progetto, applicazione migration, build, installazione,
commit o push. Nessuna funzionalità applicativa modificata. File Fase 17 originali,
tre migration e backup precedenti preservati.

## Riferimento ufficiale e distinzione essenziale

Riferimento candidato: repository ufficiale supabase/postgres, tag 17.6.1.166,
`https://raw.githubusercontent.com/supabase/postgres/17.6.1.166/migrations/schema-17.sql`.
SHA-256 del file pubblico consultato:
`cf4a78fc7f6a61e0914c495320b320554785423bc1567da08770dc0230e34913`.
Non è stata certificata la build Supabase effettiva. PostgreSQL 17.6 non identifica
da solo il tag del provider. Il develop corrente contiene già differenze: non usarlo
come prova automatica di corrispondenza al database.

I sei SHA-256 di prosrc sono calcolati sul testo UTF-8 esatto dei corpi dollar-quoted
del riferimento candidato, senza normalizzazione di spazi/commenti/fine-riga.
Sono riferimenti pubblici, NON hash osservati o approvati del database.

Nel riferimento:
- issue_graphql_placeholder è filtrato su DROP EXTENSION;
- issue_pg_cron_access, issue_pg_graphql_access e issue_pg_net_access sono filtrati
  su CREATE EXTENSION. Il codice pg_net contiene gestione di permessi e definizioni
  di funzioni HTTP, non un invio HTTP eseguito dal solo rilevamento della stringa;
- pgrst_ddl_watch contiene NOTIFY per il reload schema e può essere raggiunto dal
  CREATE/ALTER del pacchetto; pgrst_drop_watch gestisce le eliminazioni.

Il pacchetto non crea/elimina estensioni né contiene DROP. Se TAG e definizioni
effettive coincidono con il riferimento approvato, i primi quattro hook non sono
raggiunti da queste istruzioni. NOTIFY PostgreSQL viene consegnato solo al commit,
non dopo rollback: `https://www.postgresql.org/docs/17/sql-notify.html`.
Questa proprietà non copre eventuali HTTP/custom hook sconosciuti o log esterni.
Una ricerca di pattern HTTP/NOTIFY non è una prova di equivalenza o di sicurezza.

## File preparati

1. `scripts/phase17c-event-trigger-evidence.sql`: unica query mirata READ ONLY.
2. `scripts/phase17c-event-trigger-approval.json`: manifest di approvazione PENDING_EVIDENCE.
3. `scripts/prepare-network-ddl-trigger-validation.cjs`: generatore locale, senza executor.
4. `scripts/phase17c-network-v2-ddl-rollback.sql`: variante completa standalone.
5. `scripts/test-network-ddl-trigger-validation.cjs`: test statici e negativi.
6. Questo documento.

## Evidenza ancora necessaria — nessuna query eseguita

La singola query usa BEGIN REPEATABLE READ READ ONLY, search_path pg_catalog,pg_temp,
timeout e ROLLBACK. Restituisce TUTTI gli event trigger, inclusi eventuali sconosciuti,
nomi attesi mancanti, tag, abilitazione, owner e identità delle funzioni.

Per ciascuno produce:
- sourceSha256: hash esatto di prosrc; sourceMatchesReference confronta il candidato;
- definitionSha256: hash completo di pg_get_functiondef, non del file migration;
- functionMetadataSha256: include owner, linguaggio, flags di sicurezza/volatility,
  firma/ritorno, ACL e impronta dell'intera configurazione della funzione;
- triggerMetadataSha256: include owner, evento, tag, abilitazione e funzione associata.

Non esporta corpi funzione, configurazioni arbitrarie in chiaro, parametri applicativi,
token o dati personali. La sola voce search_path è visibile; le altre impostazioni
sono rappresentate da hash. Query e guard usano lo stesso search_path e le stesse
espressioni per rendere riproducibili le impronte. NULL e lista vuota dei tag restano
distinti. Gli hash non sono approvati soltanto perché il database li restituisce.

Se sourceMatchesReference=false, non significa automaticamente pericolo: potrebbe
essere una diversa versione ufficiale o una differenza innocua. Rimane comunque STOP.
Servono build/provenienza esatte e revisione privata del corpo differente, senza
pubblicare eventuali segreti, prima di preparare un nuovo riferimento approvato.
Nessuna rimozione automatica di commenti/spazi o tolleranza sui corpi è ammessa.

## Variante DDL fail-closed

Conserva integralmente e nell'ordine i corpi delle tre migration e tutti i controlli
Fase 17: un BEGIN, timeout lock 2s/statement 15s/transazione 90s, ROLLBACK finale,
nessun utente/fixture, nessun DML applicativo eseguito, nessuna RPC invocata.
Nessuna modifica a SOS o NETWORK legacy; restano i lock e trigger FK interni
temporanei documentati in Fase 17. Gate V2 OFF, nessuna pubblicazione o notifica app.

La variante NON disabilita event trigger e non li ammette per nome soltanto:
- inventario esatto di sei elementi, nessuno extra anche disabilitato;
- identità, evento, tag e stato O esatti; session_replication_role origin;
- namespace extensions, funzione senza argomenti che restituisce event_trigger;
- prosrc identico al candidato ufficiale fissato;
- definizione completa e metadati funzione/trigger identici agli hash approvati.

I controlli sono eseguiti prima del primo DDL e ripetuti prima della conclusione.
Questo rileva drift, ma non annulla un effetto esterno già prodotto e non elimina
la race con una modifica amministrativa avvenuta tra verifica ed esecuzione.
Serve una finestra senza upgrade/deploy/DDL concorrenti, non lock invasivi sui cataloghi.

Oggi il manifest ha approvalStatus=PENDING_EVIDENCE, approvalRef/reviewedAt null
e tutti gli hash di definizione/metadati installati null. Nessun valore è inventato.
Anche cambiando l'acknowledgement della Fase 17, il pacchetto si blocca prima del DDL.
Una futura approvazione richiede revisione esplicita e rigenerazione del file:
modificare il JSON NON aggiorna magicamente un SQL già generato.

## Avviso tecnico Dashboard: blocco indipendente

L'avviso riferito non è stato diagnosticato o dichiarato risolto. Non avviare DDL
durante un incidente, manutenzione o instabilità pertinente al progetto/alla regione.
La variante richiede anche due conferme di sessione separate, default UNCONFIRMED:
- phase17c_health_review: SERVICE_HEALTH_REVIEWED_NO_ACTIVE_BLOCKER;
- phase17c_execution_review: AUTHORIZED_DDL_ONLY_QUIET_WINDOW.
Sono attestazioni manuali, NON verifiche automatiche del servizio o autorizzazioni.
Non impostarle finché Tiziano non ha verificato Dashboard/stato pertinente e dato
autorizzazione separata. La configurazione non contatta endpoint di salute.

## Percorso minimo successivo

1. Dopo autorizzazione alla sola lettura e verifica identità Development, eseguire
   manualmente l'unico file evidence e restituire il JSON, senza query generali.
2. Confrontare le sei fonti e revisionare owner, flags, ACL, configurazioni e tag.
   Solo dopo approvazione registrare i digest completi nel manifest con riferimento
   di revisione/data e targetBuildMatch=REVIEWED_FOR_TARGET. Nessun import automatico.
3. Attendere la risoluzione/verifica dell'avviso tecnico e una finestra concordata.
4. Preparare/rivedere nuovamente la variante dal manifest approvato. Richiedere
   autorizzazione ESPLICITA al test transazionale. Non è autorizzazione ad applicare
   migration permanentemente o ad attivare funzionalità.
5. Unica connessione, file intero, niente COMMIT; in errore STOP/ROLLBACK, nessun
   retry automatico o bypass. Successivamente verificare assenza oggetti e integrità
   dei metadati legacy/SOS secondo la procedura Fase 17.

## Verdetto e limiti

NO-GO attuale: equivalenza effettiva non certificata e avviso tecnico non risolto.
Preparazione locale completata; test solo statici. Nessun parsing PostgreSQL reale,
esecuzione DDL, prova RLS su dati, JWT, concorrenza o collaudo dispositivi effettuato.
Non dichiarare né l'infrastruttura pericolosa dai nomi né il pacchetto autorizzato
dal solo fatto che contiene ROLLBACK. Backup e file preesistenti restano invariati.
