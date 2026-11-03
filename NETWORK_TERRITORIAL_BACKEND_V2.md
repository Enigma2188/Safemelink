# NETWORK territoriale V2 — bozza backend locale, default OFF

Base: `9fd27c740ef4ecc2f0bb6655431d57295ee72fff`. Nessuna applicazione remota.
Questa è una prima implementazione revisionabile, NON un backend pronto al rilascio.
Non sostituisce il feed, l'onboarding, le RPC o il cron NETWORK esistenti.

## Strutture e flusso

1. `network_map_territories_v2`: confine comunale MultiPolygon, provenienza,
   licenza/versione, policy e gate OFF. Nessun Comune o parametro privacy è inserito.
2. `network_map_zones_v2`: catalogo stabile di zone pubbliche e UUID nuovi,
   con livello esplicito (`BASE` per default).
   Confini, copertura completa, assenza di sovrapposizioni e dimensione delle zone
   devono essere verificati sul dataset ufficiale prima dell'importazione.
   Non viene inventata alcuna geometria di Cavriago. Il catalogo è riutilizzabile
   per altri Comuni; la versione va congelata durante ogni pubblicazione.
3. `network_map_members_v2`: accesso pilot autenticato, per territorio, versione
   della policy, scadenza e revoca. Si controllano anche eligibility/restrizioni legacy.
4. `network_map_sources_v2`: collegamento PRIVATO al report NETWORK esistente,
   con revisione esplicita della base di inclusione; nessuna importazione automatica.
5. `network_map_publications_v2` + `network_map_publication_sources_v2`:
   aggregati candidati/revisionati/ritirati con collegamenti privati verificabili.
6. `network_history_entries_v2`: schede redatte e revisionate separatamente,
   mese generalizzato, categoria, nuova identità pubblica, revisione e scadenza.

Nessun collegamento con tabelle SOS. La sola coordinata utilizzata per aggregare
è `network_reports.public_location`; mai `location` privata. Lo spostamento del
centro della mappa non ricalcola gli aggregati. Nessun geocoding del testo.

Il servizio amministrativo futuro dovrà associare esclusivamente fonti ammesse,
preparare i candidati, controllare deduplicazione/confini e costruire in una
transazione i collegamenti completi della pubblicazione. L'helper candidati non
pubblica niente: raggruppa un mese UTC con spareggio deterministico delle zone
  di confine. La stessa funzione canonica privata viene chiamata da candidati,
  validazione delle pubblicazioni e storico: una fonte ha una sola zona per
  territorio/livello, anche su un confine condiviso. Spareggio per zone_code con
  collazione C, poi UUID. Zone non interamente coperte dal territorio sono escluse.
  Per un trimestre il servizio dovrà ricostruire l'insieme completo,
non sommare contributor distinti dei singoli mesi.

## Contratti RPC predisposti

- `get_network_territory_context_v2(uuid)`: confine, label, versione geometrica,
  policy, tipo periodo e raggi consentiti.
- `list_network_map_cells_v2(uuid, integer?, double precision?, double precision?, text?)`:
  intero territorio senza coordinate, oppure raggio 1/2,5/5/10 km. Restituisce
  zone intere che intersecano il raggio, NON conteggi di frammenti del raggio.
  DTO: zona/label/geometria, disponibilità, fascia LOW/MEDIUM/HIGH, periodo UTC
  semiaperto [inizio,fine), policy e scadenza. Nessun conteggio esatto né distanza
  individuale. L'ultimo parametro seleziona un livello, BASE per default.
  LOW non significa quartiere sicuro o assenza di rischio.
- `list_network_zone_history_v2(uuid,uuid,integer?,date?,uuid?)`: pagina di 20 schede
  per default, massimo 50, nuove identità,
  mese/categoria/testo revisionato, stato CONCLUDED e scadenza. Nessun totale
  pubblico o cursore sul report originale. nextCursor contiene solo il mese
  generalizzato e l'UUID pubblico dell'ultima scheda. Ordinamento mese DESC,
  UUID DESC; filtri prima del LIMIT e una riga extra per verificare altra pagina.
  Una coppia di cursori parziale è rifiutata. I cursori non sostituiscono i
  controlli di membership/coorte, ripetuti su ogni pagina. Una revoca può svuotare
  pagine successive: non viene promesso uno snapshot immutabile tra richieste.
- `network_map_candidates_v2(uuid,date,text?)`: SOLO service_role, conteggi privati per
  mese e autori distinti. Non prova che account distinti siano persone distinte.
- Tre helper di accesso/sicurezza/geografia non sono eseguibili direttamente dal client.

Tabelle con RLS e nessuna policy client, privilegi diretti revocati ad anon e
authenticated. Tre RPC di lettura autorizzate ad authenticated con controlli
interni. SECURITY DEFINER con oggetti qualificati e search_path pg_catalog,
pg_temp. L'owner sarà il ruolo di deployment: prima dell'applicazione verificare
che sia un ruolo fidato non assumibile dal client, ACL/default privileges e
privilegi CREATE sugli schemi public/extensions. Non è verificato da remoto qui.

## Pubblicazione e privacy

