# KVNX Vault Development Testing

## Purpose

Sprint 11.1 provides a staging-only test clock so developers can exercise
daily rollover, mission completion, replacement, overall XP, skill XP,
achievements, countdowns, and future time-dependent systems without waiting for
real calendar time. It never changes PostgreSQL time and never grants progress
directly.

Use a separate Supabase staging project. Do not enable these tools in the KVNX
Vault production database.

## Security Gates

Tooling activates only when all of these conditions are true:

1. The staging frontend build has `devToolsEnabled: true`.
2. The current hostname exactly matches a value in `devToolsAllowedHosts`.
3. The database `dev_environment_config` row is enabled by a database admin.
4. The authenticated user's UUID is enabled in `dev_test_accounts` by a
   database admin.

The first two conditions control UI loading. The last two independently control
every server mutation. Changing JavaScript cannot bypass the database gates.
Known production domains are rejected by the frontend loader even if included
in a modified allowlist.

## Staging Setup

1. Create or select a separate Supabase staging project.
2. Install migrations 001–009, 011, and then 012 in filename order. There is no
   migration 010.
3. Create a normal authenticated staging test account through the application.
4. In the staging Supabase SQL editor, resolve that account UUID and enable only
   the staging environment and chosen account:

```sql
update public.dev_environment_config
set enabled = true,
    updated_at = timezone('utc', now())
where singleton = true;

insert into public.dev_test_accounts (user_id, enabled)
values ('REPLACE_WITH_STAGING_TEST_USER_UUID', true)
on conflict (user_id) do update set enabled = excluded.enabled;
```

5. In the staging-only frontend build, set:

```js
devToolsEnabled: true,
devToolsAllowedHosts: Object.freeze(["YOUR-EXACT-STAGING-HOST"]),
```

Never add a production KVNX domain to that list. Never place a service-role key
or database secret in the frontend.

## Developer Workflow

### Day 1

1. Sign in as the allowlisted staging test user.
2. Confirm the panel says `TEST ENVIRONMENT ONLY` and shows the current test
   time.
3. Request or refresh the authoritative daily mission.
4. Complete the mission through the normal mission control.
5. Verify exactly +25 overall XP, +15 mapped skill XP, and any legitimate
   achievement notifications.
6. Prepare the one server-selected replacement.
7. Complete it and verify Daily Complete.

### Advance to Day 2

1. Select **Advance To Next Day**.
2. The server moves only this user's simulated clock one second beyond the next
   timezone-aware reset and the page restores.
3. `request_daily_mission()` runs the normal clock-aware daily engine.
4. Verify stale ready/active missions expire if applicable, a new server UUID
   mission appears, countdown state reconciles, and the replacement allowance
   is reset for the new authoritative day.
5. Complete Day 2 normally and verify progression continues from persisted
   totals.

**Advance 1 Hour** moves only the current user's simulated clock. **Clear Test
Clock** removes that user's clock row and restores real database time. No test
account reset is provided because direct progress deletion would add
unnecessary risk.

## Disable and Verify Production

To disable staging tools immediately:

```sql
update public.dev_environment_config
set enabled = false,
    updated_at = timezone('utc', now())
where singleton = true;
```

Production verification checklist:

- `js/config.js` has `devToolsEnabled: false`.
- No production hostname appears in `devToolsAllowedHosts`.
- The panel is absent from the DOM and development assets are not loaded.
- Calling any `dev_*` RPC as an authenticated production user returns an
  authorization failure.
- `dev_environment_config.enabled` is false if migration 012 was accidentally
  installed.
- `dev_test_accounts` contains no production account if migration 012 was
  accidentally installed.
- Normal daily missions, completion, replacement, countdown, skills, and
  achievements continue using real database time.

## Production Guarantee

Production users cannot advance time, choose another user, create missions,
reset accounts, grant XP, grant skill XP, unlock achievements, or change the
replacement limit. The only development mutations advance or clear the
current allowlisted staging user's isolated test clock. All product progress
still comes from the existing authoritative mission flow.

## Sprint 14 Seven-Day Streak Verification

Install migration 015 on the separate staging project after migration 014.
Keep every existing server and hostname gate above intact.

