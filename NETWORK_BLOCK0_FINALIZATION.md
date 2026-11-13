# NETWORK 2.0 — Blocco 0, finalizzazione locale

Data: 10/11/2026. Unico repository operativo: `D:\SAFEMELINK\RECOVERY_NETWORK_2026-11-10\project`.
Branch `codex/network-pilot-cavriago-2026-11-03`; HEAD invariato `e8a6abb3964ae7c3ae3a634c179bb2ece9b78c35`.

**NON PRONTO PER BUILD come candidato NETWORK funzionante.** Lavoro locale completato nei limiti verificabili; backend Development non validato/installato, decisioni di attivazione e prove fisiche ancora necessarie. Non è una nuova demo e non è una dichiarazione di rilascio pubblico.

## Cause radice e correzioni

1. Gli esiti incerti vivevano soltanto in memoria. Ora il client reale inserisce una barriera AsyncStorage PRIMA della richiesta e ne rilegge il valore; senza verifica storage l'invio non parte. Un solo tentativo per account, scritture single-flight, timeout limitati, nessuna coda crescente o reinvio automatico.
2. Dopo un riavvio non bastava sapere l'operation ID: una SELECT vuota non prova che una vecchia richiesta non arriverà dopo. La nuova RPC cerca una ricevuta di proprietà dell'account. FOUND recupera l'esito; UNKNOWN mantiene il blocco. Solo l'utente può richiedere una fence: sotto lo stesso advisory lock dei writer, se non esiste la ricevuta, impedisce ogni successivo INSERT di quel vecchio tentativo. Se l'INSERT aveva già vinto viene restituita la ricevuta, senza chiusure/cancellazioni automatiche. Per le azioni social il trigger sulla ricevuta annulla nella stessa transazione eventuali effetti precedenti se la fence ha vinto.
3. La finestra asincrona dell'SDK poteva cambiare identità fra controllo client e richiesta. La composizione nativa ricontrolla account/epoch dopo getSession e passa un Authorization header esplicito per il JWT che ha iniziato la richiesta. Verificato nel codice dell'SDK installato che fetchWithAuth non sovrascrive un header Authorization già impostato. Token mai registrati o persistiti dal journal.
4. Gli aggiornamenti autore erano un array vuoto senza writer. Ora RPC dedicata verifica l'autore e riutilizza commenti, quote, PENDING, ricevute e coda di moderazione esistenti; una tabella privata classifica i commenti come aggiornamenti. Il dettaglio carica soltanto aggiornamenti APPROVED, policy corrente, autore ancora ammesso, parent visibile e dati non scaduti. Revisione parent diversa o payload extra scartano il dettaglio. La UI non duplica nella conversazione gli aggiornamenti già mostrati nel dettaglio.
5. Un invio PENDING confermato poteva non essere gestibile dopo la riapertura, perché non è un marker pubblico. L'elenco privato “I miei invii” riceve soltanto metadati dell'account autenticato, paginati, senza corpo o coordinate. Permette conclusione/ritiro tramite il writer già esistente e ricontrollo autore server-side. Dati locali scadono e vengono cancellati al cambio account.

Nessuna modifica ai tre sorgenti SQL precedenti o alla loro correzione ACL. Nessun writer SOS/voce/Checkpoint/Torno a casa modificato. Nessun account, Comune o dato demo nel percorso reale. Route e legacy restano separati per piattaforma; gate `EXPO_PUBLIC_NETWORK_V2_ENABLED` OFF per default.

## Persistenza e privacy

- AsyncStorage conserva solo versione, tipo RPC, operation ID, eventuale ID evento e azione tecnica. Non conserva testo, nickname, GPS, punto scelto, token o audio.
- Chiavi separate per account; lo stato visualizzato non contiene account ID. Cambio account/logout cancellano la vista; i metadati di un tentativo irrisolto restano riservati al suo account, per non perdere l'anti-duplicazione.
- Il marker locale viene rimosso dopo conferma verificata o fence confermata, con rilettura storage. Timeout o corruzione bloccano nuove scritture; una scrittura storage tardiva deve finire prima di rileggerne lo stato. Nessuna pulizia che certifichi falsamente un fallimento.
- Fence server: massimo tecnico 256 per account, nessun accesso tabellare client/service_role, nessuna scadenza automatica che riabiliti richieste tardive. Conservazione/manutenzione di questo ledger tecnico resta da approvare prima dell'attivazione pubblica; nessuna retention finale inventata. Il superamento del limite blocca in sicurezza, non elimina fence.
- Cancellazione dei dati app, reinstallazione, corruzione irreversibile dello storage o più runtime indipendenti che scrivano lo stesso storage non sono equivalenti a normale terminazione/riapertura. Non si promette recupero degli identificativi perduti. Il backend mantiene comunque idempotenza per operation ID e controlli duplicati già previsti. Questi casi richiedono collaudo e un piano operativo, non la deduzione “nessun invio”.
- Una richiesta già arrivata può completarsi dopo il logout per l'account che l'ha iniziata: non è annullabile retroattivamente. Il JWT vincolato impedisce di attribuirla al nuovo account; callback obsolete non ripristinano la vecchia vista.
- Testi già letti/copiati non sono revocabili retroattivamente. La UI rilegge su richiesta/foreground e invalida su scadenza/account; non promette sincronizzazione push istantanea o consegna di notifiche follow.

