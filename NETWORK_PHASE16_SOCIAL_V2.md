# NETWORK 2.0 — Fase 16: social reale, predisposizione locale

Nessun backend applicato, richiesta remota, installazione, build o commit.
Nessun contratto/RPC legacy, SOS, Voice, Checkpoint o Torno a casa modificato.
Backup Fase 14B preservato: NON contiene le nuove modifiche della Fase 16.

## Migrazione additiva 08/11

Dipende dalla territorialità 03/11 e dagli eventi 07/11. Cinque tabelle private:
network_social_policies_v2, votes, follows, comments, operations (prefisso network_social_, suffisso _v2).
RLS su tutte senza policy client; nessun accesso diretto client/service agli eventi social.
Solo il servizio fidato può amministrare le policy e usare le RPC di moderazione.
Owner applicazione richiesto postgres; search_path pg_catalog,pg_temp e riferimenti qualificati.
CREATE non fidato negli schemi deve essere assente. Nessun trigger aggiunto alle tabelle preesistenti.

Gate OFF per default, nessuna policy/territorio/account inserito. Per abilitare servono
versione, riferimenti di approvazione/moderazione/retention, durata e quote esplicite.
I riferimenti sono vincoli tecnici, non sostituiscono una decisione approvata reale.
Commenti PENDING sempre privati finché revisionati. Nessuna autopubblicazione,
notifica SMS/push/email/HTTP, worker o cron predisposto o dichiarato operativo.

### Contratti RPC

- get_network_social_v2(event UUID, before_created timestamptz?, before_id UUID?):
  conteggi reali, propria conferma, proprio follow e fino a 50 commenti APPROVED.
  Nessuna lista di votanti/follower. Cursor completo timestamp microsecondi+publicId.
  Ogni pagina sostituisce la precedente, non accumula contenuti revocati.
- mutate_network_social_v2(event UUID, operation UUID, action text, value text):
  VOTE CONFIRMED/NO_LONGER_PRESENT/NONE; FOLLOW ON/OFF; COMMENT testo 2–1000.
  Ricevuta distinta dalla visibilità. Un commento ricevuto richiede moderazione.
- get_my_network_social_operation_v2(operation UUID): solo ricevuta dell'account
  autenticato, anche dopo perdita accesso al genitore. NULL NON prova un fallimento.
- remove_my_network_social_v2(event UUID, comment UUID?): ritiro del solo commento
  proprio oppure rimozione del proprio follow/voto; consentito anche gate OFF.
  Non restituisce contenuto di eventi nascosti. Non cancella il testo dei commenti.
- list_network_social_activity_v2(territory UUID, followed_only boolean): ultime
  50 attività COMMENT_APPROVED attualmente autorizzate. Nessun archivio duplicato
  di testo ritirato. Il timestamp è quello di creazione del commento, non della review;
  non è un contatore di notifiche non lette. La UI lo indica come commento pubblicato.
- list_network_comment_review_v2(cursor?): coda privata PENDING fino a 50, solo servizio.
- review_network_comment_v2(comment UUID, expected_revision integer, decision text,
  review_reference text): solo servizio, APPROVED/REJECTED/WITHDRAWN. Ritiro terminale,
  revisione concorrente obsoleta rifiutata. Nessuna service key nell'app.

Le vecchie RPC dettaglio continuano a restituire il loro DTO originale: nessuna
CREATE OR REPLACE. Il social slot collegato mostra il nuovo snapshot reale al posto
dei conteggi placeholder del dettaglio 07/11. Quando il social non è disponibile
non visualizza conteggi ottimistici. Le ricevute non diventano marker mappa.

## Autorizzazioni, idempotenza e concorrenza progettate

Ogni lettura verifica genitore APPROVED/non scaduto, policy eventi e social attuali,
termini, restrizioni e membership se PILOT. Commenti e conteggi escludono contributori
senza accesso corrente. Gli UUID dell'account, il punto originale e i follower non
sono presenti nei DTO. I nickname/testi pubblici passano da moderazione, non da
una presunta anonimizzazione automatica. Testo libero può contenere PII: validare
la policy e la formazione del moderatore prima di un rilascio.

