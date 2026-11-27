const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = path => fs.readFileSync(path, 'utf8');
const migration = read('supabase/migrations/20260723120000_emergency_profile.sql');
const received = migration.split('create or replace function public.get_received_sos_emergency_profile(target_sos_id uuid)')[1];
const grants = read('supabase/migrations/20261127120000_emergency_profile_rpc_access.sql');
const recipient = read('components/ReceivedEmergencyInformation.tsx');
const owner = read('screens/EmergencyProfileScreen.tsx');

for (const condition of [
  "emergency_sos.status in ('open', 'accepted')",
  'emergency_sos.user_id = auth.uid()',
  'trusted_contact.user_id = emergency_sos.user_id',
  'trusted_contact.linked_profile_id = auth.uid()',
  'emergency_profile.share_medical_data_during_sos = true',
  'emergency_profile.share_ice_contact_during_sos = true',
]) assert.ok(received.includes(condition), `Missing read guard: ${condition}`);
assert.doesNotMatch(received, /nearby_alerts|sos_network_presence|neighborhood_members/i);
for (const field of ['declared_blood_group', 'severe_allergies', 'important_conditions',
  'relevant_medications', 'lifesaving_medications', 'emergency_notes']) {
  assert.match(received, new RegExp(`case when emergency_profile\\.share_medical_data_during_sos\\s+then emergency_profile\\.${field} else null end`));
}
assert.match(received, /case when emergency_profile\.share_ice_contact_during_sos\s+then emergency_profile\.ice_contact else null end/);
assert.match(grants, /revoke execute on function public\.get_received_sos_emergency_profile\(uuid\) from public, anon/);
assert.match(grants, /has_function_privilege\('authenticated'/);
assert.match(owner, /Impostazione salvata sul server: condivisione medica/);
assert.match(recipient, /Non è stato possibile verificare/);
assert.match(recipient, /Nessuna informazione sanitaria disponibile/);
console.log('PASS emergency profile contract, consent, recipient scope, redaction and RPC grants');