## Backend locale preparato

Nuova migrazione additiva: `supabase/migrations/20261110120000_network_recovery_author_updates_v2.sql`.

- Tabelle private RLS: `network_operation_fences_v2`, `network_author_update_links_v2`.
- Trigger anti-arrivo tardivo solo su INSERT di `network_events_v2` e `network_social_operations_v2`.
- RPC authenticated: `resolve_my_network_operation_v2(text,uuid,boolean)`, `publish_network_author_update_v2(uuid,uuid,text)`, `get_network_author_updates_v2(uuid)`, `list_my_network_events_v2(integer,timestamptz,uuid)`.
- Helper trigger senza EXECUTE a PUBLIC/anon/authenticated/service_role. Nessun grant diretto sulle due tabelle, inclusi TRUNCATE/REFERENCES/TRIGGER/MAINTAIN. Nessuna modifica a default ACL globali o oggetti legacy.
- Le nuove funzioni non attivano territori, social o moderazione automatica. Il percorso autore usa le stesse policy e revisioni già predisposte, non un secondo social.
- L'indice degli invii propri può richiedere lock durante l'installazione: finestra controllata, gate OFF e timeout prudenti. Non utilizzare una finestra di scrittura attiva senza un piano specifico.

## Artefatti SQL unici per revisione (NON eseguiti)

1. `scripts/block0-network-v2-ddl-rollback.sql` — base 17E identica più quarta migrazione, collision guard dei nuovi oggetti, assertions aggiuntive e ripetizione finale delle guardie event trigger. Un solo BEGIN/ROLLBACK, quattro acknowledgement UNCONFIRMED. SHA-256 `6e559f31eef8f44f40c604223e6be1d05b47f563dd9686ff9e38d2bedf0852f9`.
2. `scripts/block0-network-post-rollback-readonly.sql` — solo cataloghi, BEGIN READ ONLY/ROLLBACK; verifica assenza di tutte le 19 tabelle/35 funzioni V2 attese. SHA-256 `b726c6a5a8625d93097ebd0cb7d4c58c199b1399178385f3b3c421fa2f722169`.
3. `scripts/block0-network-functional-rollback.sql` — fixture sintetiche dopo installazione, guardie precedenti più nuova autorizzazione UNCONFIRMED. Copre social precedente, author update, moderazione, isolamento, recupero e fence. SHA-256 `9e6ca3493a16981b13ea6d5528d5b5327f2d19d724e918f8f833d678e399e509`.

Generatore: `scripts/prepare-network-completion-validation.cjs`; manifest: `scripts/block0-network-completion-manifest.json`. Il generatore rifiuta digest cambiati o comandi non ammessi. Sorgenti e corpi dollar-quoted sono mantenuti integri, senza sostituzioni testuali che ne alterino i delimitatori. Il vecchio `phase17e-network-v2-ddl-rollback.sql` resta invariato: SHA-256 `8479088f0a8469051aa15b4cb9a21c0fb911b9bea2bd9b3a2411b72406d82c07`.

## Procedura Development: solo passaggi esterni indispensabili

### A. Test DDL e annullamento — autorizzazione specifica

1. Tiziano verifica manualmente Dashboard del solo progetto `lwkxufnbjrpsehdkfmgy`, stato operativo Supabase e finestra senza deploy concorrenti. Hash, database postgres e query SQL NON provano l'identità del progetto.
2. Dopo revisione e autorizzazione al pacchetto aggiornato, utilizzare una copia manuale nel SQL Editor. Non applicare le migrazioni originali e non aggiungere comandi/RPC. I quattro valori inizialmente UNCONFIRMED possono essere confermati solo dopo le rispettive verifiche:
   - `safemelink.phase17_target_review`: `AUTHORIZED_DEVELOPMENT_lwkxufnbjrpsehdkfmgy`;
   - `safemelink.phase17d_health_review`: `SERVICE_HEALTH_REVIEWED_NO_ACTIVE_BLOCKER`;
   - `safemelink.phase17d_execution_review`: `AUTHORIZED_DDL_ONLY_QUIET_WINDOW`;
   - `safemelink.block0_review`: `AUTHORIZED_COMPLETE_DDL_ONLY_QUIET_WINDOW`.
