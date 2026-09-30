# Android real-device follow-up — local only

Branch: android/real-device-fixes-2026-09-29. No build or remote changes.

## SMS evidence and limits

Compared current code with 7ea15ac (automatic SMS fix), subsequent commits and
the unchanged native SafeMeLinkSmsModule. SEND_SMS and Android gating remain.
No SOS-network preference gates automatic SMS. Later changes added account checks,
durable attempt deduplication, max-three recipients and nullable-location messages.
They are not proven causes of the real-device failure. The remote-contact timeout
could discard the local list; the local fallback now avoids that specific failure.

SMS_CONTACTS_LOADED / SMS_ELIGIBILITY / SMS_NATIVE_ATTEMPT / SMS_NATIVE_RESULT
and SMS_FALLBACK_RESULT contain counts/categories only. Permission/consent/module
failures already have distinct sanitized categories. Native success means handed
to SmsManager, NOT delivery. SIM/default subscription, carrier, balance, denied
permission, consent, missing international number, native availability and an
earlier uncertain attempt remain possible real-device causes. No unsafe SMS retry.

## QR and installation

Format: safemelink://connect?token=SML-0123ABCD (example only).
Opening pre-fills the existing request form; explicit send and recipient acceptance
are required. The existing backend validates the code. It does not expose a public
nickname lookup before the request; do not invent identity from the QR.
The user must already have completed onboarding/login; if redirected during first
onboarding, scan again after completion. No automatic link creation.

INSTALL FALLBACK REQUIRES HTTPS APP LINK / DOMAIN.
No verified domain/assetlinks configuration was found. Future work needs an owned
HTTPS domain, /connect landing page, Android intent filter with autoVerify, hosted
.well-known/assetlinks.json containing production signing fingerprints, and explicit
store fallback. Do not invent a domain. Lens/OEM custom-scheme handling needs a
device test; an HTTPS App Link is needed for dependable browser/install behavior.

## Destination and contacts

Expo Contacts SDK54 picker provides native search. Permission only at tap. No
address-book upload, no save until normal form submit, international number rules
unchanged. Multiple numbers require selection and confirmation before replacing fields.
WRITE_CONTACTS is blocked. New native dependency requires a future APK.

Expo geocoding uses explicit foreground permission and bounded waits; results need
explicit selection. Only Casa coordinates persist through existing account-scoped
storage. No multi-destination address book added. The route does not arm Go Home;
the existing start flow reads Casa and obtains current GPS as departure.

Exact-alarm settings use the existing native official intent immediately; no toggle
is set by the app, no automatic start on return, explicit activation checks again.

## Required APK retest

SMS with network ON/OFF, zero nearby, permission denied/permanently denied, valid
SIM and max-three contacts. Check carrier delivery separately from handoff logs.
Voice rapid OFF/ON, OFF during recovery/SOS, foreground/background, microphone
indicator after OFF. QR via Lens on Samsung/Xiaomi and cold/warm app.
Picker denied/cancel/no-number/multiple-number and font scaling/small-screen input.
Exact alarm settings return without auto-start. Address valid/ambiguous/offline,
account switch during lookup, Casa different from departure, ETA and cancellation.