1. Sign in as an allowlisted staging account and clear its test clock.
2. Complete the Day 1 authoritative mission. Verify current and longest are 1.
3. If testing replacement idempotency, request and complete the one replacement
   on Day 1. Verify current and longest remain 1.
4. Select **Advance To Next Day**, restore the normal server mission, and
   complete it. Verify Day 2 reports current 2.
5. Repeat once for Day 3. Verify current 3 and one persisted Three-Day Streak
   notification/unlock.
6. Continue the same advance, restore, complete sequence through Day 7. Verify
   current 7, longest 7, and one Seven-Day Streak notification/unlock.
7. Refresh, then sign out and back in. Verify the same streak and achievements
   restore through their zero-argument RPCs.

For gap behavior, use a fresh approved staging account or advance a tested
account beyond its latest completed day: complete one day, select **Advance To
Next Day** twice without completing the intervening day, then complete the new
mission. Current must reset to 1 and longest must retain the earlier maximum.

For concurrency, issue two simultaneous `complete` requests for the same
active mission from separate clients. Exactly one must return accepted and
award 25 overall XP, 15 mapped skill XP, one history row, one streak-day
evaluation, and eligible achievements. The other must be a terminal duplicate
rejection. Confirm direct authenticated insert/update/delete against
`user_streak_state` fails and `get_vault_streak` accepts no parameters.

## Sprint 15 Mission Variety Verification

After migration 016 is installed on the separate staging project:

1. Use an allowlisted account whose saved primary focus is one of the canonical
   onboarding values.
2. Clear its test clock and request the normal daily mission. Record the title,
   template key from the RPC response, mapped skill, and logical day.
3. Refresh and sign out/in. Confirm the exact saved mission instance returns;
   neither action may reroll it.
4. Complete it and confirm exactly 25 overall XP and 15 XP for the returned
   canonical skill.
5. Request the one replacement. Confirm its template differs from the first,
   its instance UUID is new, and XP, achievements, and streak state do not
   change until completion.
6. Complete the replacement. Confirm the normal rewards apply and the streak
   remains one day for that logical key.
7. Select **Advance To Next Day**, then request through the normal dashboard.
   Confirm the new mission comes from the same catalog path and avoids recent
   templates while alternatives exist.
8. Repeat across several logical days, checking that refresh restoration,
   Daily Complete, countdown, Vault History, Analytics, achievements, and
   streak milestones remain intact.
9. Attempt authenticated insert/update/delete against `mission_catalog`; every
   write must fail. Confirm the public daily and replacement RPCs accept no
   content, focus, template, skill, reward, user, date, or timezone arguments.

For concurrency, issue two simultaneous `request_daily_mission()` calls for a
new logical day. Both responses must resolve to the same saved mission instance.
For replacement concurrency, issue two requests against one terminal mission;
exactly one may consume the daily replacement allowance.

## Sprint 19 Daily Mission Choice Verification

Install Migration 018 on the separate staging project after Migration 017.
Keep the environment, account allowlist, hostname, and production-domain gates
unchanged.

1. Use an allowlisted staging account and select **Advance To Next Day**.
2. Restore through the normal Dashboard. Confirm one to three server-provided
   choices appear; the standard catalog currently provides three per focus.
3. Record each title and opaque choice ID from the RPC response. Refresh,
   navigate across every center, and sign out/in. Confirm the same IDs and copy
   return in the same order.
4. Choose one option from Dashboard. Confirm one ready authoritative mission is
   restored in both Dashboard and Mission Center.
5. Confirm choice selection changes no XP, skill XP, streak, achievements,
   history, Analytics, or replacement allowance.
6. Refresh and sign out/in. Confirm the same mission instance restores and the
   unselected choices are no longer actionable.
7. Complete the selected mission. Confirm exactly 25 overall XP, 15 mapped skill
   XP, normal history, achievements, streak, and Daily Complete behavior.
8. Complete or skip it, request the one existing replacement, and confirm the
   replacement remains server-selected and limited to one.
9. Advance to the next logical day and confirm a new stable choice row is
   produced through the same normal path. Repeat across multiple days to verify
   recent-template variety.

