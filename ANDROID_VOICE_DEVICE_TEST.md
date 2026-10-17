# Voice stability — protocollo dispositivo (non eseguito)

Il candidato contiene correzioni di lifecycle, non una promessa di riconoscimento
in presenza di rumore. Nessun guadagno microfono, confronto permissivo o nuova
registrazione audio è stato introdotto. Il plugin aggiorna il codice nativo solo
durante una futura preparazione/build avviata manualmente da Tiziano.

## Prerequisiti

- Annotare fingerprint APK, modello, versione Android, motore vocale/versione,
  disponibilità modello italiano offline e stato permessi microfono.
- Usare esclusivamente un ambiente di prova autorizzato, destinatari di test e
  consenso degli operatori. Non coinvolgere contatti o servizi di emergenza reali.
- Verificare conferma ASCOLTO prima di pronunciare la frase. Non annotare la frase
  o trascrizioni nei log; registrare solo tempi, stato ed esito.

## Sequenza su entrambi i telefoni

1. ON: conferma nativa, indicatore microfono, nessun secondo listener.
2. Ripetere 10 prove in quiete, poi 10 con musica e 10 con rumore ambientale,
   mantenendo distanza e volume documentati. Misurare successi/mancati riconoscimenti
   e latenza; includere frasi non corrispondenti come controllo falsi positivi.
3. SOS di prova: ascolto sospeso per tutta l'emergenza. Solo dopo chiusura reale
   e cleanup, attesa controllata 1,5 s e nuova conferma nativa. Ripetere la parola
   anche entro 30 s dalla prima attivazione: una sola nuova emergenza intenzionale.
4. Cambiare parola mentre ON, anche uscendo subito dalla schermata: vecchia parola
   non valida; nuova valida dopo la nuova conferma ASCOLTO.
5. OFF durante ripristino e durante SOS: indicatore microfono rilasciato, nessun
   ascolto o restart dopo chiusura SOS. Ripetere rapidi OFF/ON e cambio account.
6. Provare app foreground/background e schermo bloccato; introdurre un'interruzione
   microfono con un'altra app. Verificare retry limitati e stato OFF/errore chiaro
   dopo esaurimento, mai falsa indicazione di protezione attiva.

## Criteri

BLOCKER: falso SOS, SOS duplicato, restart dopo OFF, vecchia parola ancora valida,
microfono trattenuto dopo OFF, LISTENING senza conferma nativa, ripristino durante
SOS attivo. Mancati riconoscimenti con musica/rumore richiedono analisi motore e
dispositivo: i test locali non possono determinarne la percentuale né garantire
continuità in background. Nessuna funzione safety è dichiarata affidabile prima
delle prove reali e della compilazione Kotlin nella futura build manuale.

## Phase 6B — creazione remota incerta

La risoluzione della Promise SOS non prova la riuscita della creazione remota:
`remote_creation_timeout` e `remote_creation_error` conservano il tentativo
account-scoped come `unknown`, con ID locale ed eventuale ID remoto. La chiusura
locale può chiudere la UI, ma non elimina questo journal né riavvia la voce.
La schermata mostra ESITO SOS INCERTO e RIPROVA VERIFICA SOS; OFF rimane disponibile.
Una SELECT vuota non può escludere un INSERT legacy ancora pendente. Non sono
previsti retry di creazione, chiusure automatiche o nuovi invii per risolverlo.
L'assenza di correlazione server per quel tentativo resta un limite: la sola
presenza/chiusura di un altro SOS non certifica l'esito del tentativo incerto.
La perdita integrale dello storage non è risolvibile dal solo journal locale.

In un ambiente di test autorizzato verificare separatamente: timeout di creazione,
chiusura solo locale, riapertura app, verifica read-only e OFF. Atteso: nessun
restart automatico e nessun invio duplicato. Un timeout del solo dispatch push,
con ID SOS remoto già confermato, non rende incerta la creazione. Il normale
percorso offline esplicitamente locale resta distinto dal timeout di un INSERT.
