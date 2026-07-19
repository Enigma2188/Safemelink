# SafeMeLink backend - Phase 1

This phase prepares Supabase without changing the current application flows.
SOS events and trusted contacts still use the existing local storage and remain
available when Supabase is absent or offline.

## Included

- Supabase client configured for Expo/React Native.
- Session persistence through the already installed AsyncStorage package.
- Typed, isolated repositories that are not imported by screens or current services.
- Initial PostgreSQL schema, indexes, constraints, triggers, and Row Level Security.
- `profiles`, `sos`, `trusted_contacts`, `guardian`, and schema-only `nearby_alerts` tables.

## Not active

- Remote SOS submission or position updates.
- Contact synchronization.
- Operational Guardian flows.
- Radar or reads/writes to `nearby_alerts`.
- Push notifications, remote Checkpoint, Go Home, passphrase, or cloud audio.
- Login and registration screens.

## Configure a Supabase project

1. Create a Supabase project.
2. Open the SQL editor and run `supabase/migrations/001_initial_schema.sql` once.
3. Copy `.env.example` to `.env.local`.
4. Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
5. Restart Expo after changing environment variables.

Never expose the Supabase `service_role` key in this application. Only the public
anonymous key belongs in an `EXPO_PUBLIC_*` variable. RLS remains the security boundary.

## Type generation

`backend/database.types.ts` mirrors the initial migration so the project can compile
before a remote project exists. Once the project is linked through the Supabase CLI,
regenerate this file from the live schema and review the resulting diff.

## Activation strategy

The repositories are intentionally disconnected. A later approved phase can add
authentication, migrate local records idempotently, and switch individual services
to remote-first or local-first behavior without changing the screens all at once.