For concurrency, issue two different `select_daily_mission_choice` calls at the
same instant. Exactly one option becomes the mission; the losing request must
restore/reject against that winner and must not switch it. Repeat the winning
choice ID to confirm idempotent restoration. Attempt arbitrary, another-owner,
and previous-day IDs; all must fail offered membership. Direct authenticated
insert/update/delete against `daily_mission_choice_state` must fail.

On production, do not advance or mutate time. Wait for a natural new logical
day, verify the normal stable choice flow, and leave all developer gates closed.

## Sprint 20 Skill Path Verification

Install Migration 019 after Migration 018, without changing developer-clock
gates or advancing production time.

1. Sign in with an account whose onboarding focus is Programming and record
   overall XP, skill XP, streak, achievements, history count, current mission,
   and the current Sprint 19 mission/choice identity.
2. Open `dashboard.html#skills`, activate Fitness, and confirm it displays
   **Developing**, 0 XP if untouched, and no expandable progression/history.
3. Refresh `#skills` and sign out/in. Confirm the protected restoration gate
   appears first and Fitness remains Developing.
4. Repeat activation. Confirm there is still one owner/Fitness row and no
   duplicate or state change.
5. Confirm every value recorded in step 1 is unchanged, especially today's
   persisted Sprint 19 choice set or mission instance.
6. Pause Fitness. Confirm its path state changes, while any lifetime Fitness XP
   and Vault records remain unchanged. Repeat pause to confirm idempotency.
7. Activate a positive-XP skill, then pause it. Confirm its lifetime level,
   total XP, progress, recent gains, and disclosure remain available throughout.
8. Attempt a noncanonical key, an inactive catalog key, unauthenticated calls,
   and direct insert/update/delete on `user_skill_paths`; each must fail.
9. Issue simultaneous activate/deactivate requests for the same skill. Confirm
   mutations serialize and the final authoritative row is internally consistent.

Production verification requires no clock operation. The pending Sprint 15 and
Sprint 19 natural-new-day checks remain deferred until the next real logical-day
rollover and should be performed separately from Skill Path state testing.

## Sprint 21 Skill Path Mission Offer Verification

Install Migration 020 after Migration 019. Use the normal staging gates and an
allowlisted account; do not weaken the production-domain block.

1. Activate Fitness and one other canonical path through Skill Center. Record
   overall XP, all skill XP, streak, achievements, history/Analytics counts,
   today's primary mission or choice, replacement allowance, and Daily Complete
   state.
2. Choose **Explore Missions** for Fitness. Confirm zero to three offers appear
   (the installed catalog normally provides three), all build Fitness, and no
   reward or mission-lifecycle action is shown.
3. Refresh `#skills`, navigate across every center, and sign out/in. Confirm the
   same opaque IDs and offer order restore behind the protected loading gate.
4. Select one offer. Confirm it becomes **Planned** and that a different offer
   cannot replace it. Repeat the winning ID through the RPC to confirm
   idempotent restoration.
5. Confirm every value recorded in step 1 is unchanged. In particular, no
   mission/history row exists for the offer, today's Sprint 19 primary state is
   unchanged, and no progression or notification occurs.
6. Pause the path. Confirm its current offer state is no longer restored and a
   stale selection is rejected. Reactivate it on the same logical day and
   confirm the persisted set restores rather than rerolls.
7. Attempt an arbitrary UUID, another owner's ID, a noncanonical/inactive skill,
   an inactive path, and direct table writes. Each must be rejected.
8. Issue simultaneous offer requests for one owner/day/skill; both must restore
   the same row. Issue simultaneous conflicting selections; exactly one planned
   item may win.
9. On approved staging only, advance one logical day. Confirm requesting the
   same active path produces the next day's normal stable set and prefers unused
   or least-recently-used authoritative templates.

Production verification uses natural time only. Install the migration, deploy
the frontend, verify same-day restoration and zero side effects, then wait for a
natural logical-day rollover for the new-day stability/variety check. Do not
alter production time. Sprint 15 and Sprint 19 pending natural-new-day checks
remain separate acceptance items.

## Sprint 21.1 Emergency Effective-Clock Verification

Migration 021 is required on production before further Sprint 21 verification.
Do not install Migration 012 and do not modify production time.