3. Eseguire il file DDL unico intero in una sessione, una transazione, fino al ROLLBACK. Nessuna fixture, RPC applicativa, CREATE/DROP EXTENSION o disabilitazione trigger. Le tre definizioni extension-filtered differenti restano NON approvate e non applicabili a questo insieme di comandi; inventario/metadati e watcher approvati sono ricontrollati prima e dopo DDL.
4. Primo errore: STOP e ROLLBACK nella stessa sessione. Riportare SQLSTATE, messaggio e fase senza credenziali. Non togliere assertions, non cambiare digest per ottenere PASS e non ritentare automaticamente.
5. Dopo esito positivo e ROLLBACK, eseguire la query READ ONLY di annullamento, nell'ambito autorizzato: attesi `transactionReadOnly=on`, `allV2ObjectsAbsent=true`, liste residue vuote. Non fare DROP/DELETE se compaiono residui. Le assertions del pacchetto confrontano inoltre i fingerprint legacy/SOS all'inizio e alla fine della transazione.

### B. Installazione non distruttiva — nuova autorizzazione dopo A PASS

DDL con ROLLBACK NON installa il backend. Dopo esame dei risultati e nuova autorizzazione: applicare i sorgenti 03/11, 07/11, 08/11 e 10/11 nell'ordine, ciascuno con i propri confini transazionali, gate OFF, ruolo previsto e finestra lock concordata. Nessun reset/drop di dati. Verificare cataloghi/ACL/RLS dopo ogni passo. In caso di errore, annullare la transazione corrente e fermarsi. Migrazioni già committate non si annullano con un ROLLBACK successivo: lasciare gate OFF e preparare solo correzione additiva revisionata. Non usare lo script di test come migration.

### C. Test RPC/fixture — autorizzazione distinta

Lo script funzionale usa fixture `example.invalid` e ID sintetici ma tocca auth.users/profiles, quindi può attivare trigger/worker/webhook effettivamente distribuiti. Prima di eseguirlo serve verifica esterna di quei consumer e della sicurezza degli effetti esterni. ROLLBACK non annulla HTTP, SMS, email, log esterni o un'azione già ricevuta da un worker. Non disabilitare trigger/cron per aggirare il controllo.

Solo dopo tale revisione autorizzare lo script funzionale. Nella copia manuale, dentro BEGIN e prima del primo DO, impostare i tre guard preesistenti mediante SET LOCAL: `safemelink.event_test_target='lwkxufnbjrpsehdkfmgy'`, `safemelink.event_test_external_review='confirmed-no-side-effects'`, `safemelink.social_test_review='approved-synthetic-only'`. Sostituire inoltre l'UNCONFIRMED già presente di `safemelink.block0_functional_review` con `AUTHORIZED_SYNTHETIC_FUNCTIONAL_TEST`. Questi acknowledgement non sono verifiche automatiche e non vanno confermati senza autorizzazione e riscontri esterni.

Il test termina con ROLLBACK e non cancella dati reali. JWT simulati con set_config da postgres verificano la logica ma NON certificano autenticazione HTTP reale o RLS multiutente completa: servono prove tramite client autenticati.

### D. Concorrenza reale

Due sessioni non vedono le fixture non committate dell'altra. Usare un ambiente isolato o un setup sintetico condiviso/committato separatamente autorizzato, con cleanup mirato revisionato; non fingere che un singolo ROLLBACK provi la concorrenza.

- A tiene il lock dell'account su create; B prova lookup/fence dello stesso operation ID. Atteso lock timeout controllato oppure FOUND dopo commit, mai una seconda creazione.
- Se A annulla, B può creare la fence; una vecchia create successiva con lo stesso ID deve fallire senza riga evento.
- Se la fence precede una mutate social, nessun voto/commento deve restare dopo il fallimento della ricevuta: tutte le modifiche sono nella medesima transazione.
- Identico operation ID di account diversi resta isolato. Verificare revoca/moderazione/chiusura concorrenti, timeout e callback tardive; nessuna resurrezione o estensione TTL.

## Unico piano fisico: due Android, due account

Solo dopo A/B/C, decisioni di policy e autorizzazione alla build manuale. Mai build cloud o workflow avviati da Codex.

