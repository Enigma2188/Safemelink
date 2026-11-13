# NETWORK 2.0 — prototipo interno locale

## Aprire sul PC (preview Web isolata)

Da PowerShell:

```powershell
Set-Location 'C:\Users\FISA\Desktop\safemelink-network-pilot'
node scripts/start-network-prototype-web.cjs
```

Aprire http://localhost:8095/network-prototype e lasciare il terminale aperto.
Ctrl+C termina l'anteprima. La porta 8095 deve essere libera: il comando non
termina processi altrui e non seleziona silenziosamente un'altra porta.
CI mode disabilita il live reload: dopo modifiche al codice fermare e riavviare
il comando, poi ricaricare il browser.

La cartella `prototype-web` è un ingresso Expo di SOLO sviluppo, senza Router,
AuthProvider o servizi reali. Riutilizza le dipendenze bloccate del worktree
padre: non eseguire npm install nella sottocartella, non ha nuove dipendenze.
L'uscita chiude la sola demo e permette di riaprirla, senza aprire il NETWORK reale.
La route dell'app originale resta separata e non è stata modificata in fase 6.

Route separata `/network-prototype`, nessun cambiamento al NETWORK operativo o
alla navigazione esistente. Aprire `safemelink://network-prototype` in un runtime
già disponibile che supporti lo schema, oppure il percorso della route nel dev
client/ambiente Expo già predisposto. Onboarding e provider globali dell'app
rimangono invariati: il prototipo non li disattiva e non ne aggiunge altri.

Gate esclusivamente `__DEV__`: fuori sviluppo la route mostra soltanto
indisponibilità. Nessun flag può abilitare il prototipo in produzione.
Nessun link aggiunto alle schermate utenti. Nessun workflow/config EAS modificato.
Il gate di sviluppo non sostituisce autorizzazioni backend (qui non utilizzate).

## Demo, non segnalazioni reali

12 esempi fittizi: 8 attivi, 2 conclusi, 2 storici revisionati. Cinque categorie,
nickname Demo_*, conferme/aggiornamenti sintetici; lo storico non ha nickname.
Data di scenario fissa 4 novembre 2026, non un feed live o autorizzazione attuale.
I modelli rispettano i contratti V2 e la loro scadenza viene confrontata solo
con il tempo congelato della simulazione, mai usata per autorizzare dati reali.
I 250/1000 metri sono valori di fixture, non una policy privacy approvata.

Riferimento geografico pubblico per il centro di Cavriago:
https://www.geonames.org/3179254/cavriago.html
Nomi di vie/piazza confermati solo come toponimi dal Comune:
https://www.comune.cavriago.re.it/novita/comunicati/cavriago-si-fa-bella-presentato-ieri-sera-il-piano-di-riqualificazione-urbana-e-il-piano-asfalti-2025-2026
I marker sono spostamenti sintetici attorno al centro: NON localizzazioni
verificate delle vie citate, problemi reali o informazioni su abitanti.

## Mappa e controlli

Usa react-native-maps già dichiarato, caricandolo solo se il modulo nativo è
disponibile e su Android androidMapsConfigured è true. Non legge/stampa chiavi.
Se configurata, la cartografia SDK può contattare il provider esistente;
nessuna nuova integrazione/provider, chiave o fatturazione viene creata.
Non vengono chiesti GPS/permessi, mostrata la posizione utente o inviati eventi.
Provider/config mancanti, errore o timeout: schema vettoriale offline
chiaramente etichettato, NON cartografia di Cavriago. Niente tile remoti di ripiego.
Su Web Metro seleziona `NetworkPrototypeMap.web.tsx`, che NON importa il modulo
mappe nativo e NON usa tile/provider. Lo schema illustrativo offre trascinamento,
frecce da tastiera, zoom +/- e ricentratura; non è cartografia geografica reale.
Il percorso nativo Android/iOS preesistente è invariato.

Ricerca nei soli titoli/aree/categorie demo; non geocoding indirizzi. Raggi
1/2,5/5/10 km dal centro demo. Cluster neutri dei soli marker filtrati; sulla
mappa nativa la griglia visiva cambia con lo zoom, non è analisi del rischio.
Ricentra non acquisisce GPS. Stati Attive/Concluse/Storico e categoria resettano
la selezione precedente. Bottom sheet: anteprima, elenco, dettaglio; pulsanti
oltre al trascinamento della maniglia e liste scorrevoli.
Confermo è idempotente solo nella memoria di questa schermata. Segnala apre
una spiegazione della futura pubblicazione: non crea record né richiede GPS.
Uscire/rimontare elimina le interazioni locali. Nessun commento pubblico.

## Limiti e verifiche

