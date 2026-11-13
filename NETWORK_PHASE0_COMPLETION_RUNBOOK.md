# NETWORK 2.0 — chiusura tecnica locale / Fase 0

Aggiornamento 10/11/2026: repository operativo recuperato in `D:\SAFEMELINK\RECOVERY_NETWORK_2026-11-10\project`. Per la procedura corrente unificata usare `NETWORK_BLOCK0_FINALIZATION.md`; il resto di questo documento conserva anche il rapporto storico del 09/11.

Data: 09/11/2026. Branch `codex/network-pilot-cavriago-2026-11-03`, HEAD invariato `e8a6abb3964ae7c3ae3a634c179bb2ece9b78c35`.

## Stato e perimetro

NON PRONTO PER BUILD come candidato NETWORK 2.0 funzionante. Integrazione locale predisposta, non certificata su PostgreSQL o dispositivi. Nessuna build, SQL remoto, installazione, commit, push o deploy eseguito. Nessuna modifica in questa fase alle tre migrazioni, ai pacchetti DDL, alle configurazioni remote o alle funzioni di emergenza.

Le assenze di territori/eventi/social/funzione dopo il primo test fallito sono evidenze fornite da Tiziano, non interrogazioni ripetute da Codex. Non equivalgono al secondo test PostgreSQL PASS. Nessun psql/Docker disponibile nei comandi locali controllati e nessun database usa-e-getta esplicitamente identificato: SQL non eseguito neppure localmente.

## Lavoro completato

1. Route `/network` collegata a un ingresso per piattaforma. Android/iOS usano la composizione V2 solo quando `EXPO_PUBLIC_NETWORK_V2_ENABLED` vale esattamente `true`; default OFF. Web conserva il NETWORK legacy. Il prototipo rimane separato e limitato allo sviluppo.
2. La composizione nativa riutilizza il client Supabase dell'app, Auth, repository, controller, mappa e social esistenti. Nessun servizio parallelo o fixture demo. Il runtime è posseduto dall'app e conservato durante la navigazione, non ricreato a ogni apertura. Logout/cambio account cancellano lo stato attraverso le subscription esistenti.
3. Mappa Android con configurazione esplicita esistente; iOS usa il provider di piattaforma. Stato cartografia mancante separato dagli errori dati. Vista iniziale mondiale, nessun Comune/account fisso e nessuna acquisizione GPS automatica. L'utente naviga la mappa e cerca i territori nell'area scelta; per pubblicare sceglie e conferma esplicitamente il luogo evento.
4. Lettura dello storico dalle RPC territoriali già previste, con whitelist dei payload, paginazione e scadenza. Le schede restano separate dagli eventi operativi: niente nickname, coordinate inventate o conversione arbitraria di categorie. Non vengono archiviati automaticamente gli eventi V2, né importate segnalazioni legacy.
5. Conclusione e ritiro collegati a `finish_my_network_event_v2`: conferma esplicita, controllo autore lato server, single-flight, nessun successo ottimistico. Una risposta persa resta UNKNOWN e consente soltanto la stessa chiusura idempotente. Nessuna proprietà dedotta dal nickname.
6. Token rinnovato o sessione riconfermata per lo stesso account non azzerano più i tentativi incerti. Logout, altro account e callback di lifecycle obsolete continuano a invalidare lo stato. Ogni RPC verifica comunque l'autorizzazione server; il client non considera un token una prova di pubblicabilità.
7. La categoria blu si presenta come **Servizi pubblici**. L'identificatore stabile resta `COMMUNITY_INFORMATION`: nessuna riclassificazione o modifica al dominio SQL.

## File interessati da questo intervento

Nuovi:

- `services/NetworkV2AppGate.ts`
- `screens/NetworkAppScreen.tsx`
- `screens/NetworkAppScreen.native.tsx`
- `scripts/test-network-app-integration.cjs`
- `NETWORK_PHASE0_COMPLETION_RUNBOOK.md`

Aggiornati, preservando il lavoro preesistente:

- `app/network.tsx`
- `backend/repositories/NetworkV2Repository.ts`
- `components/network/NetworkV2ScreenController.ts`
- `screens/NetworkV2Screen.native.tsx`
- `services/NetworkV2Composition.ts`
- `services/NetworkCategoryRegistryV2.ts`
- `scripts/test-network-v2-screen.cjs`
- `scripts/test-network-social-v2.cjs`
- `scripts/test-network-map-contract-v2.cjs`
- `scripts/test-network-phase2.cjs`

I file locali delle fasi precedenti restano presenti e non committati. I due cambiamenti ACL della Fase 17E alla sorgente 03/11 rimangono intatti; le sorgenti SQL non sono ulteriormente cambiate qui. Nessun altro worktree modificato.

