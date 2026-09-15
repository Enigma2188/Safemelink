const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(process.cwd(), 'supabase', 'migrations', '20260907120000_network_backend_phase1.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');
const runtimeMigration = fs.readFileSync(path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260912120000_network_runtime_radius_5km.sql',
), 'utf8');
const runtimeFix = fs.readFileSync(path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260913120000_neighborhood_and_network_runtime_fixes.sql',
), 'utf8');
const feedRuntimeFix = fs.readFileSync(path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260913130000_network_feed_runtime_fix.sql',
), 'utf8');
const expirySchedule = fs.readFileSync(path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260914121000_network_report_expiry_schedule.sql',
), 'utf8');
const launchEligibility = fs.readFileSync(path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260914122000_network_launch_eligibility.sql',
), 'utf8');
const feedFunction = sql.match(
  /create or replace function public\.list_nearby_network_reports\([\s\S]*?\n\$\$;/i,
)?.[0] ?? '';
const detailFunction = sql.match(
  /create or replace function public\.get_network_report\([\s\S]*?\n\$\$;/i,
)?.[0] ?? '';
const contentReportFunction = sql.match(
  /create or replace function public\.report_network_content\([\s\S]*?\n\$\$;/i,
)?.[0] ?? '';
const checks = [
  ['launch eligibility requires identity and phone presence but not Phone OTP',
    /profile\.first_name[\s\S]*profile\.last_name[\s\S]*profile\.nickname[\s\S]*profile\.phone/i.test(launchEligibility)
      && !/join public\.account_verifications/i.test(
        launchEligibility.match(/create or replace function public\.network_user_is_eligible[\s\S]*?\n\$\$;/i)?.[0] ?? '',
      )],
  ['expired reports are scheduled and excluded from duplicate detection',
    /cron\.schedule\([\s\S]*safemelink-expire-network-reports[\s\S]*\*\/5 \* \* \* \*[\s\S]*expire_network_reports\(\)/i.test(expirySchedule)
      && /r\.status = 'ACTIVE' and r\.expires_at > now\(\)/i.test(expirySchedule)],
  ['feed visibility grants avoid report-id ambiguity',
    /insert into public\.network_report_visibility_grants as visibility_grant/i.test(feedRuntimeFix)
      && /on conflict on constraint network_report_visibility_grants_pkey/i.test(feedRuntimeFix)
      && /returning visibility_grant\.report_id/i.test(feedRuntimeFix)
      && !/on conflict \(user_id, report_id\)/i.test(feedRuntimeFix)
      && !/returning\s+report_id/i.test(feedRuntimeFix)],
  ['feed replacement preserves signature and authenticated-only grant',
    /create or replace function public\.list_nearby_network_reports\([\s\S]*?viewer_latitude double precision[\s\S]*?requested_page_size integer default null/i.test(feedRuntimeFix)
      && /security definer set search_path = public, extensions, pg_temp/i.test(feedRuntimeFix)
      && /revoke all on function public\.list_nearby_network_reports\(double precision, double precision, integer, integer, timestamptz, uuid, integer\) from public, anon;/i.test(feedRuntimeFix)
      && /grant execute on function public\.list_nearby_network_reports\(double precision, double precision, integer, integer, timestamptz, uuid, integer\) to authenticated;/i.test(feedRuntimeFix)],
  ['report rate limits qualify created-at against their table aliases',
    /from public\.network_reports as hourly_report where hourly_report\.author_user_id = actor and hourly_report\.created_at >=/i.test(runtimeFix)
      && /from public\.network_reports as daily_report where daily_report\.author_user_id = actor and daily_report\.created_at >=/i.test(runtimeFix)
      && !/from public\.network_reports where author_user_id = actor and created_at >=/i.test(runtimeFix)],
  ['five kilometre runtime default',
    /default_feed_radius_meters = 5000/i.test(runtimeMigration)
      && /max_feed_radius_meters = 5000/i.test(runtimeMigration)
      && /where feed_radius_meters = 1000/i.test(runtimeMigration)],
  ['authenticated onboarding runtime RPC',
    /create or replace function public\.get_my_network_onboarding_status\(\)/i.test(runtimeMigration)
      && /security definer/i.test(runtimeMigration)
      && /set search_path = public, auth, pg_temp/i.test(runtimeMigration)
      && /grant execute on function public\.get_my_network_onboarding_status\(\) to authenticated/i.test(runtimeMigration)],
  ['PostGIS geography', /create extension if not exists postgis[\s\S]*geography\(Point, 4326\)/i],
  ['domain tables', /create table public\.network_reports[\s\S]*create table public\.network_report_confirmations[\s\S]*create table public\.network_report_updates[\s\S]*create table public\.network_content_reports/i],
  ['authoritative phone verification', /account_verifications[\s\S]*phone_verified_at[\s\S]*network_user_is_eligible/i],
  ['server TTL config', /network_category_config[\s\S]*interval '3 hours'[\s\S]*interval '24 hours'/i],
  ['client cannot choose protected fields', /create_network_report\([\s\S]*target_category[\s\S]*target_description[\s\S]*target_latitude[\s\S]*target_longitude[\s\S]*target_accuracy/i],
  ['precise location omitted from feed output',
    /distance_bucket_meters integer/i.test(feedFunction)
      && !/distance_meters_rounded|report\.location|r\.location|public_cell_id\s+(?:text|varchar)/i.test(feedFunction)],
  ['feed derives public geography only from coarse cells',
    /st_distance\(r\.public_location, public_center\)/i.test(feedFunction)
      && /st_dwithin\(r\.public_location, public_center, selected_radius\)/i.test(feedFunction)
      && !/st_distance\s*\(\s*r\.location|st_dwithin\s*\(\s*r\.location/i.test(feedFunction)],
  ['coarse public geography is materialized and spatially indexed',
    /public_location extensions\.geography\(Point, 4326\) not null/i.test(sql)
      && /network_reports_public_location_idx on public\.network_reports using gist \(public_location\)/i.test(sql)
      && /report_public_location := public\.network_public_cell_center\(report_public_cell_id, cfg\.public_cell_size_meters\)/i.test(sql)],
  ['feed cursor exposes the actual created-at sort key',
    /cursor_status_bucket integer default null[\s\S]*cursor_created_at timestamptz default null[\s\S]*cursor_report_id uuid default null/i.test(feedFunction)
      && /r\.created_at, r\.expires_at/i.test(feedFunction)],
  ['feed ordering exactly matches status, created-at and id',
    /order by case when r\.status = 'ACTIVE' then 0 else 1 end,\s*r\.created_at desc, r\.id desc/i.test(feedFunction)],
  ['feed keyset exactly matches status, created-at and id',
    /case when r\.status = 'ACTIVE' then 0 else 1 end > cursor_status_bucket[\s\S]*case when r\.status = 'ACTIVE' then 0 else 1 end = cursor_status_bucket\s*and r\.created_at < cursor_created_at[\s\S]*case when r\.status = 'ACTIVE' then 0 else 1 end = cursor_status_bucket\s*and r\.created_at = cursor_created_at and r\.id < cursor_report_id/i.test(feedFunction)],
  ['feed pagination never uses resolved-at as a sort key',
    !/coalesce\s*\(\s*r\.resolved_at\s*,\s*r\.created_at\s*\)/i.test(feedFunction)
      && !/order by[\s\S]*r\.resolved_at/i.test(feedFunction)],
  ['self confirmation blocked', /Authors cannot confirm their own report/i],
  ['one current confirmation', /primary key \(report_id, user_id\)/i],
  ['no automatic resolution from responses', /respond_to_network_report[\s\S]*no_longer_present_count[\s\S]*add_network_report_update/i],
  ['author-only updates', /target\.author_user_id <> actor/i],
  ['expiry independent of cron', /r\.expires_at > now\(\)[\s\S]*expire_network_reports/i],
  ['direct table access revoked', /revoke all on table public\.network_config[\s\S]*from public, anon, authenticated/i],
  ['safe definer search paths', /security definer set search_path = public, (?:extensions, )?(?:auth, )?pg_temp/gi],
  ['rate limits and duplicate guard', /create_limit_hour[\s\S]*create_limit_day[\s\S]*duplicate_window[\s\S]*st_dwithin/i],
  ['content report throttling', /content_report_limit_hour[\s\S]*Content reporting rate limit reached/i],
  ['read-only restrictions block writes but permit reads', /requested_action in \('publish', 'interact'\) and r\.restriction_type = 'READ_ONLY'/i],
  ['content reporting requires eligibility', /report_network_content\([\s\S]*not public\.network_user_is_eligible\(actor\)[\s\S]*Content reporting rate limit reached/i],
  ['report detail requires a recent server-issued visibility grant',
    /get_network_report\(\s*target_report_id uuid\s*\)/i.test(detailFunction)
      && /network_report_visibility_grants[\s\S]*g\.user_id = actor[\s\S]*g\.expires_at > now\(\)/i.test(detailFunction)
      && !/viewer_latitude|viewer_longitude|radius_meters|st_dwithin/i.test(detailFunction)],
  ['five kilometer product maximum', /max_feed_radius_meters integer not null default 5000 check \(max_feed_radius_meters between default_feed_radius_meters and 5000\)/i],
  ['resolved visibility is sixty minutes', /resolved_visibility interval not null default interval '60 minutes'/i],
  ['recent resolved feed entries only', /r\.status = 'RESOLVED' and r\.resolved_at > now\(\) - cfg\.resolved_visibility/i],
  ['active reports precede resolved reports', /order by case when r\.status = 'ACTIVE' then 0 else 1 end/i],
  ['confirmation action ledger', /create table public\.network_rate_limit_events[\s\S]*action public\.network_rate_limit_action[\s\S]*NETWORK_CONFIRMATION_RATE_LIMIT/i],
  ['identical confirmation is idempotent', /kind = target_kind\) then return;/i],
  ['confirmation change consumes rate limit', /insert into public\.network_rate_limit_events \(user_id, action\) values \(actor, 'CONFIRMATION'\)[\s\S]*insert into public\.network_report_confirmations/i],
  ['explicit null validation', /target_category is null or target_description is null or target_latitude is null or target_longitude is null[\s\S]*viewer_latitude is null or viewer_longitude is null/i],
  ['content target visibility requires the same server-issued grant',
    /network_report_visibility_grants[\s\S]*g\.user_id = actor[\s\S]*g\.report_id = target\.id[\s\S]*g\.expires_at > now\(\)[\s\S]*NETWORK_CONTENT_NOT_VISIBLE/i.test(contentReportFunction)
      && !/viewer_latitude|viewer_longitude|radius_meters|st_dwithin/i.test(contentReportFunction)],
  ['self content reporting blocked', /NETWORK_SELF_REPORT_NOT_ALLOWED/i],
  ['read-only can report abusive content', /network_user_is_restricted\(actor, 'content_report'\)/i],
  ['full block applies to every action', /r\.restriction_type = 'FULL_NETWORK_BLOCKED'/i],
  ['resolve is idempotent', /if current_status = 'RESOLVED' then return;/i],
  ['moderation hiding has timestamp integrity', /status = 'HIDDEN' or moderation_state = 'HIDDEN'\) = \(hidden_at is not null\)/i],
  ['geographic reads are rate limited with an account lock',
    /network-feed-read:[\s\S]*action = 'FEED_READ'[\s\S]*NETWORK_FEED_RATE_LIMIT[\s\S]*values \(actor, 'FEED_READ'\)/i.test(feedFunction)],
  ['visibility grants are private, expiring and feed-issued',
    /create table public\.network_report_visibility_grants[\s\S]*expires_at timestamptz not null[\s\S]*primary key \(user_id, report_id\)/i.test(sql)
      && /insert into public\.network_report_visibility_grants/i.test(feedFunction)
      && /public\.network_report_visibility_grants[\s\S]*from public, anon, authenticated/i.test(sql)],
  ['detail and content RPC signatures expose no spatial probe inputs',
    /revoke all on function public\.get_network_report\(uuid\)/i.test(sql)
      && /grant execute on function public\.get_network_report\(uuid\) to authenticated/i.test(sql)
      && /revoke all on function public\.report_network_content\(uuid, uuid, public\.network_content_report_reason, text\)/i.test(sql)
      && /grant execute on function public\.report_network_content\(uuid, uuid, public\.network_content_report_reason, text\) to authenticated/i.test(sql)],
];

let failed = false;
for (const [name, check] of checks) {
  const ok = typeof check === 'boolean' ? check : check.test(sql);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  failed ||= !ok;
}

const mutatesExistingSafetyDomain = /alter table public\.(sos|nearby_alerts|radar_presence|sos_network_presence)\b/i.test(sql);
console.log(`${mutatesExistingSafetyDomain ? 'FAIL' : 'PASS'} no SOS schema mutation`);
failed ||= mutatesExistingSafetyDomain;

const definerCount = (sql.match(/security definer/gi) || []).length;
const safePathCount = (sql.match(/security definer set search_path = public, (?:extensions, )?(?:auth, )?pg_temp/gi) || []).length;
if (definerCount !== safePathCount) {
  console.log(`FAIL safe search_path coverage (${safePathCount}/${definerCount})`);
  failed = true;
} else {
  console.log(`PASS safe search_path coverage (${safePathCount}/${definerCount})`);
}

if (failed) process.exit(1);
console.log('All NETWORK backend Phase 1 static checks passed.');
