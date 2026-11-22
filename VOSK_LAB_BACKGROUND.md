# Vosk Lab Android background — sperimentale, non protezione

## Abilitazione e modello

Default OFF: il gate nativo richiede esattamente `SAFEMELINK_VOSK_LAB=true`, non `__DEV__`. CORE/NETWORK ordinari sono invariati e non lo abilitano.
Solo il nuovo workflow manuale `.github/workflows/android-vosk-lab-apk.yml` imposta Vosk ON e NETWORK V2 OFF. Non e stato eseguito o pubblicato; richiede autorizzazione separata e registrazione sul branch predefinito prima del dispatch. Selezionare il branch del candidato, non main privo dei sorgenti completi.

L'archivio sorgente `modules/safemelink-vosk-lab/model-source/vosk-model-small-it-0.22.zip` (49.665.141 byte) deve essere incluso nella futura pubblicazione. Non e l'asset generato ignorato da Git. SHA-256: `9ec65e75861d1c6c2e457cccd932705340dcdf233f5b239f00733b4de0bf3267` (integrita della consegna, non firma indipendente del produttore).

Preparazione offline, eseguita anche dal workflow prima della compilazione:
```text
python3 scripts/prepare-vosk-lab-model.py modules/safemelink-vosk-lab/model-source/vosk-model-small-it-0.22.zip
```
Su Windows usare `py -3`. Hash, CRC e percorsi sono controllati; modello esistente riusato solo se identico, altrimenti overwrite rifiutato. Inventario POSIX portabile; Gradle ON richiede inventario fissato e hash dei 14 file. Nessun download al primo avvio. Vosk 0.3.75@aar e JNA 5.18.1@aar restano dipendenze della futura build; licenze Vosk/JNA della V1 conservate.

## Funzionamento

Avvio solo da tap in app visibile, utente autenticato, microfono/notifiche concessi, voce OFF, core libero, assenza di eventi SOS locali/journal incerti. Il bridge ricontrolla prerequisiti e riserva una generazione prima del foreground service. La preparazione del modello e fuori dal thread UI; parole assenti dal vocabolario sono rifiutate prima della cattura.

Audio e riconoscimento appartengono al servizio nativo `microphone`, non a React/JS. Home/altra app/schermo spento non provocano stop legato allo smontaggio della schermata. LISTENING richiede AudioRecord avviato e verificato. PREPARING/STOPPING/ERROR non sono ascolto confermato.

Notifica laboratorio con Ferma prova; stop anche dall'app. Stop su interruzione audio, silenziamento, revoca permessi, core/emergenza o cambio account. Recorder/recognizer/modello e focus sono rilasciati prima della prenotazione. Callback obsolete usano generazioni; nessuna disattivazione automatica della protezione reale.

Sessione massima 30 minuti; wake lock CPU parziale limitato a 31 minuti e rilasciato in finally, per elaborazione PCM a display spento. Nessuna esenzione batteria richiesta. START_NOT_STICKY, nessun boot receiver, nessun restart dopo stop/task rimosso/force-stop/morte processo. Android/OEM possono comunque interrompere: nessuna garanzia di continuita.

Solo risultati FINALI, una rilevazione per utterance completa contenente la frase per parole intere normalizzate. Ripetizioni nella stessa utterance valgono una; i parziali non incrementano. Nessuna grammatica ristretta/soglia presentata come affidabile. Falsi positivi e mancate rilevazioni richiedono misure reali.

Frase solo di prova, non parola operativa. Nessun salvataggio/export/invio di audio, trascrizione o frase; stato nativo volatile contiene solo stato, motivo tecnico e contatori, non account. Modello pubblico in storage privato. Nessuna API SOS/SMS/chiamata/backend nel servizio. Nessuna nuova lettura remota per certificare assenza SOS: stati esterni non ancora osservati richiedono collaudo della sincronizzazione esistente.

## Verifiche e disabilitazione