## Verifiche locali

Suite applicative: contratto marker/categorie; mappa nativa simulata; controller; adattatore; schermata; social; prototipo; nuovo collegamento route/gate.

Suite backend/legacy: modello esatti default ACL; pacchetto 17D/17E e digest; territoriale; eventi; NETWORK backend Phase1; Phase2; Phase2B; pilot; account race; indipendenza SMS/NETWORK.

Esito finale: **18 suite locali PASS**, TypeScript completo `--noEmit` PASS, lint mirato sui file cambiati PASS, `git diff --check` PASS. Il vecchio test Phase2 della route richiedeva ancora l'export diretto di NetworkScreen: aggiornato al gateway per piattaforma, aggiungendo controlli sul fallback legacy Web e sul gate nativo OFF. Il nuovo test verifica il comportamento a gate OFF anche con esecuzione controllata della route. Non sono state eliminate assertions per aggirare regressioni.

Nessun test simulato dimostra la consegna cartografica, l'autorizzazione JWT reale o la concorrenza PostgreSQL. I test della route verificano che a gate OFF non venga costruita la composizione V2 e non partano richieste V2; il legacy mantiene il proprio comportamento precedente.

Le regressioni delle emergenze sono limitate al controllo dei percorsi non modificati e al test locale di indipendenza SMS. Non sono prove fisiche di SOS, Checkpoint, Torno a casa o voce.

## Passaggio PostgreSQL successivo — richiede autorizzazione separata

File invariato da revisionare: `scripts/phase17e-network-v2-ddl-rollback.sql`.

SHA-256: `8479088f0a8469051aa15b4cb9a21c0fb911b9bea2bd9b3a2411b72406d82c07`.

1. Tiziano conferma Dashboard del solo progetto `lwkxufnbjrpsehdkfmgy`, stato operativo Supabase senza blocchi e finestra senza deploy concorrenti. Nessun controllo generico già superato va ripetuto inutilmente.
2. Ottenere autorizzazione esplicita al SOLO test DDL/ROLLBACK. Il file resta con tutte e tre le autorizzazioni UNCONFIRMED. Non cambiare i digest né togliere assertions per superare un errore.
3. Dopo tale autorizzazione, nella sola copia manuale destinata al SQL Editor, i tre acknowledgement previsti dal pacchetto sono: `AUTHORIZED_DEVELOPMENT_lwkxufnbjrpsehdkfmgy`, `SERVICE_HEALTH_REVIEWED_NO_ACTIVE_BLOCKER`, `AUTHORIZED_DDL_ONLY_QUIET_WINDOW`. Queste stringhe non provano l'identità del progetto e non costituiscono da sole un permesso.
4. Eseguire l'intero pacchetto in una connessione e transazione, senza frammenti aggiunti, fino al ROLLBACK. Non introdurre fixture o eseguire RPC applicative: questo pacchetto valida solo il DDL e i cataloghi.
5. Al primo errore fermarsi e annullare la transazione nella stessa sessione. Riportare fase, SQLSTATE e messaggio tecnico senza dati personali. Non riprovare automaticamente, non disabilitare trigger, non applicare migrazioni.
6. Dopo successo, raccogliere le assertions e il completamento del ROLLBACK; verificare assenza degli oggetti temporanei e invarianti legacy attraverso il controllo mirato già predisposto. Non considerare il ROLLBACK una cancellazione di log o di eventuali effetti esterni.

Il superamento DDL NON verifica pubblicazione, JWT/RLS effettiva, letture, moderazione o concorrenza. Per questi usare i test sintetici già predisposti (`test-network-territorial-development.sql`, `test-network-event-development.sql`, `test-network-social-development.sql`) e relativi generatori/runbook, soltanto dopo revisione del pacchetto preciso e nuova autorizzazione. Le fixture toccano tabelle preesistenti: prima verificare i consumer/worker/webhook realmente distribuiti. Non disattivarli o assumere che ROLLBACK annulli HTTP, SMS, email o altri effetti esterni. Non usare utenti reali.

La concorrenza multi-sessione non si dimostra con fixture non committate invisibili tra sessioni: resta necessario l'ambiente isolato/protocollo già descritto nel runbook Phase14. Un eventuale setup sintetico committato richiede autorizzazione distinta.

## Blocchi ancora aperti, senza decisioni autonome

