# NETWORK 2.0 — implementazione locale, non rollout

Base 4f9c2028; worktree e branch indipendenti. Nessun database consultato o modificato.

## Riutilizzato dal repository

- NetworkService/NetworkRepository: onboarding, nickname, termini, feed paginato,
  raggi 1/2,5/5/10 km, pubblicazione, conferme, “Non più presente”, aggiornamenti
  dell'autore e segnalazione contenuti alla moderazione.
- Lo schema versionato usa RLS e tabelle private con accesso via RPC, controlli
  account/restrizioni, rate limit e grant di visibilità a scadenza. La RPC feed
  non è una SELECT pura: registra rate limit e grant. NON eseguita qui.
- La RPC add_network_report_update permette scritture SOLO all'autore, con limiti
  di lunghezza/numero e contenuto visibile. Non è un sistema di commenti pubblici.
- SERIA/RELAX non sono categorie del contratto attuale: nessuna categoria fittizia.

## Limite cartografico concreto

Il feed espone public_area e distance_bucket_meters, NON latitudine, longitudine
pubblica o un identificativo di zona. public_area_label ha default “Area
approssimativa”. Non permette di assegnare marker a vie/quartieri. NON usare
coordinate SOS, posizioni esatte private, geocoding del testo o distanze per
inventare direzioni. Il pannello cartografico dichiara esplicitamente il blocco.
react-native-maps 1.20.1 e il config Android esistono già; richiedono anche una
configurazione cartografica autorizzata. Nessuna chiave letta/creata, nessun SDK,
billing, workflow o dipendenza modificati.

La mappa comunale completa richiede una proposta backend separata: geometrie
pubbliche sufficientemente aggregate, confine comunale verificato, query per
territorio invece del solo raggio GPS e filtri server con paginazione coerente.
Non è autorizzata né implementata in questo intervento.

## Indicatori locali, non statistiche del Comune

Si contano soltanto le segnalazioni caricate, deduplicate per ID, nel periodo e
nei filtri scelti. Fasce radiali 0–1/1–2,5/2,5–5/5–10 km, NON quartieri.
Il massimo locale di 100 record e i contatori parziali sono dichiarati nella UI.
La distanza del singolo report resta nascosta, come nel precedente contratto UI;
le distanze arrotondate servono soltanto a raggruppare le fasce del feed.
Le soglie sono in NetworkPilotConfig.ts e visibili nella legenda: meno di 3
record non genera un indicatore; 3–4 basso, 5–9 intermedio, almeno 10 elevato.
Sono scelte di presentazione preliminari, NON una prova di anonimizzazione né
indicatori di criminalità. Necessaria revisione privacy prima del pilot; non
pubblicare celle/ring di singoli cittadini, dati SOS o graduatorie “zone sicure”.
Filtri e conteggi sono locali: un risultato vuoto non prova assenza di eventi.

## Storico e conservazione

Migration 20260914120000: RESOLVED visibili per 24 ore (resolved_visibility).
EXPIRED/HIDDEN sono esclusi dal feed. expire_network_reports cambia lo stato;
non elimina i report nello schema esaminato, ma ripulisce rate limit e grant.
Non è dimostrata la conservazione/deploy effettiva del database remoto.
La UI mostra SOLO lo storico disponibile dalle RPC esistenti, in ordine
cronologico, con stato attuale/concluso. Nessuna cache storica persistente.
Uno storico plurimensile richiede autorizzazione: finalità e retention, testi
minimizzati/moderati, cancellazione/rettifica, aggregati sufficientemente ampi,
ricontrollo autorizzazioni e paginazione. Non semplicemente allungare la scadenza.

## Partecipazione e limiti privacy

Dettaglio riletto su apertura; accesso mancante/errore nasconde il contenuto.
Stato sensibile locale eliminato quando cambia account o si chiude il pannello;
il pannello si chiude quando l'app va in background. Nessun salvataggio locale
di contenuti/identità o analytics nuovi. Revoca remota mentre il dettaglio resta
aperto non è istantanea: limite da progettare con invalidazione/TTL prima del
rollout; un contenuto già visto/copiato non può essere ritirato dal dispositivo
di una persona. Il report contenuti riusa la RPC esistente, NON una nuova coda.
I commenti pubblici e il canale feedback non sono abilitati: servono moderazione,
anti-spam, revoca/cancellazione, ruoli operativi e un canale concordato col pilot.
Nessun dato di esempio è esposto nella UI. I 150 tester non sono utenti contati.

## Esclusione reversibile della categoria bullismo

Gate bullyingEnabled=false: nasconde la categoria esplicita CYBERBULLYING e
impedisce selezione/invio di una bozza di quella categoria anche tramite stato
obsoleto. Non vengono rimossi i percorsi generici Segnale Tutela o gli accessi
Home: non sono etichettati come bullismo e contengono anche altre richieste di
aiuto. Tipi, testo storico e dati backend restano intatti. Nessun flusso SOS
alterato. Il gate può essere riabilitato con una decisione successiva.

## Prima dei 150 tester

Validare runtime RPC/permessi/config deployment, processo di moderazione e testi
privacy, retention e canale feedback; decidere backend mappa/storico separatamente.
Test Android reale: schermi piccoli, font grandi, TalkBack, offline, cambio account,
scadenza grant, paginazione, dettaglio, proprie segnalazioni e segnalazioni altrui.
I test locali non certificano rendering nativo, disponibilità server o performance
con 150 utenti. Nessuna build, push, migration o attivazione effettuata qui.