Catalogo RN 0.81.5: minSdk 24, target/compileSdk 36; manifest finale da verificare nella futura generazione Android. Permessi e servizio non esportato sono nel source set ON soltanto.
Test locali: test-vosk-lab, test-vosk-background, test-vosk-model-packaging; stato Java reale in scripts/java/VoskLabStateTest.java. La compilazione parziale del servizio con SDK reale ma stub Vosk/JNA/BuildConfig NON valida Kotlin, Gradle, R8, ABI o dispositivo. Consultare il rapporto datato per risultati effettivi.

Per disabilitare: Ferma prova nell'app/notifica, poi per APK ordinaria non impostare il gate true e usare il workflow CORE/NETWORK ordinario. Nessuna migrazione o cancellazione necessaria.

Checklist fisica: frase ripetuta e conversazioni senza frase; silenzio/TV/rumore/parole simili; Home/altra app/schermo spento; ritorno UI; stop da notifica/app anche in preparazione; revoca permessi/privacy e interruzioni audio; logout/cambio account; nessun SOS/SMS; batteria e temperatura per sessione prolungata; limite sessione, swipe task, force-stop e riavvio senza riattivazione.
Servono piu dispositivi/OEM/versioni Android, microfoni diversi e dispositivi 16 KB se previsti: un telefono non certifica compatibilita generale. Prove di emergenza reale richiedono autorizzazione separata.

Fonti: https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start ; https://developer.android.com/about/versions/14/changes/fgs-types-required ; https://alphacephei.com/vosk/models .

## Confronto sensibilità — 22 novembre 2026

Nel solo laboratorio è disponibile “Prova guadagno automatico del microfono”, inizialmente OFF, non persistita. La scelta attraversa coordinatore, bridge Kotlin e Intent della singola sessione; non può cambiare durante preparazione/ascolto. ON crea AutomaticGainControl sulla sessione AudioRecord, verifica disponibilità, controllo, risultato di setEnabled e stato effettivo. Impossibilità o perdita di controllo interrompono la prova con gain_unavailable / gain_control_unavailable / gain_enable_failed / gain_control_lost. Effetto e recorder sono rilasciati nel finally prima di liberare la sessione.

OFF non aggiunge un effetto AGC. Non certifica l'assenza di processing OEM: Android documenta che alcuni dispositivi possono inserire AGC in base alla sorgente audio. Nessuna impostazione globale, nuova autorizzazione o modifica alla sorgente VOICE_RECOGNITION. Il confronto è della richiesta applicativa OFF/ON, non una misura universale hardware grezza/elaborata.

Lo snapshot espone gainRequested, gainActive, audioLevel e audioPeak. I livelli sono indici interi 0–100 del medesimo PCM16 mono inviato a Vosk: RMS del blocco, 20 log10(RMS/32768), da −60 dBFS (o meno) a 0 dBFS, limitato e arrotondato. Il picco è il massimo dell'indice RMS nella sessione, non un picco fisico calibrato. Non rappresentano probabilità di riconoscimento o dB SPL. Stato e livelli rimangono solo in memoria; nessun audio aggiuntivo conservato, esportato o trasmesso.

Stop/errore azzerano corrente e gainActive; reset e nuova sessione azzerano corrente/picco/contatori; callback obsolete non aggiornano la generazione corrente. Una nuova sessione riparte dalla scelta esplicita dell'utente, non da una preferenza persistita. Il conteggio resta esclusivamente sui risultati finali, senza fuzzy matching o invii SOS.

Prova fisica da effettuare dopo build manuale: stessa frase e condizioni, OFF libero / OFF tasca / ON libero / ON tasca, fermando e azzerando tra prove, annotando livelli, picco e rilevazioni finali. La frase rimane soltanto nello stato volatile della schermata per facilitare il confronto ed è cancellata al cambio account/smontaggio; non usare la parola operativa. AGC può non essere disponibile o peggiorare i risultati. Nessuna sensibilità in tasca dimostrata dai test automatici.

Riferimento API: https://developer.android.com/reference/android/media/audiofx/AutomaticGainControl .
