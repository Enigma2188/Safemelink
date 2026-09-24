const fs = require('fs');
const path = require('path');

const root = path.resolve(process.cwd());
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const sql = read('supabase/migrations/20260922120000_neighborhood_discussions.sql');
const runtimeFix = read('supabase/migrations/20260922123000_neighborhood_discussions_runtime_fix.sql');
const createFix = read('supabase/migrations/20260922124500_neighborhood_discussions_create_fix.sql');
const repository = read('backend/repositories/NeighborhoodNetworkRepository.ts');
const service = read('services/NeighborhoodNetworkService.ts');
const screen = read('screens/NeighborhoodNetworkScreen.tsx');

const checks = [
  ['discussion table', /create table if not exists public\.neighborhood_discussions/.test(sql)],
  ['message table', /create table if not exists public\.neighborhood_messages/.test(sql)],
  ['one General index', /unique index if not exists neighborhood_discussions_one_general_idx/.test(sql)],
  ['runtime ambiguity fix', /create or replace function public\.list_my_neighborhood_discussions/.test(runtimeFix) && /on conflict do nothing/.test(runtimeFix) && !/on conflict \(network_id\)/.test(runtimeFix)],
  ['create discussion insert fix', /create or replace function public\.create_neighborhood_discussion/.test(createFix) && /target_network_id,\s*actor_id,\s*btrim\(target_title\),\s*target_category/.test(createFix)],
  ['membership checks', /neighborhood_members/.test(sql) && /Membership required/.test(sql)],
  ['security definer and explicit search path', (sql.match(/security definer set search_path = public, pg_temp/g) || []).length >= 5],
  ['direct table grants revoked', /revoke all on public\.neighborhood_discussions, public\.neighborhood_messages from public, anon, authenticated/.test(sql)],
  ['authenticated RPC grants', /grant execute on function public\.create_neighborhood_message\(uuid,text\) to authenticated/.test(sql)],
  ['nickname-only output', /author_nickname/.test(sql) && !/email|phone|latitude|longitude/.test(sql)],
  ['repository RPC contract', repository.includes("list_my_neighborhood_discussions") && repository.includes("create_neighborhood_message")],
  ['service validation', service.includes('Il titolo deve contenere da 3 a 100 caratteri') && service.includes('2000')],
  ['message rate limit', /Troppi messaggi/.test(sql) && /interval '1 minute'/.test(sql)],
  ['screen discussion UI', screen.includes('title="Discussioni"') && screen.includes('INVIA MESSAGGIO') && screen.includes('updated_at')],
  ['no geographic discovery UI', !screen.includes('find_nearby_users')],
];
const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
if (failed.length) {
  console.error(`Neighborhood discussions checks failed: ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`Neighborhood discussions checks passed (${checks.length})`);
