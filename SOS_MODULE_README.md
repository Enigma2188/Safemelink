# SafeMeLink - Modulo SOS

Questo documento descrive il modulo SOS di SafeMeLink v0.2.

## Obiettivo

Il modulo SOS gestisce:

- contatti fidati locali, massimo 3;
- timer di sicurezza annullabile;
- recupero posizione GPS;
- preparazione messaggio SOS;
- apertura invio SMS verso i contatti fidati, con fallback alla condivisione nativa;
- salvataggio locale degli eventi SOS.

Non include Radar, backend, Firebase, login, cloud, notifiche push o utenti vicini.

## File creati

- `services/ContactsService.ts`
- `services/LocationService.ts`
- `services/SOSService.ts`
- `storage/ContactsStorage.ts`
- `storage/SOSStorage.ts`
- `screens/TrustedContactsScreen.tsx`
- `app/(tabs)/contacts.tsx`
- `SOS_MODULE_README.md`

## File modificati

- `app/(tabs)/index.tsx`
- `app/(tabs)/_layout.tsx`
- `components/ui/icon-symbol.tsx`
- `app.json`
- `package.json`
- `package-lock.json`

## Struttura

```text
services/
  ContactsService.ts
  LocationService.ts
  SOSService.ts

storage/
  ContactsStorage.ts
  SOSStorage.ts

screens/
  TrustedContactsScreen.tsx

app/(tabs)/
  index.tsx
  contacts.tsx
```

## Flusso SOS

1. L'utente preme il pulsante SOS nella Home.
2. Parte un timer di sicurezza.
3. L'utente puo annullare prima della fine del timer.
4. Alla fine del timer, `SOSService` recupera i contatti fidati.
5. `LocationService` chiede la posizione GPS reale.
6. `SOSService` prepara il messaggio con richiesta di aiuto, coordinate, link Google Maps, data e ora.
7. L'app prova ad aprire l'invio SMS verso i contatti.
8. Se il link SMS non e disponibile, usa la condivisione nativa.
9. `SOSStorage` salva l'evento sul dispositivo.

## Contatti fidati

`TrustedContactsScreen` consente di:

- aggiungere un contatto;
- modificare un contatto;
- eliminare un contatto;
- salvare fino a 3 contatti.

I dati sono persistiti con AsyncStorage tramite `ContactsStorage`.

## Dipendenze

- `@react-native-async-storage/async-storage`
- `expo-location`

Entrambe sono usate solo per il modulo SOS.

## Come estendere

Per aggiungere nuovi moduli futuri, non modificare direttamente la logica SOS se non necessario.

- Radar: creare un modulo separato, ad esempio `services/RadarService.ts`.
- Backend/Firebase: introdurre un repository remoto separato e lasciare `SOSStorage` come storage locale.
- Notifiche push: aggiungere un servizio dedicato, ad esempio `services/NotificationService.ts`.
- Invio SOS avanzato: estendere `SOSService.sendSOS` mantenendo invariata la firma pubblica.

Il modulo SOS deve restare responsabile solo di emergenza, posizione, messaggio, contatti fidati ed evento locale.
