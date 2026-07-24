# SafeMeLink — APK di test da un branch temporaneo

Questa procedura mantiene sul branch principale soltanto il workflow tecnico.
Il codice applicativo ancora da provare resta nel branch `test/android-apk`.
La build parte solo manualmente e non usa EAS.

## 1. Architettura dei branch

- `main` contiene `.github/workflows/android-test-apk.yml`.
- `test/android-apk` contiene il codice completo da provare.
- In GitHub Actions, il campo `source_ref` deve essere impostato a
  `test/android-apk`.
- Il workflow caricato da `main` esegue il checkout del branch indicato e
  compila quel contenuto.
- Non effettuare merge del codice applicativo su `main` prima del test sui due
  telefoni e dell'approvazione finale.

GitHub carica la definizione del workflow prima del checkout. Il checkout del
branch temporaneo non sostituisce i passaggi dell'esecuzione già avviata.
Sostituisce invece correttamente i sorgenti, gli script e la configurazione che
devono essere verificati e compilati.

Il commit sul branch temporaneo è una versione candidata al test, non un nuovo
checkpoint stabile.

## 2. GitHub Secrets

Aprire:

`Settings → Secrets and variables → Actions → New repository secret`

Creare esattamente:

1. `ANDROID_GOOGLE_SERVICES_JSON_BASE64`
2. `EXPO_PUBLIC_SUPABASE_URL`
3. `EXPO_PUBLIC_SUPABASE_ANON_KEY`

Non usare mai la Supabase service role.

Per copiare negli appunti il Base64 del vero `google-services.json`, aprire
PowerShell nella cartella in cui si trova il file ed eseguire:

```powershell
[Convert]::ToBase64String(
  [IO.File]::ReadAllBytes((Resolve-Path ".\google-services.json"))
) | Set-Clipboard
```

Il file deve appartenere a `com.tiziano.safemelink`. Non copiarlo nel
repository e non pubblicarne il contenuto.

## 3. Commit tecnico del solo workflow su main

Prima di aggiungere qualsiasi file:

```powershell
git branch --show-current
git status
git diff --stat
git diff
```

Verificare di essere su `main`. Aggiungere esclusivamente il workflow:

```powershell
git add -- ".github/workflows/android-test-apk.yml"
git status
git diff --cached --stat
git diff --cached -- ".github/workflows/android-test-apk.yml"
```

Il riepilogo staged deve contenere un solo file. Soltanto dopo approvazione:

```powershell
git commit -m "Add manual Android test APK workflow"
git push origin main
```

Non usare `git add .` o `git add -A`.

## 4. Creazione del branch temporaneo

Dopo il commit tecnico su `main`, le altre modifiche devono essere ancora
presenti e non staged. Controllare:

```powershell
git status
git diff --stat
git diff
git switch -c test/android-apk
```

Il branch nasce dal `main` che contiene già il workflow e conserva le modifiche
locali non ancora registrate.

## 5. File esatti da aggiungere al branch temporaneo

Prima di aggiungerli:

```powershell
git status
git diff --stat
git diff
```

Eseguire i comandi uno alla volta:

```powershell
git add -- ".gitignore"
git add -- "app.json"
git add -- "app/(tabs)/index.tsx"
git add -- "app/_layout.tsx"
git add -- "app/emergency-profile.tsx"
git add -- "app/radar.tsx"
git add -- ":(literal)app/sos/[id].tsx"
git add -- "backend/auth/AuthProvider.tsx"
git add -- "backend/database.types.ts"
git add -- "backend/functions/SOSPushService.ts"
git add -- "backend/repositories/EmergencyProfileRepository.ts"
git add -- "backend/repositories/PushTokenRepository.ts"
git add -- "backend/repositories/RadarRepository.ts"
git add -- "backend/repositories/ReceivedSOSRepository.ts"
git add -- "backend/repositories/SOSLifecycleRepository.ts"
git add -- "components/PushTokenRegistrar.tsx"
git add -- "components/RadarProvider.tsx"
git add -- "GITHUB_ACTIONS_ANDROID_BUILD.md"
git add -- "hooks/useEmergencyProfile.ts"
git add -- "hooks/useNearbyUsers.ts"
git add -- "package.json"
git add -- "package-lock.json"
git add -- "screens/EmergencyProfileScreen.tsx"
git add -- "screens/RadarScreen.tsx"
git add -- "screens/TrustedContactsScreen.tsx"
git add -- "scripts/audit-static-checks.cjs"
git add -- "scripts/validate-android-ci.cjs"
git add -- "scripts/validate-generated-android.cjs"
git add -- "services/ContactsService.ts"
git add -- "services/EmergencyProfileService.ts"
git add -- "services/LocationService.ts"
git add -- "services/PushNotificationService.ts"
git add -- "services/RadarService.ts"
git add -- "services/SOSAlertService.ts"
git add -- "services/SOSLifecycleService.ts"
git add -- "services/SOSService.ts"
git add -- "services/TrustedLinksService.ts"
git add -- "storage/AccountScopedStorage.ts"
git add -- "storage/CheckpointStorage.ts"
git add -- "storage/ContactsStorage.ts"
git add -- "storage/GoHomeStorage.ts"
git add -- "storage/PassphraseStorage.ts"
git add -- "storage/SOSStorage.ts"
git add -- "supabase/functions/send-sos-push/index.ts"
git add -- "supabase/migrations/20260722120000_received_sos_details.sql"
git add -- "supabase/migrations/20260722130000_radar_presence.sql"
git add -- "supabase/migrations/20260722140000_radar_preferences_and_nickname.sql"
git add -- "supabase/migrations/20260723120000_emergency_profile.sql"
git add -- "supabase/migrations/20260724120000_sos_lifecycle_hardening.sql"
```

Controllare integralmente ciò che è staged:

```powershell
git status
git diff --cached --stat
git diff --cached
```

Non procedere se compare uno di questi elementi:

- `.env` o `.env.*`;
- `google-services.json`;
- la cartella `android/`;
- file `.jks`, `.keystore`, `.p12`, `.key`;
- password, token o credenziali.

Soltanto dopo approvazione:

```powershell
git commit -m "Prepare SafeMeLink Android APK test candidate"
git push -u origin test/android-apk
```

Non creare Pull Request e non effettuare merge prima del test APK.

## 6. Avvio manuale

1. Aprire GitHub → **Actions**.
2. Selezionare **Build SafeMeLink Android test APK**.
3. Premere **Run workflow**.
4. Lasciare selezionato `main`, perché il workflow deve essere letto da lì.
5. Nel campo **Branch or commit SHA to build** (`source_ref`) scrivere
   `test/android-apk`.
6. Premere il pulsante verde **Run workflow**.

`source_ref` accetta anche uno SHA di commit appartenente al repository.
Push, Pull Request e operazioni pianificate non avviano il workflow.

## 7. Risultati e diagnosi

Il workflow produce l'artifact `safemelink-android-test-apk`, contenente
`safemelink-test.apk`, conservato per 14 giorni.

In caso di errore, controllare il passaggio rosso e scaricare, quando
disponibile, `safemelink-android-build-logs`. L'artifact dei log include
soltanto:

- `expo-prebuild.log`;
- `gradle-build.log`;
- report tecnici Gradle.

`google-services.json` viene ricostruito sul runner, verificato e rimosso prima
dell'upload degli artifact. I file `.env` non vengono caricati.

## 8. Installazione sui due telefoni

Scaricare l'artifact, estrarre `safemelink-test.apk` e installarlo sui due
telefoni. Se la firma differisce dall'APK EAS già installato, disinstallare
prima la vecchia versione.

La disinstallazione cancella sessione e dati locali, ma non i dati Supabase.
Dopo l'installazione rifare login, concedere le notifiche e verificare la
registrazione dei token push.

## 9. Dopo il test

Se il test non è approvato, lasciare `main` invariato: il codice applicativo
resta soltanto su `test/android-apk`.

Se il test è approvato, aprire una Pull Request separata dal branch temporaneo
verso `main` e riesaminare tutte le modifiche. Non usare reset, force push o
merge automatici.