Le scritture usano lo stesso advisory lock per autore degli eventi, poi policy
social, policy eventi, riga evento. Ricontrollano autorizzazioni dopo le attese.
I lock e timeout non dimostrano assenza di deadlock: test PostgreSQL concorrenti mancanti.
Un voto/follow per account/evento, contatori ricavati dalle righe attualmente valide.
Una ricevuta per account/operation: replay non riesegue una vecchia scelta dopo una
successiva. Conflitto payload rifiutato; commento correlato senza duplicare il body
nella tabella ricevute. Stesso testo/evento/autore entro 10 minuti è respinto.
Quote scritture ora/giorno configurate e serializzate; letture usano i bucket esistenti.
Queste sono protezioni tecniche, non una politica antiabuso completa o un test di carico.

Le nuove scritture richiedono ACTIVE; rimozione voto/follow resta possibile su RESOLVED.
Le cleanup proprietario funzionano anche dopo ritiro/scadenza o perdita di accesso.
Il ritiro non annulla dati già letti/coperti da uno snapshot MVCC o copiati da altri.

## Client, schermata e composizione

NetworkSocialV2Repository estende l'adattatore esistente e riusa esattamente il motore
timeout/abort/generazioni/errori/UNKNOWN. La modifica al repository eventi è solo
il tipo delle RPC social e la visibilità protected del metodo request.
I nuovi decoder validano unknown con allowlist esplicite, limiti e copie immutabili.

NetworkSocialController serializza le scritture, non applica successi ottimistici,
scarta risposte vecchie, azzera contenuti al cambio account, in background e alla
scadenza. Il ritorno foreground richiede una nuova lettura, senza polling automatico.
UNKNOWN resta tale dopo una lettura ricevuta vuota o dopo un successivo diniego;
retry usa lo stesso operationId e payload. Una ricevuta trovata prova ricezione,
non pubblicazione. Il ritiro con esito incerto non viene dichiarato completato.

NetworkSocialPanel.native si inserisce negli slot della schermata già esistente:
voti, follow, conversazione moderata/paginata, ritiro dei propri commenti visibili,
attività delle segnalazioni seguite. Aggiornamento manuale e messaggi espliciti
per assenza RPC, gate OFF, rete, errore o permesso mancante. Nessuna fixture reale/demo.

NetworkV2Entry.native è un ingresso isolato, non una route di produzione.
createNetworkV2AppComposition accetta:

- feature gate enabled, default false;
- client Supabase reale con Auth/rpc, senza credenziali nel codice;
- generatore UUID affidabile fornito dall'app (es. API già supportata, non Math.random);
- regione iniziale dinamica, non posizione autore per creare eventi;
- la vista riceve configurazione cartografica READY/MISSING e provider
  PLATFORM_DEFAULT o GOOGLE_ANDROID. iOS resta sul provider piattaforma esistente.

Auth locale determina un epoch opaco e non costituisce autorizzazione server.
getSession tardivo non sovrascrive eventi Auth più recenti. Logout/cambio account
invalidano sincronicamente contenuto e richieste; nessun token nello scope key.
Il proprietario dell'app deve mantenere stabile la composizione fra montaggi della
vista e chiamare dispose al teardown finale. Smontare la vista NON arresta il runtime
di pubblicazione né cancella un tentativo social UNKNOWN. L'accesso Auth rimane
sottoscritto anche mentre la vista non è visibile, per pulire un account terminato.
Nessuna navigazione principale, client globale o configurazione API key modificati.

## Test locali e pacchetto SQL futuro

test-network-social-v2.cjs verifica runtime reali con trasporti simulati:
decoder/PII-field rejection, gate OFF, race Auth, doppio tap, nessun esito ottimistico,
UNKNOWN/replay/ricevuta assente, cambio account, callback tardive, expiry, timeout,
RPC assenti, background e controllo TypeScript dell'integrazione nativa.
I controlli SQL sono strutturali, NON un parser PostgreSQL.

