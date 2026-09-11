const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// eslint-disable-next-line no-undef
const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const migration = read('supabase/migrations/20260911120000_neighborhood_network_mvp.sql');
const trustedMigration = read('supabase/migrations/20260721120000_trusted_links.sql');
const screen = read('screens/NeighborhoodNetworkScreen.tsx');
const service = read('services/NeighborhoodNetworkService.ts');
const repository = read('backend/repositories/NeighborhoodNetworkRepository.ts');
const home = read('app/(tabs)/index.tsx');

const check = (name, callback) => {
  callback();
  process.stdout.write(`PASS ${name}\n`);
};

check('private neighborhood tables use RLS and no direct client grants', () => {
  for (const table of [
    'neighborhood_networks',
    'neighborhood_members',
    'neighborhood_invitations',
    'neighborhood_invite_tokens',
    'neighborhood_invite_attempts',
  ]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security;`));
    assert.match(migration, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated;`));
  }
});

check('all client neighborhood RPCs are protected and authenticated-only', () => {
  const functions = [
    ['create_neighborhood_network', '\\(text\\)'],
    ['get_my_neighborhood_overview', '\\(\\)'],
    ['list_my_neighborhood_members', '\\(uuid\\)'],
    ['list_my_neighborhood_invitations', '\\(\\)'],
    ['generate_my_neighborhood_invite_token', '\\(\\)'],
    ['create_neighborhood_invitation', '\\(uuid, text\\)'],
    ['respond_to_neighborhood_invitation', '\\(uuid, boolean\\)'],
    ['cancel_neighborhood_invitation', '\\(uuid\\)'],
    ['remove_neighborhood_member', '\\(uuid, uuid\\)'],
    ['leave_neighborhood_network', '\\(uuid\\)'],
  ];
  for (const [name, signature] of functions) {
    assert.match(migration, new RegExp(`create or replace function public\\.${name}`));
    assert.match(migration, new RegExp(`revoke all on function public\\.${name}${signature} from public, anon;`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${name}${signature} to authenticated;`));
  }
  assert.equal((migration.match(/security definer/g) ?? []).length, functions.length);
  assert.equal((migration.match(/set search_path = public,(?: extensions,)? pg_temp/g) ?? []).length, functions.length);
});

check('legacy SML public code remains unchanged and unused by neighborhood invitations', () => {
  assert.match(trustedMigration, /SML-' \|\| upper/);
  assert.doesNotMatch(migration, /profiles_public_code|p\.public_code|target_public_code|SML-/);
  assert.doesNotMatch(service, /PUBLIC_CODE|SML-/);
});

check('dedicated invite token has 128-bit entropy, hash-only storage and 24-hour expiry', () => {
  assert.match(migration, /'NQ-' \|\| upper\(encode\(gen_random_bytes\(16\), 'hex'\)\)/);
  assert.match(migration, /token_hash bytea not null unique/);
  assert.match(migration, /digest\(raw_token, 'sha256'\)/);
  assert.match(migration, /now\(\) \+ interval '24 hours'/);
  assert.match(migration, /used_at is null and expires_at > now\(\)/);
  assert.match(service, /\^NQ-\[0-9A-F\]\{32\}\$/);
});

check('server-side attempt, hourly and pending invitation limits are enforced', () => {
  assert.match(migration, /interval '10 minutes'\) >= 10/);
  assert.match(migration, /interval '1 hour'\) >= 10/);
  assert.match(migration, /status = 'pending'\) >= 20/);
  assert.match(migration, /neighborhood_invite_attempts/);
});

check('non-invitable targets return one uniform result without identity disclosure', () => {
  assert.ok((migration.match(/return query select null::uuid, false;/g) ?? []).length >= 6);
  assert.match(repository, /if \(!data\.invitation_created\) throw new Error\('Impossibile inviare l’invito\.'\)/);
  assert.doesNotMatch(migration, /SafeMeLink user not found|You cannot invite yourself|already belongs to this neighborhood network/);
});

check('active membership in any neighborhood prevents another invitation', () => {
  assert.match(migration, /where m\.user_id = target_user_id and n\.status = 'active'/);
  assert.doesNotMatch(migration, /unique\s*\(user_id\)/i);
});

check('expired invitations are persisted as expired and never accepted', () => {
  assert.ok((migration.match(/set status = 'expired', responded_at = now\(\)/g) ?? []).length >= 3);
  assert.match(migration, /where invited_user_id = actor_id and status = 'pending' and expires_at <= now\(\)/);
  assert.match(repository, /data\.invitation_status === 'expired'/);
});

check('MVP single-network create and accept paths share an account lock', () => {
  assert.ok((migration.match(/pg_advisory_xact_lock\(hashtextextended\(actor_id::text, 0\)\)/g) ?? []).length >= 3);
  assert.match(migration, /User already belongs to a neighborhood network\./);
});

check('account generation owns UI action lock and stale actions cannot release it', () => {
  assert.match(screen, /sessionGenerationRef\.current !== actionGeneration/);
  assert.match(screen, /actionRef\.current !== operationId/);
  assert.match(screen, /actionRef\.current = null;\s+setBusy\(false\)/);
  assert.doesNotMatch(screen, /finally \{\s+actionRef\.current = null/);
});

check('UI remains separate from NETWORK, location and recurring polling', () => {
  assert.match(home, /\/neighborhood-network/);
  assert.match(screen, /Rete di quartiere/);
  assert.doesNotMatch(screen, /RadarProvider|useRadar|find_nearby|LocationService|latitude|longitude/);
  assert.doesNotMatch(repository, /from ['"]@\/backend\/repositories\/NetworkRepository|radar_presence|network_reports/);
  assert.doesNotMatch(screen, /setInterval|setTimeout|watchPosition|AppState/);
});

check('client-visible records exclude personal identity and precise location', () => {
  const memberReturn = migration.match(/list_my_neighborhood_members[\s\S]+?language plpgsql/)?.[0] ?? '';
  const invitationReturn = migration.match(/list_my_neighborhood_invitations[\s\S]+?language plpgsql/)?.[0] ?? '';
  for (const block of [memberReturn, invitationReturn]) {
    assert.doesNotMatch(block, /email|phone|latitude|longitude|account_verifications/i);
  }
  assert.doesNotMatch(memberReturn, /user_id uuid/);
  assert.match(memberReturn, /nickname text/);
});

process.stdout.write('Neighborhood Network MVP static checks passed.\n');