1. Identificare APK/commit e ambiente Development; flag V2 attivo solo nella build di collaudo, non nelle build ordinarie. Verificare cartografia/configurazione reale su entrambi i telefoni, senza creare/leggere chiavi nei log. iOS resta un collaudo successivo obbligatorio per la compatibilità dichiarata.
2. A/B accedono con account distinti autorizzati; territori dinamici, cinque categorie, raggi 1/2,5/5/10 km, pan/zoom/ricentra e ritorno dalla navigazione. Il Web e il gate OFF conservano legacy; nessun dato demo nel percorso reale.
3. A seleziona un evento distante dal telefono e pubblica testo sintetico. Il server generalizza il punto evento; non compare il GPS personale. PENDING è visibile soltanto nei metadati propri, non sulla mappa di B. La moderazione passa dalle RPC private esistenti, mai da un service key nell'app.
4. Dopo approvazione, B aggiorna: marker, nickname pubblico, dettaglio. Conferme/non più presente/follow/commento e aggiornamento autore devono usare RPC vere; autore B respinto sul contenuto di A. Anche l'aggiornamento resta PENDING fino a revisione. Follow non promette push.
5. Togliere rete e terminare/riaprire l'app durante l'invio sintetico. Verifica automatica del registro, nessun nuovo invio automatico; lookup FOUND ripristina esito, UNKNOWN resta bloccato. Solo conferma esplicita permette fence, che non cancella un evento già ricevuto. Provare anche chiusura idempotente con risposta persa e ritiro degli invii PENDING dopo riapertura.
6. Cambio account/logout mentre una richiesta attende: nessun testo/stato del precedente account; nessun payload del vecchio utente inviato con il JWT nuovo. Tornare al vecchio account e risolverne il tentativo dal suo registro. Nessuna parola d'ordine/SOS/SMS usata per questo test.
7. A conclude/ritira; B rilegge e vede il cambiamento o la perdita di visibilità. Storico solo esplicitamente revisionato, categorie originarie e regole proprie; nessuna archiviazione automatica dal feed. Provare scadenze e revoche, senza trattare dati insufficienti come assenza di problemi.
8. App in background, rete debole, riapertura, negazione permessi e mappe non configurate: errori chiari, nessun risultato vecchio indicato come fresco. Verificare navigazione verso le altre funzioni senza avviare emergenze/timer reali. Le prove di emergenza richiedono protocollo e destinatari controllati separati.

## Test locali e regressioni

Rieseguite le sei suite interessate: app integration (6), adapter (9), screen/controller (12), social (15), durable recovery (7), completion SQL/package (7): **56 controlli PASS**. Le suite non interessate conservano il precedente esito del recupero, senza ripetere audit generici. **TypeScript completo PASS, lint mirato PASS, git diff --check PASS**. Nessun test PostgreSQL, multiutente HTTP reale, provider nativo o telefono eseguito.

Regressioni coperte: legacy/gate OFF, prototipo separato, no demo nel reale, account change, callback obsolete, doppio tap, UNKNOWN persistente, payload privati/extra scartati, revisioni stale, parent/expiry, chiusure e ritiro, conservazione del contenuto 17E. Non modificati SOS, voce, Checkpoint, Torno a casa, GPS/SMS o altri worktree.

## File del blocco

Nuovi: migrazione 10/11; `services/NetworkWriteRecovery.ts`; `components/network/NetworkRecoveryPanel.native.tsx`; `scripts/prepare-network-completion-validation.cjs`; `scripts/block0-network-completion-manifest.json`; i tre SQL `block0-*`; `scripts/test-network-durable-recovery.cjs`; `scripts/test-network-completion-backend.cjs`; questo rapporto.

Aggiornati: `backend/repositories/NetworkV2Repository.ts`, `backend/repositories/NetworkSocialV2Repository.ts`, `services/NetworkV2Composition.ts`, `components/network/NetworkV2ScreenController.ts`, `components/network/NetworkSocialController.ts`, `components/network/NetworkSocialPanel.native.tsx`, `screens/NetworkAppScreen.native.tsx`, `screens/NetworkV2Entry.native.tsx`, `screens/NetworkV2Screen.native.tsx`, i test `test-network-app-integration.cjs`, `test-network-v2-adapter.cjs`, `test-network-v2-screen.cjs`, `test-network-social-v2.cjs`, `NETWORK_PHASE0_COMPLETION_RUNBOOK.md`.

## Blocchi esterni residui

Stato effettivo Development: secondo test DDL non eseguito; nessuna nuova query/installazione o attivazione fatta da Codex. Le precedenti evidenze di assenza oggetti restano informazioni fornite dall'utente, non un test nuovo. Non è stato modificato alcun default ACL globale.

Prima di build di collaudo: risultati A/B/C, policy approvate (moderazione, precisione, retention dei contenuti e ledger tecnico), configurazione cartografica e ambiente Development nel bundling. Prima del pubblico: test fisici Android/iOS, concorrenza/JWT reali e carico. Nessun account/territorio autorizzato o dato di produzione è stato inserito dalle fixture. Nessun commit/push, deploy, installazione di dipendenze o build eseguito.

L'implementazione locale non va dichiarata definitivamente chiusa prima di queste evidenze. Il prossimo intervento dell'utente è la revisione/autorizzazione al SOLO pacchetto DDL completo, non l'attivazione pubblica.
