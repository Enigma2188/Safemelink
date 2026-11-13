# Phase 17E — local ACL correction, not execution approval

## Evidence and cause

Tiziano reported the first PostgreSQL DDL test reached the final assertions and failed on `network_history_invalidate_review_v2`. Actual postgres defaults grant EXECUTE to postgres/anon/authenticated/service_role, and table privileges `arwdDxtm` to those roles. `m` is PostgreSQL 17 MAINTAIN.

The 03/11 migration omitted service_role from both REVOKE ALL statements. Later selective GRANTs do not remove inherited privileges. The local independent ACL model reproduces seven function mismatches and seven table mismatches before correction. The 07/11 and 08/11 source migrations already reset all four roles correctly and are unchanged.

## Changes

- 03/11 source: add service_role to the table and function REVOKE ALL statements only. Existing GRANTs unchanged.
- DDL generator: retain all effective privilege checks, additionally deny MAINTAIN, unexpected ACL grantees and nonowner grant options. Existing column ACL checks retained.
- Scoped generator and manifest: update source/base digest pins; add explicit 17E review output. Trigger evidence, watcher digests and exact approved empty search_path checks unchanged.
- Regenerate Phase 17, 17C and 17D canonical artifacts to match their generators; deliver the separate `scripts/phase17e-network-v2-ddl-rollback.sql` review artifact.
- Update the territorial structural test to require the complete REVOKE; add independent exact-default ACL model and negative regressions.

### Intended matrix (owner rights retained)

- 30 functions: authenticated EXECUTE on 13 designated client RPCs, service_role EXECUTE on five designated service functions. Other 12 functions have neither grant; anon/PUBLIC have none.
- 17 tables: service_role CRUD on seven territorial tables; SELECT/INSERT/UPDATE on event policies, event members and social policies; none on the remaining seven. No anon/authenticated table privileges.
- No nonowner TRUNCATE, REFERENCES, TRIGGER, MAINTAIN or grant options.
- No changes to global default ACL, legacy objects, application code or moderation/privacy policy.

## Local checks

- Exact reported defaults, ordinary PostgreSQL PUBLIC function defaults, independent expected matrix, and negative removal of the fix.
- Full package equality, one BEGIN/final ROLLBACK, no COMMIT and three UNCONFIRMED acknowledgements.
- Existing DDL, trigger-scope, territorial, event and social checks.

These are static/model tests only. No SQL was executed in this phase. PostgreSQL parsing, actual role inheritance, live catalog ACL and trigger fingerprint comparisons remain unverified for the corrected package.

## Review artifact

`scripts/phase17e-network-v2-ddl-rollback.sql`

SHA-256: `8479088f0a8469051aa15b4cb9a21c0fb911b9bea2bd9b3a2411b72406d82c07`

The artifact preserves BEGIN, bounded timeouts, all execution/service-health/deployment acknowledgements as UNCONFIRMED, exact trigger guards before and after DDL, and mandatory final ROLLBACK. Hashes are not proof of project identity or permission to execute.

## Preservation and next authorization

Pre-edit snapshot of seven affected existing preparation files (copies verified):
`C:\Users\FISA\Desktop\SAFEMELINK_BACKUPS\NETWORK2_Phase17E_before_ACL_2026-11-08T20-20-47-046Z`

Previous Phase14B/Phase17 backups remain untouched. Only the two intended source ACL lines and related generation/assertion/tests/documentation are changed here. No commit or push.

Before any separately authorized test: confirm the failed earlier session has been rolled back and no V2 objects were committed; confirm Development identity, service health, quiet deployment window and required external-effect checks. Do not remove existing objects or bypass collision guards to make the test run. Review the corrected artifact, then obtain new explicit authorization. This preparation grants no GO for immediate execution.
