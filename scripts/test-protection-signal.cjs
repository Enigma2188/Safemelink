const fs = require('node:fs');
const assert = require('node:assert/strict');

const migration = fs.readFileSync('supabase/migrations/20260923120000_protection_signals.sql', 'utf8');
const retirement = fs.readFileSync('supabase/migrations/20261123120000_retire_protection_signals.sql', 'utf8');
const home = fs.readFileSync('components/HomeQuickActions.tsx', 'utf8');
const layout = fs.readFileSync('app/_layout.tsx', 'utf8');

assert.match(migration, /enable row level security/);
assert.match(migration, /revoke all on table public\.protection_signals/);
for (const signature of [
  'create_protection_signal\\(text,text,text,text,text,text,text,text,uuid\\)',
  'get_protection_area_alert\\(text,text\\)',
  'list_protection_area_alerts\\(text\\)',
]) {
  assert.match(retirement, new RegExp(`revoke all on function public\\.${signature}\\s+from public, anon, authenticated`, 'i'));
}
assert.doesNotMatch(retirement, /drop table|delete from|truncate|drop function|sos_/i);
for (const file of [
  'app/protection-signal.tsx',
  'services/ProtectionSignalService.ts',
  'services/ProtectionSignalTrustedContactService.ts',
]) assert.equal(fs.existsSync(file), false, `${file} must not be bundled`);
assert.doesNotMatch(home, /Segnale Tutela|Qualcosa non va|\/protection-signal/);
assert.doesNotMatch(layout, /protection-signal/);

console.log('Protection signal retired from the app; historical migration and RLS preserved.');