Fase 8: Conversazione è disponibile solo nel dettaglio operativo (anche concluso),
mai nello storico revisionato. Due messaggi sintetici per evento sono separati
dai dodici record V2 originali. Avatar a iniziale, badge AUTORE, ordine cronologico,
conteggio e pubblicazione locale con feedback. I commenti rimangono in memoria
finché la schermata è montata; riapertura/rimontaggio ripristina i soli esempi.
Le segnalazioni di commenti sono interazioni demo: non avvisano moderatori e non
nascondono realmente contenuti. Nessun servizio antispam o blocco utenti attivo.
Il modello locale distingue VISIBLE/HIDDEN/DELETED; il corpo dei contenuti nascosti
o eliminati non viene mostrato. Limiti di UI demo: 500 caratteri e 30 commenti
locali per evento, non garanzie di sicurezza per un servizio pubblico.
Conversazione apribile/richiudibile nel pannello scorrevole, senza una chat
a schermo intero. Il compositore usa l'adattamento tastiera nativo e lo scroll;
il comportamento della tastiera reale Android/iOS e degli screen reader resta
da verificare su dispositivo. Browser verificato a 390x844 e 1280x900.
Non usare il campo per dati reali o personali: tutto il prototipo è dimostrativo.

## Proposta futura Comunità (nessuna implementazione backend)

Separare due ambiti: commenti con scope OPERATIONAL_EVENT e discussioni con
scope COMMUNITY_THREAD. Una comunità possiede un territorio stabile e
generalizzato, indipendente da Cavriago o da convenzioni con un Comune;
membership e ruoli non richiedono pubblicazione della posizione dei partecipanti.
Le discussioni generali esistono anche senza una segnalazione. Nessun messaggio
privato. Non trasferire commenti, nickname o profili nello storico revisionato.

Per una futura integrazione Supabase: repository dedicati e contratti paginati
per discussioni/messaggi, identità pubblica separata dagli account privati,
stati di moderazione e tombstone, revisioni, segnalazioni contenuti e blocchi.
Autorizzazione e isolamento territorio/partecipante vanno imposti dal server
(RLS/RPC controllate); non affidarsi a filtri UI o al solo nickname.
Limitazione invii, deduplicazione, prevenzione abusi e revoca accessi devono essere
server-side. Nessun testo dei messaggi in push/log; eventuali notifiche richiedono
consenso separato. Letture paginate e aggiornamenti successivi non devono
ripubblicare contenuti ritirati o bloccati.

Prima del rilascio pubblico occorrono decisioni approvate su regole di comunità,
responsabili e tempi di moderazione, conservazione/cancellazione, contestazioni,
rettifica, segnalazioni di molestie/minacce e gestione dati personali. I dati già
visualizzati o copiati non possono essere ritirati. Nessuna di queste garanzie
è implementata dalla demo locale; nessuna tabella, RPC o policy viene qui creata.

## Verifiche delle fasi grafiche

Fase 7: header e filtri compatti, pannello iniziale di 112 px e dettaglio
laterale su desktop; su smartphone il pannello rimane in basso e scorre.
Il dettaglio operativo include categoria, nickname demo, conferme, ultimo
aggiornamento e cronologia. Segui/non seguire e Confermo sono azioni soltanto
in memoria: non iscrivono a notifiche e non effettuano scritture remote.
Attività recente deriva dalle pubblicazioni, dai cinque aggiornamenti e dalle
due risoluzioni già presenti: 17 attività iniziali. I conteggi di conferma senza
timestamp non diventano attività inventate. Una conferma locale aggiunge la
propria data reale, esplicitamente etichettata come interazione locale.
Selezionare un'attività apre il dettaglio associato e ricentra lo schema Web.
Verificati nel browser layout 1280x900 e 390x844, apertura attività/dettaglio,
conferma, follow/unfollow e riduzione del pannello; nessun errore console rilevato.
La cartografia nativa e i dodici record demo non sono stati modificati.

Fase 6: dipendenze locali indipendenti installate con npm ci --ignore-scripts
--no-audit --no-fund, senza modifiche al manifest o lockfile. Un primo tentativo
ECONNRESET è fallito; il secondo è riuscito. Nessuno script postinstall eseguito,
nessuna nuova libreria o servizio installati. Cache npm locale ignorata da Git.
Avviato soltanto Metro Web di sviluppo; nessuna build/prebuild nativa o di produzione.
Test mocked/TypeScript non provano fluidità, font grandi/TalkBack o cartografia su telefono.
La mappa reale richiede modulo nativo/config provider presenti nel runtime;
senza questi l'UI rimane provabile nello schema offline, non in una mappa reale.

Controlli locali: `scripts/test-network-prototype.cjs` e test contratti V2.
Verifica browser effettivamente eseguita su /network-prototype: schema/icone/cluster,
trascinamento mouse e frecce, zoom, ricentratura, raggio, ricerca, categoria,
attive/concluse/storico, pannello elenco/dettaglio, conferma solo locale e storico
senza nickname. Segnala mostra soltanto l'avviso senza pubblicazione. Corretto
un warning React rimuovendo il prop nativo accessible dall'SVG Web; nessun nuovo
errore console rilevato dopo il reload finale. Gli asset icone sono serviti
localmente e possono apparire dopo il primo caricamento del font.
Bundling Metro Web di sviluppo verificato (nessuna build di produzione).
Nessun file SQL, servizio applicativo, RPC, Home, SOS o funzione di sicurezza
modificato. Prossimo passo proposto: valutazione della schermata su un runtime
già autorizzato prima di collegare qualsiasi dato reale.