Default OFF, nessuna membership, nessuna fonte o pubblicazione. Per abilitare
servono riferimenti non vuoti a decisioni del titolare, retention e revisione
privacy, soglie esplicite, durata snapshot e tipo periodo. Non sono autorizzazioni
legali automatiche: il database può verificare la presenza dei riferimenti, non
la qualità/veridicità della valutazione. Solo un operatore fidato può gestirli.

Le soglie di report/autori sono condizioni necessarie, MAI prova di anonimato.
Ogni rilascio richiede revisione documentata di individuazione, correlazione,
inferenza, account multipli, testo, categorie rare, sorgenti esterne, feed legacy,
confini e confronto con release già viste. Niente filtri arbitrari per data,
categoria o zoom. Un solo periodo approvato per territorio e una pubblicazione
approvata per zona; periodi diversi contemporanei falliscono in chiusura.
Nessun totale territoriale utilizzabile per sottrazione. Il catalogo delle zone
è pubblico, non dipende dalla presenza di cittadini o segnalazioni.

I conteggi non vengono esposti. Fonti ritirate, cancellate, nascoste, cambiate di
moderazione o collegamenti incompleti invalidano la pubblicazione, anche se era
approvata. La risposta è INSUFFICIENT_DATA, mai zero/verde per assenza di prova.
Resta possibile correlare pubblicazioni già osservate: nessuna garanzia statistica
contro differencing fra versioni successive è implementata. BLOCCANTE PER IL
RILASCIO: protocollo di pubblicazione/revisione, anti-scraping/rate limit al
gateway e analisi degli attacchi di composizione. La RPC non scrive rate limit.
  Anche confronti fra livelli geografici devono essere inclusi nella revisione:
  la disponibilità di un secondo livello non equivale a permesso di pubblicarlo.
  Modifiche a zone/confini, membership delle coorti o aggregati approvati richiedono
  ritiro e nuova revisione amministrativa prima di una nuova release. Il servizio
  di pubblicazione/versionamento territoriale non è ancora implementato; resta
  BLOCCANTE PER IL RILASCIO. Nessuna policy definitiva di rumore/delay/retention
  viene decisa qui, né si dichiara sicura una sequenza di release solo per le soglie.

## Storico, moderazione, rettifica, ritiro

Scadenza del feed NON crea schede storiche. Nessun trigger/cron nuovo. Il testo
originale non viene copiato automaticamente: il moderatore redige una sintesi
priva di nomi, indirizzi privati, targhe, accuse personali o dettagli sanitari.
Il database non può certificare la redazione; la revisione umana è indispensabile.
Una scheda può essere pubblicata solo se conclusa, visibile, con fonte ammessa e
aggregato della stessa zona/periodo ancora pubblicabile. Il controllo richiede
anche il collegamento esplicito fonte -> pubblicazione, la zona canonica della
fonte, categoria coerente e mese UTC ricavato dalla fonte; un aggregato estraneo
non può autorizzare una scheda. Testi individuali possono
comunque identificare: il revisore deve negare la scheda quando non sicura.

Prima versione volutamente restrittiva: l'archivio privato può conservare bozze,
ma la RPC espone solo il periodo attualmente autorizzato, ora con paginazione
keyset limitata alle schede già pubblicabili. Bozze/ritiri non consumano la pagina.
Navigazione pubblica fra più periodi e categorie filtrabili
NON sono ancora implementate: richiedono revisione del rischio di composizione.
Non presentare questa bozza come uno storico plurimensile già rilasciabile.

Il trigger BEFORE UPDATE, soltanto sulla nuova tabella dello storico, forza DRAFT,
azzera approvazione e incrementa revision quando cambia testo, categoria, mese,
zona, fonte, territorio, policy o scadenza. L'UUID pubblico è immutabile e un
contatore revision fornito dal chiamante non scavalca quello calcolato. Non basta
impostare contemporaneamente APPROVED nella stessa modifica: serve una seconda
operazione di revisione. Ritiro senza modifiche ai contenuti è immediato.
L'operatore amministrativo futuro dovrà usare lock e revisione attesa per non
approvare contenuto cambiato da un altro operatore: l'approvazione concorrente
non è certificata da questo trigger e richiede test reali/procedura dedicata.
Nessuna RPC di scrittura per
il cittadino o console moderatore è introdotta ora. Il ruolo service_role è
fidato e non deve mai raggiungere l'app; non è un controllo di doppia approvazione.
Il registro amministrativo e i ruoli nominativi della moderazione sono ancora
da autorizzare/progettare prima di operare su dati reali.

Revoca della fonte sopprime sia aggregati sia storico. Cancellazione del report
fa cascata sui collegamenti e sulla scheda, senza cancellare altri report.
Non si introduce un archivio che aggiri l'erasure dell'account. Nessuna nuova
retention definitiva: valid_until è scadenza di pubblicazione, NON cancellazione
del dato dal database. Politica di conservazione/purge/backup, base giuridica,
informativa, diritti/rettifiche, responsabilità della moderazione e valutazione
DPIA sono BLOCCANTI PER IL RILASCIO. Sei mesi non è una decisione approvata.
Il GPS privato legacy NOT NULL non viene alterato o conservato in copie nuove.
Dati già visti/coperti da screenshot non possono essere ritirati retroattivamente.
Le SELECT usano lo snapshot MVCC della singola richiesta: una revoca concorrente
può completarsi dopo l'inizio della lettura. Non è garantita revoca retroattiva
di una risposta in volo. Il futuro client deve scartare risposte obsolete dopo
cambio account/background, non persistere questi dati e rispettare validUntil;
il trasporto dovrà usare Cache-Control no-store. Nessun client nuovo è modificato qui.