1. Apply
   `supabase/migrations/202608070021_sprint21_1_effective_clock_compatibility.sql`.
2. Confirm the exact zero-argument signature exists:

   ```sql
   select pg_catalog.to_regprocedure('public.dev_effective_vault_now()');
   ```

3. As the database administrator, compare the helper with real database time:

   ```sql
   select
     public.dev_effective_vault_now() as effective_now,
     pg_catalog.clock_timestamp() as database_now,
     abs(extract(epoch from (
       public.dev_effective_vault_now() - pg_catalog.clock_timestamp()
     ))) < 5 as approximately_current;
   ```

4. Confirm the production fallback created no developer tables:

   ```sql
   select pg_catalog.to_regclass('public.dev_environment_config'),
          pg_catalog.to_regclass('public.dev_test_accounts'),
          pg_catalog.to_regclass('public.dev_test_state');
   ```

   All three values must remain null on production.
5. Confirm `anon` and `authenticated` have no direct execution privilege:

   ```sql
   select
     has_function_privilege('anon', 'public.dev_effective_vault_now()', 'EXECUTE'),
     has_function_privilege('authenticated', 'public.dev_effective_vault_now()', 'EXECUTE');
   ```

   Both values must be false.
6. Hard-refresh production KVNX Vault and confirm protected restoration succeeds.
7. Open `#skills`, request Skill Path offers, refresh, and verify stable restore.
8. Confirm Daily Mission state, replacement, XP, skill XP, streak, achievements,
   Vault, Analytics, and Daily Complete are unchanged by this hotfix.
9. Keep production time untouched. At the natural next logical-day rollover,
   perform the pending Sprint 15 and Sprint 19 verification.

On staging, apply Migration 021 and confirm Migration 012's simulated-clock
behavior still works for an approved account. Because the helper already exists,
Migration 021 must not replace its definition or create a second clock path.

## Sprint 22 Side Mission Verification

1. Apply Migration 022 after Migration 021. Record primary mission/choice,
   replacement, Daily Complete, streak, overall XP, skill XP, history, and
   Analytics.
2. In Skill Center, activate a path, restore offers, select one practice, and
   choose **Make Side Mission**. Confirm the separate slot is Planned and all
   recorded progression values are unchanged.
3. Start it. Confirm only its lifecycle becomes In Progress and no completion
   history exists.
4. Complete it. Confirm exactly +10 overall XP, +10 mapped skill XP, one Side
   Vault entry, and one Side completion in Analytics. Confirm the Daily Mission,
   replacement, Daily Complete, and daily streak are unchanged.
5. Retry completion, refresh, sign out/in, and repeat from a second tab. Confirm
   no second reward or history row. Race two different planned-path promotions;
   only one owner/day slot may win.
6. Pause the source path after promotion and confirm the committed mission can
   finish. Confirm a paused path cannot create a new slot.
7. On approved staging only, leave a Side Mission incomplete, advance one
   logical day, and confirm it is expired and cannot reward. Confirm the new day
   restores one new account-wide capacity through Migration 012's existing
   simulated clock.
8. On production, never change time. Migration 021 continues to provide real
   database time. Perform new-day expiration/cap verification only at a natural
   logical-day rollover.

Threat tests must include arbitrary/other-owner offer IDs, malformed content,
reward/skill/date/time tampering, unauthenticated calls, direct table writes,
concurrent completion, and API replay. No live verification is claimed by the
code package.

## Sprint 23 Side Mission Operational Verification

Migration 023 is database-only. Before applying it, back up production and run
these read-only duplicate preflight checks; both must return zero rows:

```sql
select user_id, daily_session_id, count(*)
from public.mission_history
where mission_type = 'side' and final_state = 'completed'
group by user_id, daily_session_id
having count(*) > 1;

select user_id, mission_id, count(*)
from public.mission_history
where mission_type = 'side' and final_state = 'completed'
group by user_id, mission_id
having count(*) > 1;
```

After applying Migration 023, the administrator-only invariant report must
return zero rows:

```sql
select * from public.audit_side_mission_invariants();
```

Use these SQL-editor diagnostics for founder-level aggregate visibility. They
require database-administrator access and are never exposed to the browser:

```sql
select event_type, count(*) as events
from public.side_mission_event_ledger
group by event_type
order by event_type;

select
  count(*) as side_completions,
  sum(xp_awarded) as overall_xp_awarded,
  sum(skill_xp_awarded) as skill_xp_awarded
from public.mission_history
where mission_type = 'side' and final_state = 'completed';

select skill_key, count(*) as completions,
       sum(skill_xp_awarded) as skill_xp_awarded
from public.mission_history
where mission_type = 'side' and final_state = 'completed'
group by skill_key
order by skill_xp_awarded desc, skill_key;
```

For the already completed production `Restore Mobility` record, verify
read-only that there is one `side_mission_state`, one exact +10/+10 Side
`mission_history` row, and one each of the reconciled `promoted`, `started`, and
`completed` events. Confirm Analytics still separates Daily and Side counts,
the primary mission and Daily Complete remain unchanged, and the streak did not
move. Do not reset capacity, recreate a mission, or modify production time.

On approved staging, use only Migration 012's existing guarded clock controls:

1. Race two promotions; exactly one owner/day state and one promoted event win.
2. Race two starts; exactly one started event exists and no reward changes.
3. Race two completions; exactly one +10/+10 award, Side history row, and
   completed event exist.
4. Retry completion, refresh, and sign out/in; no counts or rewards change.
5. Leave a mission incomplete, advance one approved logical day, and restore;
   exactly one expired event appears.
6. Confirm the new logical day has one fresh capacity and the prior mission
   cannot reward.
7. Confirm paused-path, Daily Mission, replacement, Daily Complete, streak,
   achievement, and Daily/Side Analytics semantics remain unchanged.

Rejected/idempotent request counts are intentionally not written to the event
ledger. Use bounded PostgREST/database logs when diagnosing those requests so a
browser cannot manufacture durable telemetry volume.

## Sprint 24 Operational Monitoring Procedure

Migration 024 has no frontend deployment requirement. Back up production,
verify Migration 023 is installed, apply Migration 024, and execute checks only
from the database administrator/owner context.

Run one scan:

```sql
select public.run_vault_operational_monitoring();
```

A clean response has `healthy: true`, `healthState: "healthy"`, zero invariant
and anomaly counts, and an empty findings array. Any finding contains category,
severity, source, optional affected references, and structured details. The
function detects and records only; it performs no repair.

Read the operator summary:

```sql
select public.get_vault_operational_health();
```

Inspect protected detail as database administrator when necessary:

```sql
select alert_type, severity, source, status, occurrence_count,
       first_detected_at, last_detected_at,
       affected_user_id, daily_key, mission_id, details
from public.vault_operational_alerts
order by status, severity, last_detected_at desc;
```

Before responding to an incident, rerun the scan and compare the protected
finding with authoritative state/history. Sprint 24 never repairs data. Back up
and investigate before any separately reviewed remediation.

Retention defaults to 180 days and a 1000-row batch:

```sql
select public.prune_vault_operational_data();
```

Or use bounded administrator-selected controls:

```sql
select public.prune_vault_operational_data(365, 1000);
```

The response explicitly reports removed monitoring runs/findings/resolved
alerts and zero removals for Side events, mission history/state, and
progression. Run it repeatedly when more than one batch is eligible. Empty
cleanup is successful and returns zero counts.

No database scheduler is assumed or installed. Production automation may later
use an externally managed database-owner schedule—for example, monitoring every
15 minutes and bounded retention daily—but must call these exact revoked
functions under approved administrator credentials. Never expose them through
the browser or grant them to `authenticated`.

Staging verification should create representative corrupt fixtures only in the
isolated staging database: reward mismatch, missing Side history, inverted
event time, Daily reward mismatch, and progression divergence. Confirm alerts
deduplicate across concurrent/repeated scans, resolve after fixture repair, and
that XP, skill XP, history, mission state, Daily Complete, replacements, streak,
and achievements remain unchanged. Do not corrupt production to test alerts.

If Migration 024 must be rolled back before production acceptance, remove only
its four functions and three operational tables after backing up operational
records. Do not touch migrations or objects from 001–023. Once accepted, use a
new forward migration instead of editing 024.