- Secondo test DDL 17E e test funzionali PostgreSQL non eseguiti. Le migrazioni V2 non risultano applicate secondo le evidenze fornite. Applicazione e attivazione sono due passaggi ulteriori, non impliciti nel test.
- Politiche e dati territoriali reali: confini/licenze, precisione, termini, moderazione, retention/purge e riferimenti di approvazione devono essere decisi e configurati dal titolare. I gate SQL restano OFF e non vengono creati territori/policy di produzione dalle fixture.
- PENDING di eventi e commenti richiede il percorso di revisione server già previsto. Non esiste un'approvazione automatica autorizzata né un operatore/moderatore sempre disponibile implicitamente garantito.
- RISOLTO LOCALMENTE nel Blocco0: journal persistente account-scoped di soli identificativi, barriera prima dell'invio, lookup ricevute e annullamento esplicito con fence server-side. Nessuna deduzione di fallimento da una lettura vuota. Sono ancora necessari applicazione autorizzata della migrazione additiva 10/11, test PostgreSQL e prove fisiche del riavvio.
- RISOLTO LOCALMENTE nel Blocco0: aggiornamenti dell'autore tramite RPC dedicata, stessa moderazione/quote/ricevute dei commenti e lettura dei soli aggiornamenti approvati. Predisposta anche lettura privata/paginata degli invii propri per gestire i PENDING. Nessuna RPC è ancora dichiarata operativa su Development.
- Lo storico territoriale revisionato usa categorie originarie e autorizzazione territoriale distinta. Non è un archivio automatico degli eventi V2. Unificazione futura richiede contratto e decisione privacy espliciti.
- Google Maps Android deve essere configurato manualmente nel canale di build autorizzato, con restrizioni package/firma adeguate. Non sono state lette/creare chiavi o attivati billing/provider. Il bool di configurazione non prova tile realmente disponibili. Entropia sicura UUID e cartografia nativa vanno provate sui runtime fisici.

## Collaudo Android/iOS futuro (non avviato)

Solo dopo backend verificato/applicato, policy approvate e autorizzazione alla build di collaudo: impostare esplicitamente `EXPO_PUBLIC_NETWORK_V2_ENABLED=true` nell'ambiente che esegue davvero il bundling JavaScript, non soltanto nella shell di lancio di un workflow. Non modificare main o attivare questo gate nelle build ordinarie prima della validazione. Nessun workflow è stato modificato o avviato qui.

1. Due account autorizzati distinti e due dispositivi; aggiungere poi iOS e modelli Android differenti. Annotare commit, build e versione sistema senza credenziali.
2. Da NETWORK aprire mappa reale, spostare/zoomare e ricentrare. Cercare territorio dinamico e provare 1/2,5/5/10 km e cinque categorie. Verificare tile reali, non soltanto marker su sfondo vuoto. A gate OFF e su Web verificare il legacy.
3. Scegliere manualmente un luogo evento distante dal telefono, confermarlo e inviare un testo sintetico. PENDING non deve essere pubblico sull'altro account. Il moderatore autorizzato verifica il contenuto usando la procedura già prevista, non una chiave service_role nell'app.
4. Dopo approvazione, aggiornare sul secondo telefono: marker generalizzato dell'evento, nickname pubblico e dettaglio autorizzato. Nessun marker della posizione autore, coordinate private o dati SOS. Utente non eleggibile/revocato non deve ricevere contenuti.
5. Provare conferma/non più presente, follow e commento sintetico. Commento PENDING non pubblico prima della revisione. Verificare doppio tap, stesso operation ID e nessuna falsa conferma di successo. Il follow non promette notifiche push.
6. L'autore conclude/ritira; l'altro account aggiorna e vede lo stato corretto. Il non autore deve ricevere rifiuto alla stessa operazione. Testare scadenza/revoca e ritorno dal background. Non usare SOS per questo collaudo.
7. Storico: soltanto schede sintetiche esplicitamente revisionate e autorizzate; testare dati insufficienti, pagine, scadenza e ritiro. Nessuna promozione automatica dal feed concluso. L'assenza di schede non equivale ad assenza di problemi territoriali.
8. Rete assente/debole e risposta persa: errore chiaro, niente vecchi dati dichiarati validi, retry esplicito dello stesso invio. Cambio account durante risposta tardiva: nessun contenuto dell'account precedente. Terminazione forzata con invio incerto resta BLOCCANTE fino alla soluzione durevole descritta sopra.
9. Navigazione verso le altre funzioni e verifica non invasiva dei loro prerequisiti, senza attivare SOS/SMS o timer di escalation reali. Gli eventuali collaudi di emergenza richiedono un protocollo separato e destinatari controllati.

## Prossimo blocco

Seguire `NETWORK_BLOCK0_FINALIZATION.md`: pacchetto DDL unico aggiornato che include il contenuto 17E e la migrazione additiva 10/11, poi verifica READ ONLY dell'annullamento. Esecuzione, installazione, fixture e attivazione richiedono autorizzazioni separate. Nessuna dichiarazione di NETWORK definitivamente chiuso prima delle prove PostgreSQL, multiutente e fisiche.