test-network-social-development.sql è una prova sintetica sequenziale BEGIN/ROLLBACK,
bloccata per default. Inserisce nuovi utenti Auth: può attivare trigger distribuiti.
Stessi prerequisiti esterni della Fase 15C, incluso radar_preferences creato dal bootstrap.
Nessun account/SOS reale. Non disabilita trigger, cron o worker.
Assertions: default OFF, policy incompleta, pending, replay/conflitto, review e revisione
obsoleta, account B/own receipt, ritiro proprietario, genitore concluso/nascosto,
cleanup gate OFF, ACL effettive authenticated/anon. Non dimostra JWT reali.

prepare-network-social-validation.cjs prepara, senza eseguire, un solo pacchetto:
03/11 se assente, 07/11 e test esistenti, 08/11 e test social. Rimuove gli involucri
originali con il lexer e verifica un solo BEGIN/ROLLBACK, nessun COMMIT intermedio.
Tutti gli oggetti social devono essere assenti. Mantiene i guard Fase 14 e richiede
in aggiunta safemelink.social_test_review='approved-synthetic-only'. Non li imposta.
L'opzione --emit-sql --territorial=absent stampa soltanto SQL da revisionare;
non usare pipe verso client DB. Il pacchetto non è un file migration applicabile.

Test concorrenza da eseguire successivamente in ambiente isolato con fixture visibili
a due sessioni: stesso autore/operation, operazioni distinte al limite quota, review
contro ritiro, parent withdraw contro comment, revoca gate/membership durante lock.
Controllare lock order, timeout 55P03/40001, conteggi e unicità. Due sessioni non
condividono fixture non committate: non fingere copertura concorrente con un solo DO.
Rollback non annulla HTTP/email esterni o log/avanzamenti sequenze dei trigger.

## Decisioni e limiti bloccanti per il rilascio

- Approvare moderazione PENDING, tempi di revisione, termini/consensi social,
  trattamento nickname/testo e gestione abusi/ricorsi. Nessuna decisione definitiva scelta.
- Approvare durate e implementare cleanup fisico coordinato commenti/ricevute/voti/
  follow, con una finestra di idempotenza dichiarata. valid_until nasconde, NON cancella
  dati. operations conserva ricevute: nessun purge/scheduler viene attivato qui.
- UNKNOWN resta recuperabile durante la vita dell'istanza app-owned. Persistenza
  dopo crash/process death, logout e restart NON implementata: richiede un journal
  minimale e una policy approvata prima di un rollout pubblico. Non affidarsi al
  solo filtro duplicati di 10 minuti per un'esatta idempotenza dopo perdita storage.
- Cleanup backend è disponibile anche per commenti pendenti/nascosti noti al proprietario;
  una gestione completa dei propri commenti non pubblicati non è ancora una schermata
  account integrata. Nessuna operazione viene inventata nel client.
- Attività include per ora soltanto commenti APPROVED; notifiche push, indicatori
  unread, aggiornamenti dell'autore e storico revisionato social NON implementati.
- Servizio moderazione deve autorizzare gli operatori/audit: mai dare service key
  ai telefoni o ai moderatori direttamente. Nessun host di moderazione distribuito.
- Migrazioni non eseguite: parsing, RLS reale, PostgREST/JWT, concorrenza, performance
  e rendering/dispositivi Android/iOS rimangono NON verificati.

Prossimo blocco: chiudere i controlli Fase 15C sui trasporti effettivi, poi autorizzare
la prova PostgreSQL isolata/transazionale revisionata, non una build o un rollout.

## Esiti locali

83 gruppi di test PASS: social 13, adattatore 9, schermata 7, contratti 7,
controller mappa 7, mappa nativa 8, prototipo 11, backend eventi strutturale 7,
backend territoriale strutturale 10, legacy pilot 4. Inoltre pacchetto social nelle
due varianti, TypeScript globale --noEmit --incremental false ed ESLint mirato.
Non sono 83 prove PostgreSQL o multiutente reali: restano mock, controlli runtime
client e strutturali. Nessun test SQL, rendering Android/iOS o carico eseguito.
Il backup precedente è stato ricontrollato: 57/57 copie ancora identiche al manifesto.