## Verifiche locali e piano test separatamente autorizzato

`node scripts/test-network-territorial-backend.cjs`: contratti/struttura SQL,
RLS/ACL dichiarati, DTO, gate, policy, geografia condivisa, coorte, paginazione,
invalidazione editoriale e script ROLLBACK.
NON esegue PostgreSQL e NON dimostra anonimato o correttezza della sintassi SQL
su una vera istanza. Non sostituisce test di privilegi con SET ROLE.

`scripts/test-network-territorial-development.sql`: preparato, NON eseguito.
Una transazione con territori/zone, TRE account sintetici senza credenziali e
CINQUE report NETWORK sintetici (nessun SOS/destinatario). UUID casuali, email
example.invalid, telefono fittizio non usato per invii. Auth INSERT SQL, non
signup HTTP; il bootstrap versionato crea profilo/Radar con default privati.
Prima di autorizzare l'esecuzione bisogna verificare identità Development E tutti
i trigger/webhook effettivi sulle tabelle auth.users, profiles, Radar preferences,
network_preferences, network_reports e sulle nuove tabelle. Se ci sono effetti
esterni o trigger non verificati: STOP. Nessun trigger viene disattivato dal test.
Lo script è bloccato per default e richiede attestazioni di questi controlli nella
stessa connessione; esse NON provano da sole ambiente o sicurezza dei trigger.

Predisposti casi positivi con ruolo authenticated reale, lettura mappa e storico;
negativi per fonti fuori zona/periodo/coorte, account fuori pilot, altro territorio,
revoca membro/fonte, moderazione, confine condiviso e livello distinto. Inclusi
101 draft più recenti, due pagine senza duplicati, correzione che invalida revisione,
riapprovazione esplicita e ritiro. Le modifiche di fixture rimangono nella transazione
con ROLLBACK; non vengono eseguite chiamate transport, SOS, cron o invii esterni.
Nessun dato reale viene aggiornato; il test SELECT della config legge solo i termini.
Se una assertion fallisce, la transazione resta abortita fino al ROLLBACK, da eseguire
anche se il client interrompe la visualizzazione dei risultati.

Queste prove sono PREPARATE, NON ESEGUITE: non dichiarare PASS PostgreSQL.
Prima di qualsiasi pilot servono anche esecuzione delle prove e test concorrenti,
membership scaduta, fonti duplicate, due account stessa persona
(limite non risolvibile con COUNT DISTINCT), revoca/moderazione/delete fonte,
withdraw/correction concorrenti, periodi sovrapposti, zone confinanti/overlap,
  query nei quattro raggi senza differencing, fonte EXPIRED senza archivio,
  account eliminato, privilegi anon/authenticated completi, reader
concorrente con revoca, performance con 150 tester. Non dichiarati PASS qui.

Indici nuovi limitati alle nuove tabelle: lookup delle FK inverse, fonti per
territorio/policy, pubblicazioni approvate per zona, storico approvato ordinato
per territorio/zona/mese/UUID. Il filtro raggio usa un GiST sull'espressione
geometry::geography, distinto dal GiST geometrico dei controlli ST_Covers.
Utilizzo effettivo, costo delle funzioni per riga ed eventuali lock di cascade
richiedono EXPLAIN/ANALYZE in PostgreSQL con soli dati sintetici autorizzati.

## Attivazione e rollback NON distruttivo

1. Approvare contratti e decisioni bloccanti; verificare confine/licenza e zone.
2. Autorizzare separatamente applicazione Development, controllando dipendenze
   PostGIS/schema NETWORK/ruoli/ACL; migration unica transazione con COMMIT finale
   intenzionale. Non è il pacchetto test ROLLBACK. Non applicarla ora.
3. Eseguire test transazionali e ulteriori test concorrenti isolati autorizzati.
4. Implementare/revisionare servizio di moderazione, governance e controlli
   gateway; nessuna auto-pubblicazione o scheduler.
5. Solo con nuova autorizzazione configurare territorio/policy/membership e
   release revisionate, poi collegare client/mappa. Nessun SDK/provider aggiunto.
6. Rollback operativo: enabled=false, revoca membership e ritiro pubblicazioni
   in transazione amministrativa autorizzata; lasciare dati e tabelle private.
   Feed e RPC legacy continuano immutati. Non DROP, non ripubblicare vecchie
   schede, non riattivare consensi. Eventuali dati già scaricati restano un limite.

GO soltanto per revisione locale. NO-GO per rilascio/attivazione; nessuna build,
query remota, installazione, commit, push o modifica di altri worktree prevista.
