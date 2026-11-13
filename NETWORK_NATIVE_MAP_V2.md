# NETWORK 2.0 — componente nativo riutilizzabile (Fase 9)

## Perimetro

`components/network/NetworkMap.native.tsx` è la superficie cartografica Android/iOS.
`NetworkMap.types.ts` è il contratto di presentazione, `NetworkMapModel.ts` contiene
validazione/proiezione pubblica, clustering visivo e calcolo della camera.
Nessun import da fixture, schermate del prototipo, sessione utente, storage, GPS,
servizi applicativi o database. Nessuna dipendenza aggiunta. Il prototipo e il
NETWORK legacy non sono collegati né modificati da questa fase.

Il componente usa react-native-maps 1.20.1 già dichiarato/installato, non crea un
secondo sistema di mappe. Android usa il provider Google della libreria; iOS il
provider di piattaforma Apple, senza richiedere Google su iOS. La composizione
dell'app deve dichiarare configuration=READY solo dopo configurazione nativa
appropriata. Il componente non legge/configura chiavi e non abilita servizi.
Non c'è fallback geografico fittizio: in caso di indisponibilità compare uno
stato esplicito, con retry del solo modulo cartografico.

## Contratto per il servizio futuro

- snapshot completo, immutabile, di soli NetworkMarkerV2 già autorizzati e
  pubblicabili. Non passare pagine parziali come se fossero il totale.
- scopeKey opaco, senza dati personali, da cambiare su logout/cambio account,
  perdita autorizzazione o cambiamento del territorio consultabile. Cambia la
  chiave della sessione nativa e invalida i callback precedenti.
- sequence intera crescente nel contesto: risultati vecchi vengono rifiutati
  senza conservare marker precedenti. Loading/error svuotano i marker.
- camera con regione pubblica e requestId: stesso ID preserva pan/zoom manuale;
  nuovo ID richiede uno spostamento esplicito. Ricentra torna alla regione fornita,
  mai alla posizione personale. Helper per raggi 1/2,5/5/10 km, con centro e
  rapporto dimensioni dinamici: non costituisce un filtro geografico server.
- onSelect restituisce soltanto ID pubblici e tipo EVENT/CLUSTER. Il controller
  esistente/futuro decide apertura dettaglio e, per un cluster, zoom o elenco.
- onViewportChange restituisce la sola regione della mappa, non un GPS utente.
- contentInsets riserva spazio per header/pannello e controlli senza dipendenze
  da una specifica schermata. selectedPublicId evidenzia il marker selezionato.

Il servizio dovrà gestire cancellazione richieste, ordine risposte, retry limitati,
rete intermittente, filtri, autorizzazioni e aggiornamenti concorrenti. Un controllo
UI di sequence non sostituisce la concorrenza e l'idempotenza server-side.
Non esiste gestione account hardcoded nel renderer: è il chiamante a cambiare
namespace e cancellare dati sensibili. Errori e loading non mostrano una cache
precedente come risultato valido. Nessun retry di dati/API parte dalla mappa.

## Rendering, privacy e limiti espliciti

La validazione V2 rifiuta campi extra e duplicati. Il modello proietta solo ID
pubblico, categoria, stato/tipo, coordinate pubbliche e scadenza; nessun nickname,
testo libero, account ID o posizione autore arriva a Marker. Dati scaduti rimossi
alla loro deadline JS, con rivalutazione al ritorno in foreground; un evento
scaduto non può essere selezionato. L'orologio client e i timer sospesi dal sistema
non sono una fonte autorevole di autorizzazione: la revoca tempestiva richiede
future verifiche/invalidazioni server e del controller. Nessuna garanzia offline
di autorizzazione è fornita da questa UI.

Cluster neutri numerici dei soli marker validi nella viewport (con piccolo buffer),
con separazione tra attive/concluse/storico. Le cinque categorie mantengono il
registro V2 e icone vettoriali senza font asincroni. Non sono livelli di pericolo.
La griglia è un'approssimazione visiva dipendente dallo zoom, non aggregazione
territoriale né garanzia di anonimato; celle adiacenti non sono un algoritmo
di distanza esatta. All'antimeridiano non si calcolano medie di longitudine errate.
I marker sono centrati su punti evento già pubblicabili, mai su posizioni autore.

Budget esplicito: 2000 marker in uno snapshot, oltre il quale non si troncano i
conteggi: si richiede di restringere zona/filtri. Questo budget NON dimostra
prestazioni sufficienti e non sostituisce paginazione/aggregazioni server future.
Le viste marker personalizzate usano l'aggiornamento nativo standard della
libreria: consumo, fluidità e snapshot delle icone richiedono benchmark reali.

Nessuna acquisizione posizione, localizzazione automatica o richiesta permessi.
Il renderer non importa API SOS e non invia eventi/telemetria. Il provider nativo,
quando montato in un'app configurata, può ricevere viewport e richieste tile:
la sua informativa, configurazione e condizioni devono essere verificate prima
di esporre la funzione al pubblico. Il componente non prova che i tile siano
stati scaricati né che la cartografia sia percepibile: onMapReady è disponibilità
della superficie SDK, non prova di connessione o lettura dell'utente.

## Verifiche e prerequisiti del rilascio

Test locale: `node scripts/test-network-native-map.cjs` esercita modello reale e
callback/hook con dipendenze native controllate; include privacy forma DTO,
scadenza, risposta obsoleta, callback vecchie, reset contesto, camera, provider
Android/iOS, modulo assente e ready tardivo dopo timeout. TypeScript noEmit e
ESLint mirati non compilano Kotlin/Swift o il motore SDK.

Prima di sperimentazione pubblica occorrono integrazione con controller/servizi
autorizzati, contratti backend/RLS, test multiutente e revoca/concorrenza,
configurazione provider lecita, prove reali su Android/iOS supportati (versioni
minime da confermare con la configurazione nativa finale), font grandi/screen
reader, rete assente/instabile, background/foreground, rotazione e cambio account.
Benchmark su dispositivi di fasce diverse e carico server devono verificare
budget dati, clustering, marker, memoria e frame rate. Due telefoni sono una
prima verifica end-to-end, non una certificazione di rilascio.

Non sono stati eseguiti build, prebuild, SQL remoto, installazioni, configurazioni
provider o modifiche alle funzioni di emergenza. Il componente non è ancora
collegato a una route e non è una funzionalità pubblica pronta.
