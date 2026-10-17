# Phase 9 / 11B — recipient lifecycle and internal map

## Implemented locally

The Android route uses `AndroidReceivedSOSScreen` and `ReceivedSOSDetailController`.
The iOS renderer is left on its existing path. There is one per-screen logical
operation (status/detail or acceptance followed by verification) and one recursive
refresh timeout, 15 seconds after completion. Focus/foreground re-entry requests
an immediate verification. Pause/logout/context change clears protected state,
invalidates pending responses and cancels the timer. A previous transport request
may take its existing bounded timeout to settle; the new context waits for it
rather than starting overlapping operations. No unsupported promise cancellation
or guarantee about OS-level termination of an already-issued request is claimed.

Terminal/explicit unauthorized or missing outcomes stop refresh. If the status
adapter loses the error code for an empty result, a sequential authorized detail
RPC may establish unavailable access; generic status failure alone is not proof
of closure/denial. Network and unclassified failures hide data and allow a bounded
15-second retry/manual verification; no remote writes are retried automatically.

Position selection is account/SOS-scoped in memory, not persisted. Older/equal,
invalid and future timestamps do not replace a known timestamped fix. A fallback
is explicitly labelled last known, not a fresh observation. Unknown observation
time remains unknown: no chronological guarantee is possible for timestamp-less
coordinates. Network failure clears the position rather than retaining sensitive
data while access is unverified. Provider-independent readings are not physical
freshness proof when device clocks disagree.

The UI shows the reported GPS timestamp/age, accuracy when finite, and local
screen verification time. Server receipt time is not supplied and is not invented.
The medical/ICE card reuses the existing RPC and consent guards; refreshing,
pausing or loss of access unmounts it and discards sensitive state.

## Internal map: IMPLEMENTED LOCALLY, native operation NOT VERIFIED

The independent voice-stability node_modules uses Expo 54.0.33 / RN 0.81.5.
react-native-maps 1.20.1 (Expo SDK 54's bundled version) and its GeoJSON type
dependency were added; no existing locked package changed. The protected
pre-demo dependencies and iOS worktree were not modified.

`ReceivedSOSMap` loads the Android SDK only after an explicit authorized map
action, with an external-provider notice. Only selected authorized coordinates
are passed to a generically titled Marker. No IDs, names, profile data, recipient
GPS, new transport or polling are added. The navigator remains a separate static
external handoff.

The native surface stays mounted during routine authorization refresh, with an
opaque cover, disabled interaction/accessibility and no marker or visible GPS
metadata. This preserves camera/pan without adding persistent caching. Terminal,
denial, transport error, background, blur, logout or identity change removes it;
foreground recovery does not reopen it automatically. Server revocation is known
only when the existing controller verifies it, not instantaneously.

Pan/gesture disables following; the Marker continues to update. RICENTRA restores
following and moves to the current authorized point. Partial camera updates keep
zoom, and identical fixes do not trigger repeated movements. Old/unmounted map
callbacks cannot use a previously authorized point. A missing key/native manager,
load failure or bounded readiness timeout shows an unavailable fallback.

`app.config.js` resolves `SAFEMELINK_ANDROID_MAPS_API_KEY` at build time into
`android.config.googleMaps.apiKey`, the field read by the installed Expo Android
config plugin. Only a capability boolean is put in extra. Literal process.env
templates are rejected. No real key, Google project, billing or SDK activation
was created here. With no supplied key the native map SDK is not loaded.

Candidate: react-native-maps. Expo SDK 54 documents this package and Android
Google Maps / iOS Apple Maps or Google Maps. The exact version must be reviewed
against the project's RN 0.81.5 and configured architecture before a separately
authorized install; do not blindly choose the latest release.
Sources:
- https://docs.expo.dev/versions/v54.0.0/sdk/map-view/
- https://github.com/react-native-maps/react-native-maps
- https://developers.google.com/maps/documentation/android-sdk/usage-and-billing

Standalone Android Google Maps needs SDK enablement, a restricted API key and
native binary configuration. Billing must be enabled; charges/allowances depend
on the selected SKU/features/account and must be verified before activation.
No pricing promise or paid service has been started here. Restrict the key by
Android package, signing fingerprint and required API. Client SDK keys are
embedded in the app: restrictions, not secrecy of the APK, are the defence.

Privacy review must cover map-provider network requests and viewing location;
never attach SOS IDs, account IDs or emergency/medical contents to tile requests,
analytics or external links. A map provider must not become an authorization
source. Do not enable recipient location, location-dot tracking, routes/places
or other services by default. Review data-disclosure notices before adoption.

## Remaining manual configuration and native verification

1. Separately approve Google configuration and verify billing/SDK costs. Restrict
   the Android key to `com.tiziano.safemelink`, actual signing SHA-1(s), and Maps SDK
   for Android. No Map ID, Routes, Places, Directions or Street View is used.
2. Supply the environment key to the manually launched build. No credentials
   belong in source; client key restrictions are essential because APK keys can
   be extracted. Existing binaries cannot gain the native module via JS alone.
3. Tiziano must manually authorize/run compilation and real-device tests on both
   phones: tiles/key acceptance, marker, pan/zoom, RICENTRA, refresh cover and
   cleanup. Mocked component/controller tests are not native rendering proof.
   onMapReady alone does not prove successful Google key authorization or tiles;
   an invalid restricted key can still yield an empty native map and must be
   detected by real-device validation. No native compile has been performed.
4. A future iOS adapter can use Apple Maps without changing Android semantics,
   but requires its own branch authorization and native/device validation.

Files affected in Phase 11B: package.json, package-lock.json, app.config.js,
components/ReceivedSOSMap.tsx, screens/AndroidReceivedSOSScreen.tsx, dedicated map
and recipient lifecycle tests and this document. Sender GPS cadence, backend,
SOS writer, voice runtime and Phase 8 migration remain unchanged in this phase.
