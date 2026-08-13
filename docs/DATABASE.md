# KVNX Vault Database

Version: Sprint 23

The authoritative schema and policies live in:

- `supabase/migrations/202608070001_sprint7_foundation.sql`
- `supabase/migrations/202608070002_sprint7_1_security_correction.sql`
- `supabase/migrations/202608070003_sprint7_2_prototype_persistence.sql`
- `supabase/migrations/202608070004_sprint7_2_replacement_persistence.sql`
- `supabase/migrations/202608070005_sprint8_server_authority.sql`
- `supabase/migrations/202608070006_sprint9_daily_mission_authority.sql`
- `supabase/migrations/202608070007_sprint9_2_daily_reset_countdown.sql`
- `supabase/migrations/202608070008_sprint10_skill_progression.sql`
- `supabase/migrations/202608070009_sprint10_1_uuid_function_hotfix.sql`
- `supabase/migrations/202608070011_sprint11_achievements.sql`
- `supabase/migrations/202608070012_sprint11_1_developer_test_panel.sql` (staging/development only)
- `supabase/migrations/202608070013_sprint12_vault_history.sql`
- `supabase/migrations/202608070014_sprint13_analytics_insights.sql`
- `supabase/migrations/202608070015_sprint14_authoritative_streaks.sql`
- `supabase/migrations/202608070016_sprint15_mission_catalog.sql`
- `supabase/migrations/202608070017_sprint18_achievement_center.sql`
- `supabase/migrations/202608070018_sprint19_daily_mission_choice.sql`
- `supabase/migrations/202608070019_sprint20_skill_paths.sql`
- `supabase/migrations/202608070020_sprint21_skill_path_mission_offers.sql`
- `supabase/migrations/202608070021_sprint21_1_effective_clock_compatibility.sql`
- `supabase/migrations/202608070022_sprint22_side_mission_lifecycle.sql`
- `supabase/migrations/202608070023_sprint23_side_mission_observability.sql`
- `supabase/migrations/202608070024_sprint24_operational_hardening.sql`

Apply production migrations in numeric order, skipping the intentional 010 gap
and staging-only Migration 012. Migration 021 supplies production's real-clock
compatibility helper without installing Migration 012's developer tables or
simulated time. Staging may include 012; Migration 021 preserves its existing
helper without replacement. Every later migration is additive and historical
migration files remain immutable.

## Tables

| Table | Authoritative state | Ownership |
|---|---|---|
| `profiles` | First name, validated IANA timezone, and account timestamps | `user_id → auth.users.id` |
| `onboarding_profiles` | Existing onboarding contract | `user_id → auth.users.id` |
| `progression_state` | Authoritative stored total XP | `user_id → auth.users.id` |
| `daily_mission_state` | Per-day definition, lifecycle state, reward status, replacement count, and logical date | `(user_id, daily_key)` with `user_id → auth.users.id` |
| `mission_history` | Terminal mission records | `user_id → auth.users.id` |
| `skill_catalog` | Fixed skill keys, names, ordering, and activation | Server managed; authenticated read |
| `skill_progression` | Lifetime XP per user and skill | `(user_id, skill_key)` with `user_id → auth.users.id` |
| `user_skill_paths` | Soft development intent per canonical skill | `(user_id, skill_key)`; owner derived by RPC from `auth.uid()` |
| `skill_path_mission_offer_state` | Stable bounded practice offers and one planned selection per owner/day/skill | Server-owned; restored by authenticated RPC |
| `side_mission_state` | One authoritative Side Mission slot per owner/logical day | `(user_id, daily_key)`; lifecycle RPCs derive `auth.uid()` |
| `side_mission_event_ledger` | Append-only authoritative Side Mission lifecycle events | Server-written trigger; no direct browser privileges |
| `vault_operational_monitoring_runs` | Administrator monitoring execution summaries | Database administrator only |
| `vault_operational_findings` | Immutable findings for one monitoring run | Database administrator only; retention-eligible |
| `vault_operational_alerts` | Deduplicated open/resolved anomaly alerts | Database administrator only; resolved records are retention-eligible |

Derived progression values—level, next threshold, remaining XP, and percentage—are not stored. `progression.js` recomputes them from `total_xp`, preserving one progression engine.

Mission definitions remain JSON because their stable domain contract already exists and future backward-compatible metadata may vary. Lifecycle state remains separate columns so constraints and restoration stay explicit.

## Repository Contract

`js/user-repository.js` is the only module that knows table names, column names, Supabase query syntax, or persistence RPCs. It exposes reads plus intent-oriented writes:

- `loadProfile()` / `saveProfile()`
- `loadOnboarding()` / `saveOnboarding()`
- `loadProgression()`
- `getSkillProgression()`
- `loadDailyMissionState()`
- `loadMissionHistory()`
- `requestDailyMission()`
- `requestDailyMissionReplacement()`
- `initializeVaultSession({ dailySessionId, definition })`
- `requestMissionAction({ missionId, action })`
- `persistValidatedPrototypeProgression({ missionId, lifecycleEvent, progressionSnapshot })`
- `persistValidatedPrototypeReplacement({ replacementEvent, coordinatorSnapshot })`

The preferred repository contract has no `saveProgression(totalXP)`, generic
mission-state setter, or client-result persistence method. Its action request
contains only mission identity and intent.

The two Sprint 9 daily requests invoke zero-argument RPCs. They never submit a
user id, date, timezone, focus, mission content, lifecycle state, replacement
count, reward, or XP. The older initializer and prototype replacement adapter
remain in source only for unchanged historical tests; migration 006 revokes
their authenticated execution.

`getSkillProgression()` invokes the zero-argument
`get_skill_progression()` RPC. PostgreSQL derives `auth.uid()`, reads the saved
timezone for today's boundary, and returns only the caller's skill totals plus
server-derived daily gains. The repository exposes no skill setter or write
method.

The Sprint 7.2 prototype adapter is deliberately narrower than a generic
result-persistence method. Only the application service calls it, and only after
an accepted completion has passed through lifecycle and progression. Its SQL
function reads and locks the existing progression and daily-mission rows,
derives the permitted reward from the saved definition, computes the next total
inside PostgreSQL, and requires the supplied immutable snapshot to match. It
also records the terminal lifecycle state so refresh cannot replay the same
prototype completion.

The replacement adapter is separate from completion persistence and accepts no
XP total, reward result, or user id. After the coordinator accepts the explicit
replacement, the application service supplies its immutable replacement event
and snapshot. PostgreSQL locks the saved daily mission, verifies that it is
terminal, verifies that its id matches the event's previous mission, and
enforces the one-replacement limit. Only then does it save the new definition,
set lifecycle state to `ready`, set `completion_awarded` to false, clear
`terminal_at`, clear `terminal_recorded`, and preserve the validated
`replacements_used` count. The function does not read or update
`progression_state`.

`persistMissionTransition(...)` remains as a deprecated test-compatibility
adapter so the unchanged Sprint 7 contract suite still runs. Corrected database
roles cannot execute its legacy RPC, application code does not select it, and it
may be removed when the historical Sprint 7 tests are retired. The Sprint 7.2
completion adapter is also retained in source for historical tests, but migration
005 revokes authenticated execution and production code never selects it.

The repository resolves the authenticated user itself. Dashboard and domain engines never supply an arbitrary user id.

## Row Level Security

RLS is enabled on every user-owned product table, including
`skill_progression`. Ownership policies are restricted to the `authenticated`
Postgres role and compare each row with:

```sql
(select auth.uid()) = user_id
```

Insert and update policies also use `with check`, preventing a signed-in user from assigning a row to another account. User ownership columns are indexed. No browser key can bypass these policies.

RLS prevents cross-user access; it does not validate whether a value submitted
for the current user's own row was legitimately earned. Sprint 7.1 therefore
revokes authenticated direct writes to `progression_state`,
`daily_mission_state`, and `mission_history`. Those tables may be mutated only
through specifically granted trusted functions.

The profile-creation trigger derives the user id from the new `auth.users` row. The transactional persistence function derives ownership only from `auth.uid()` and accepts no user-id argument.

## Deprecated Sprint 7 Transition

Sprint 7 introduced `persist_vault_transition(...)`, which accepted a browser-
provided `p_total_xp`. Although the write was atomic and user-scoped, its result
was not authoritative because the client selected the final total. Sprint 7.1
revokes authenticated execution of this function and marks it deprecated. It is
retained only so the correction migration can be applied safely to an existing
Sprint 7 project; frontend code no longer calls it.

## Intent-Based Mission Contract

The durable request boundary is now:

```js
requestMissionAction({ missionId, action })
```

Its SQL counterpart, `request_vault_mission_action(mission_id, action)`, accepts
no XP total, reward, lifecycle result, history record, or user id. Migration 005
implements trusted transition validation, saved reward lookup, duplicate
protection, atomic writes, and the returned authoritative snapshot behind this
contract.

`initialize_vault_session(...)` is retained for migration history but migration
006 revokes authenticated execution because it accepts client mission content.
`request_daily_mission()` now creates missing baseline progression at the
database-owned 75 XP value and selects the complete mission definition itself.

The Sprint 8 result contract is:

```js
{
  accepted,
  reason,
  event: {
    missionId,
    previousState,
    currentState,
    eventType,
    requestedAction,
    xpAwarded,
    timestamp
  },
  mission: { definition, lifecycle },
  progression: { totalXP },
  dailyStatus: { replacementsUsed, replacementsRemaining },
  historyRecord
}
```

History idempotency continues to use the existing key:

```text
user_id + daily_session_id + mission_id + terminal_at
```

## Skill Progression Authority

Migration 008 creates the fixed `skill_catalog` and the user-owned
`skill_progression` table. A skill row is created only when an accepted
completion first awards that skill. Its key is selected from the mission's
server-built `primarySkill`; the browser never sends a skill name, key, XP,
reward, level, percentage, or owner.

The completion function preserves the established lock order and extends it:

1. Current `daily_mission_state` row.
2. User `progression_state` row.
3. Matching `skill_progression` row.

After validating the mission and canonical 25-XP overall reward, PostgreSQL
validates `primarySkill` against the active catalog and applies the canonical
15-XP skill reward. Overall XP, skill XP, lifecycle state, completion marker,
and history commit or roll back together. A duplicate or concurrent completion
observes the terminal mission and cannot reach either XP update.

The action response preserves `progression` for compatibility and adds the
clean Sprint 10 fields:

```js
{
  overallProgression: { totalXP },
  updatedSkill: {
    key,
    name,
    totalXP,
    todayGain
  }
}
```

Skill levels and progress percentages are derived presentation values. The
shared `progression.js` engine owns separate `overall` and `skill`
configurations, currently using the same 0 / 100 / 250 / 450 / 700 thresholds.
Only stored totals are authoritative; the client cannot persist derived levels.

`mission_history.skill_key` and `skill_xp_awarded` preserve attribution across
replacement and future daily missions. `get_skill_progression()` uses these
rows plus the saved timezone to return today's gain after refresh or login.

Sprint 10's fixed mapping is: Programming → Front-End Engineering; Business or
Finance → Business; Fitness or Health → Fitness; Reading → Reading; Learning →
Learning; Career → Leadership; Creativity → Product Design; Relationships →
Communication; Mindset → Discipline; all other focuses → Problem Solving.
Back-End Engineering and Writing are cataloged for future templates.

## Durable Daily Identity

Sprint 7 used a clearly labeled temporary identifier:

```text
browser:<IANA-timezone>:<YYYY-MM-DD>
```

Sprint 9 replaces it with a server-derived `daily_key` date. PostgreSQL reads
the authenticated profile's validated IANA `timezone_name` (default `UTC`) and
converts `clock_timestamp()` to that logical date. The browser cannot submit a
date or daily-session id. The database primary key `(user_id, daily_key)` is the
strong one-mission-per-user/day invariant.

`request_daily_mission()` takes an advisory transaction lock derived from user
and daily key, checks the unique row, creates only when absent, and then re-reads
the stored row. Refreshes, logins, tabs, and devices therefore receive the same
mission instance. A conflict-safe insert provides a second safeguard.

Sprint 9.2 adds `nextResetAt` to the daily response:

```js
{
  accepted,
  reason,
  dailyKey,
  nextResetAt,
  mission,
  dailyStatus
}
```

`next_vault_reset_at(auth.uid(), server_now)` reads the saved validated
`profiles.timezone_name`, calculates the next midnight in that IANA timezone,
and converts the boundary to an absolute `timestamptz`. The public daily and
replacement RPCs remain zero-argument; the browser cannot submit a timezone,
date, reset timestamp, or clock value. The clock-injectable internal daily
helper uses one supplied server/test instant for both the logical day and reset
boundary, and remains revoked from browser roles.

The browser may subtract `Date.now()` from `nextResetAt` to present a countdown,
but that difference has no database authority. An incorrect browser clock can
only make the displayed duration inaccurate. PostgreSQL still decides rollover
from database time and saved timezone. At zero the client does not create a
mission; only the next authoritative `request_daily_mission()` call may return
the new day. Missing or invalid timestamps use static next-day guidance.

On rollover, stale `ready` or `active` rows become `expired`, receive zero XP,
and enter history once before the new day is created. Older terminal rows remain
unchanged. No browser timer or client expiration action participates.

`request_daily_mission_replacement()` is also zero-argument. It verifies
today's terminal state and the one-replacement limit, reads saved onboarding,
generates a server UUID, stores the canonical 25-XP definition as `ready`, and
leaves XP unchanged. The browser mission generator is compatibility/test-only.

## Locking, Atomicity, and Reconciliation

`request_vault_mission_action(...)` locks the authenticated user's
`daily_mission_state` row and then the matching `progression_state` row with
`FOR UPDATE`. All callers use this order. PostgreSQL runs the function in the
caller's transaction, so lifecycle, XP, completion marker, and terminal history
commit together or roll back together.

After the RPC returns, `application-service.js` discards any stale local
prediction and rebuilds the coordinator from the returned mission lifecycle and
daily status. It recreates progression from the returned `totalXP`, after which
`progression.js` derives display-only level information. Rejected stale requests
also return server state when a current mission exists, allowing tabs to
converge.

## Backup and Recovery Expectations

Supabase project backup settings should be selected before production launch. Migration files remain the reproducible schema source. Application errors block additional state-changing actions after a failed durable transition and instruct the user to reload the last stored state; raw database errors are never displayed.

The production dashboard uses authoritative transition mode. Sprint 9 replaces
the transitional client-definition replacement path with the zero-argument
server-selected replacement RPC. Mission A → replacement → Mission B remains
compatible, while migration 006 revokes authenticated execution of the older
initializer and replacement adapter.

## Manual Live Supabase Integration Test

Automated tests in this package are framework-free contract and orchestration
tests. They do not claim a live Supabase connection. After migrations 006, 007,
and 008 are reviewed and installed, test the real project exactly as follows.

### Account A

1. Sign in, load the dashboard, and record the mission id and current XP.
2. Refresh, log out/in, and open a second tab; verify every view shows the same mission id.
3. Complete Mission A once; verify overall XP increases by exactly 25 and the
   mapped skill increases by exactly 15.
4. Verify Mission A is `completed`, `completion_awarded` is true, and exactly
   one matching `mission_history` row exists with 25 overall XP, the expected
   skill key, and 15 skill XP.
5. Refresh; verify XP and completed state remain.
6. Prepare the replacement; verify Mission B is server-selected and stored as `ready`, reward 25,
   and `replacements_used = 1` without an XP change.
7. Complete Mission B; verify overall XP increases by exactly 25, the mapped
   skill increases by exactly 15, and one Mission B history row exists.
8. Refresh, then log out and back in; verify Mission B remains completed and the
   authoritative total remains.

### Concurrency

1. Open the same Account A mission in two tabs.
2. Trigger Complete in both tabs as closely as possible.
3. Verify only one response is accepted, overall XP increases by 25 once, skill
   XP increases by 15 once, `completion_awarded` is true, and exactly one
   history row exists.
4. Refresh both tabs and verify both converge on the same server state.

### Account B isolation

1. Sign in separately as Account B.
2. Use only normal application actions and confirm B sees only B's state.
3. Verify B cannot select or mutate Account A rows through the public client.
4. Confirm RLS remains enabled and direct grants on progression, daily mission,
   and history remain revoked.

### Safe rollover simulation

Use a local or disposable staging database only—never production. Inside a
transaction authenticated as the test account, call the non-browser helper with
an injected next-day timestamp, inspect the returned/new and expired rows, then
roll the transaction back. `request_daily_mission_at(timestamptz)` has no grant
to browser roles; a database owner can use it solely for deterministic testing.
Do not change server time or edit production mission rows manually.

## Sprint 10.1 UUID SQL Hotfix

Live daily mission generation returned PostgreSQL `42883`:

```text
function public.gen_random_uuid() does not exist
```

Migration 006 correctly kept mission instance identity on the server, but it
incorrectly qualified `gen_random_uuid()` as a member of `public`. KVNX Vault's
Supabase database has pgcrypto installed through migration 001, and Supabase
places extension objects in the `extensions` schema. Migration 009 therefore
uses the explicit, empty-search-path-safe call:

```sql
extensions.gen_random_uuid()
```

Migration 007 renamed the affected implementations when it added the
`nextResetAt` response wrapper. Migration 009 consequently recreates only:

- `public.request_daily_mission_at_sprint9(timestamptz)`
- `public.request_daily_mission_replacement_sprint9()`

The functions retain `SECURITY DEFINER`, `SET search_path = ''`, `auth.uid()`
ownership, advisory locking, current-day selection, server-side onboarding
reads, canonical mission construction, conflict-safe creation, terminal-state
validation, and the one-replacement limit. Their browser-role execution remains
revoked. Public RPC signatures and grants are untouched.

Migrations 001–008 are installed history and remain byte-for-byte unchanged.
The literal faulty call therefore remains visible only in historical migration
006; migration 009 replaces the corresponding active database definitions.

Automated coverage for this hotfix is contract/static only because this package
is not connected to a live Supabase project. After installing migration 009,
retest initial mission creation and replacement against the deployed project.

### Installation

If migrations 001–008 are already installed, run only:

```text
supabase/migrations/202608070009_sprint10_1_uuid_function_hotfix.sql
```

For a fresh database, run migrations 001–009 in filename order.

## Sprint 10.2 Skill Restoration Verification

The production `0 ACTIVE` report did not require a database correction.
Migration 008 already performs the complete authoritative skill transaction:

- the saved mission definition supplies the server-selected `primarySkill`;
- `request_vault_mission_action(text, text)` locks the daily mission, overall
  progression, and owned skill row in order;
- one accepted completion adds 25 overall XP and exactly 15 skill XP;
- the skill row, lifecycle, progression, and history changes commit together;
- duplicate and concurrent completion attempts observe terminal state and
  cannot repeat either award; and
- the response includes `updatedSkill` with the persisted total.

`get_skill_progression()` also already has the correct restoration contract. It
accepts no arguments, derives identity with `auth.uid()`, returns the current
user's active catalog rows as `key`, `name`, `totalXP`, and `todayGain`, and is
executable by `authenticated`. `skill_progression` retains RLS, its owner-read
policy, and revoked direct browser writes. Migration 009 changes only internal
daily UUID generation functions and does not replace or interfere with the
Sprint 10 action/restoration functions.

The fault was the accepted-completion dashboard redraw, not SQL persistence or
RPC restoration. Migrations 001–009 remain unchanged and no migration 010 is
created. A failed restoration RPC continues to surface the restrained generic
Vault restoration error; it is never converted into an empty skill array.

## Sprint 11 — Achievements & Milestones

Migration `202608070011_sprint11_achievements.sql` adds two tables:

- `achievement_catalog`: server-managed definitions with stable key, display
  metadata, category, hidden flag, and display order.
- `user_achievements`: one immutable unlock per `(user_id, achievement_key)`
  with a database-owned `unlocked_at` timestamp.

`user_achievements` has RLS enabled and an authenticated owner-read policy.
Direct insert, update, and delete privileges are revoked. Catalog table access
is also revoked; its presentation contract is exposed through the read-only
RPC. The internal evaluator and both restoration functions use
`SECURITY DEFINER` with `SET search_path = ''`; only the two zero-argument read
RPCs are executable by `authenticated`.

### RPC contracts

`get_achievement_catalog()` accepts no arguments and returns catalog metadata
in `displayOrder`. `get_user_achievements()` accepts no arguments, derives the
owner from `auth.uid()`, and returns only that user's unlocked definitions in
`unlockedAt DESC` order.

`request_vault_mission_action(text, text)` retains its input signature. An
accepted completion returns existing progression and skill fields plus
`newAchievements`. Only rows inserted by the current transaction appear in
that array, so an existing milestone cannot generate a duplicate notification.

### Unlock rules

- `FIRST_MISSION`: at least one authoritative completed history row.
- `FIRST_REPLACEMENT`: the completed mission has server state
  `replacements_used = 1`.
- `FIRST_SKILL`: at least one positive persisted skill row.
- `100_XP`, `250_XP`, `500_XP`, `1000_XP`: authoritative overall total meets
  the named threshold.
- `LEVEL_2`: overall total is at least 100 XP.
- `LEVEL_5`: overall total is at least 700 XP, matching the shared progression
  configuration.
- `THREE_DAY_STREAK`, `SEVEN_DAY_STREAK`: catalog only; no unlock predicate
  exists until authoritative consecutive-day tracking is implemented.

The migration reconciles milestones supported by existing authoritative data.
Because earlier sprints did not store exact threshold-crossing timestamps,
historical reconciliations use the database migration time. Future unlocks use
the accepted completion timestamp inside the transaction.

### Installation

If migrations 001–009 are already installed, run only:

```text
supabase/migrations/202608070011_sprint11_achievements.sql
```

There is intentionally no migration 010. For a fresh database, run migrations
001–009 and then 011 in filename order.

## Sprint 11.1 — Developer Test Panel (Staging Only)

Migration `202608070012_sprint11_1_developer_test_panel.sql` creates:

- `dev_environment_config`: singleton database-admin environment gate,
  inserted with `enabled = false`.
- `dev_test_accounts`: database-admin allowlist of authenticated test users.
- `dev_test_state`: one optional simulated timestamp per allowlisted user.

All three tables have RLS enabled. They intentionally have no browser policy,
and all table access is revoked from `public`, `anon`, and `authenticated`.
Only `SECURITY DEFINER` functions with `SET search_path = ''` access them.

The browser-executable development contracts are zero-argument:

```text
dev_get_test_state()
dev_advance_one_hour()
dev_advance_to_next_day()
dev_clear_test_clock()
```

Every call derives identity from `auth.uid()`, checks the server environment
flag, checks the authenticated account allowlist, and scopes its state access
to that user. There is no RPC for arbitrary time, user selection, account
reset, XP, skill XP, achievements, mission definitions, or replacement counts.

`dev_effective_vault_now()` is internal and revoked from browser roles. The
active daily, replacement, completion, and skill-restoration authorities use
it as their clock source. It returns the approved account's simulated instant
only when every gate is open; otherwise it returns `clock_timestamp()`.
The production signatures and canonical rules remain unchanged:

- `request_daily_mission()` remains zero-argument and calls the established
  clock-injectable daily engine.
- `request_daily_mission_replacement()` remains zero-argument and preserves
  the one-replacement limit and `extensions.gen_random_uuid()`.
- `request_vault_mission_action(text, text)` still accepts only mission intent,
  awards exactly 25 overall XP and 15 mapped skill XP, and uses the normal
  achievement evaluator.
- `get_skill_progression()` remains a zero-argument authenticated read.

Migration 012 should be installed only in a separate local/development or
staging Supabase project. Its environment gate remains off after installation.
See `DEVELOPMENT_TESTING.md` for the database-admin enablement and verification
workflow. Automated SQL verification in this package is contract/static only;
no live Supabase test is claimed.

## Sprint 12 — Vault History & Legacy

Migration `202608070013_sprint12_vault_history.sql` reuses
`public.mission_history`. It adds nullable `mission_description` and
`original_state` columns because those values cannot be reconstructed once
`daily_mission_state` advances. `capture_vault_history_details()` is an
internal, non-browser-executable trigger function with `SECURITY DEFINER` and
`SET search_path = ''`. Before the existing authoritative insert completes, it
copies the saved mission description and pre-terminal lifecycle state from the
same owner's current daily row. Existing history is never fabricated: only a
description whose mission identity still matches can be backfilled, and an
unprovable old original state remains null.

The existing index from migration 001 already supports chronological owner
retrieval:

```text
mission_history_user_id_terminal_at_idx
(user_id, terminal_at DESC)
```

No redundant index or duplicate history table is created.

### RPC contract

```text
get_vault_history()
```

The RPC accepts exactly zero arguments, derives identity from `auth.uid()`,
rejects unauthenticated execution, and returns only that user's completed
history ordered by `terminal_at DESC, id DESC`. Returned fields are:

- `historyId`, `missionId`, `title`, `category`
- `primarySkillKey`, `primarySkill`
- `overallXPEarned`, `skillXPEarned`, `status`, `completedAt`
- `description`, `originalMissionState`, `achievements`

Achievement rows are joined from `user_achievements` and
`achievement_catalog` only on the authenticated owner and the exact completion
timestamp used by the server transaction. Earlier reconciled achievements that
do not have a provable completion timestamp are not assigned to an entry.

Because the function returns a relation, the repository applies a PostgREST
range window while still invoking the RPC with no arguments. A 20-entry page
requests indexes `offset` through `offset + 20`; the 21st result is discarded
after setting `hasMore`. Page size is clamped to 50. This preserves bounded
long-term retrieval without accepting ownership input.

RLS remains enabled on `mission_history`. Direct insert, update, and delete
remain revoked from `authenticated`; `public` and `anon` cannot execute the
RPC; only `authenticated` receives execute. Migration 013 does not alter the
active mission action signature, canonical 25 overall XP, canonical 15 skill
XP, skill persistence, achievement evaluation, replacement rules, daily clock,
or UUID generation.

### Installation

Run migrations in filename order. On production with migrations 001–009 and
011 installed—or on staging that additionally has migration 012—apply:

```text
supabase/migrations/202608070013_sprint12_vault_history.sql
```

Migration 012 remains staging-only under its existing guidance. Database tests
in this package are contract/static unless run against a connected Supabase
project.

## Sprint 13 — Analytics & Insights

Migration `202608070014_sprint13_analytics_insights.sql` adds exactly one
read-only function:

```text
get_vault_analytics(p_period text) → jsonb
```

Accepted period values are `7d`, `30d`, and `all`. Every other value raises
SQLSTATE `22023`. The function rejects unauthenticated execution, derives the
owner exclusively from `auth.uid()`, uses `SECURITY DEFINER` with
`SET search_path = ''`, and is executable only by `authenticated`. It performs
no inserts, updates, deletes, reward calculations, achievement evaluation, or
history creation.

The response contract is:

```text
{
  period,
  generatedAt,
  periodStart,
  summary: {
    missionsCompleted,
    overallXPEarned,
    skillXPEarned,
    activeDays,
    achievementsUnlocked
  },
  mostDevelopedSkill: { key, name, xpEarned } | null,
  missionActivity: [{ date, completedCount }],
  xpActivity: [{ date, xpEarned }],
  skillActivity: [{ key, name, xpEarned }]
}
```

All mission and XP values aggregate authenticated-owner rows where
`mission_history.final_state = 'completed'`. Overall and skill XP use the
persisted `xp_awarded` and `skill_xp_awarded` columns. Achievement totals count
only existing `user_achievements.unlocked_at` rows; Analytics never calls the
achievement evaluator. Most Developed Skill is ordered by period skill XP
descending, `skill_catalog.sort_order` ascending, then skill key ascending.

Period boundaries use UTC calendar dates. `7d` starts at UTC midnight six days
before the generated date; `30d` starts twenty-nine days before it; both end at
the next UTC midnight and return every date in the window with explicit zeros.
`all` has no lower bound and returns active dates only. Active Days is the count
of distinct UTC completion dates, not a streak. Historical records before
skill attribution was installed can contribute overall XP and mission counts
but cannot contribute missing skill XP or a missing skill identity.

The existing `(user_id, terminal_at DESC)` history index and
`(user_id, unlocked_at DESC)` achievement index already support this bounded
owner aggregation, so no duplicate index or analytics table is created. RLS
remains enabled and browser writes remain revoked on both source tables.

### Installation

After production migrations 001–009, 011, and 013 are installed, apply:

```text
supabase/migrations/202608070014_sprint13_analytics_insights.sql
```

Migration 012 remains staging-only and is not required for production
Analytics. Migration 014 is production-safe and must be installed before the
Sprint 13 frontend is tested. Verification in this package is contract/static;
it does not claim a live Supabase execution.

## Sprint 14 — Authoritative Consistency Streaks

Migration `202608070015_sprint14_authoritative_streaks.sql` adds
`public.user_streak_state` with one primary-keyed row per `auth.users` owner:

- `current_streak integer`
- `longest_streak integer`
- `last_completed_daily_key date`
- `updated_at timestamptz`

Checks require nonnegative values, `longest_streak >= current_streak`, and a
consistent zero state. RLS is enabled. Authenticated users may select only
their own row; insert, update, and delete are revoked. Internal mutation and
trigger helpers are `SECURITY DEFINER`, pin `search_path` to empty, and are not
executable by browser roles.

The `mission_history_capture_streak` trigger runs after an authoritative
history insert. It ignores every state except `completed`, parses the saved
canonical `daily_session_id`, and serializes the owner state row. The state
algorithm is idempotent for the same or an earlier logical day, increments for
exactly the next day, and otherwise resets current to one while preserving
longest. The mission transaction therefore commits XP, skill XP, history,
streak, and achievement evaluation together.

Migration reconciliation considers only completed history with a valid ISO
calendar `daily_session_id`. It collapses multiple missions on one day, groups
consecutive days, and derives the current run at the latest trustworthy day
and the longest proven run. Legacy browser-shaped or malformed session IDs are
ignored. No historical timestamp or mission record is changed. Proven existing
three- and seven-day runs unlock the already-cataloged keys at migration time;
no earlier unlock timestamp is invented.

The read contract is:

```text
get_vault_streak() → {
  currentStreak,
  longestStreak,
  lastCompletedDailyKey
}
```

It takes zero arguments, derives the owner from `auth.uid()`, returns an
intentional zero state for an owner without history, and is executable only by
`authenticated`. The achievement evaluator now includes the existing
`THREE_DAY_STREAK` at current streak 3 and `SEVEN_DAY_STREAK` at current streak
7. Existing conflict handling keeps all unlocks duplicate-safe.

### Installation

After migration 014, apply:

```text
supabase/migrations/202608070015_sprint14_authoritative_streaks.sql
```

Migration 012 remains staging-only under its existing gates. Migration 015 is
required before the Sprint 14 frontend is released. Package verification is
static/contract-based and does not claim live Supabase execution.

## Sprint 15 — Server-Authoritative Mission Catalog

Migration `202608070016_sprint15_mission_catalog.sql` creates
`public.mission_catalog` with:

- stable `template_key` primary key
- canonical `focus_key`
- snapshot-ready title and description
- foreign-keyed `primary_skill_key`
- validated estimated minutes
- server-managed active flag and timestamps

The catalog has 66 active-by-default templates: six each for the ten canonical
onboarding categories and six General templates for arbitrary custom focus.
Browser roles receive no table privileges or policies. Catalog reads occur
only inside the internal `SECURITY DEFINER` builder with an empty search path.

### Canonical focus mapping

| Onboarding focus | Catalog focus | Skill |
| --- | --- | --- |
| Career | `career` | Leadership |
| Business | `business` | Business |
| Programming | `programming` | Front-End Engineering |
| Fitness | `fitness` | Fitness |
| Health | `health` | Fitness |
| Learning | `learning` | Learning |
| Creativity | `creativity` | Product Design |
| Finance | `finance` | Business |
| Relationships | `relationships` | Communication |
| Mindset | `mindset` | Discipline |
| Custom value | `general` | Problem Solving |

`build_vault_daily_mission(onboarding_profiles, uuid)` now reads only the
authenticated user's saved onboarding row supplied by the trusted caller,
derives the same timezone-aware logical key through the existing clock system,
and selects an active template with an active canonical skill. It returns the
server UUID, catalog snapshot, intensity-derived difficulty, and fixed 25 XP.

Selection considers the five most recent template identities from authoritative
daily assignments and completion history. Unused candidates rank first; then
least-recently-used candidates; then a deterministic owner/day/template hash.
The current daily template ranks last during replacement when multiple
candidates exist. No random value, history, category, skill, reward, date, or
owner is accepted from the browser.

Migration 016 adds nullable `mission_history.template_key` and extends the
existing archive trigger. It captures template identity only when the current
saved mission ID matches the inserted history mission. A limited reconciliation
uses the same exact identity rule. Existing rows remain unchanged when a
template cannot be proven, and Vault History continues displaying its saved
title, description, category, skill, rewards, timestamp, and original state.

### Installation

After migration 015, apply:

```text
supabase/migrations/202608070016_sprint15_mission_catalog.sql
```

No reset or destructive reconciliation is required. Existing daily missions,
history, XP, skills, achievements, and streak state remain valid. Package tests
are static/contract and application tests; they do not claim live Supabase
execution.

## Sprint 16 Mission Center Read Contract

Sprint 16 adds no table, function, policy, index, or migration. Mission Center
reuses the existing daily mission, Vault History, streak, progression, and
`nextResetAt` application snapshot values.

The one additional presentation read is `getSkillCatalog()`. It selects only
`skill_key`, `display_name`, and `sort_order` for active rows from the existing
`skill_catalog` table. Migration 008 already enables RLS, revokes every browser
write, and grants authenticated read access. The repository validates and
freezes those rows, and Application Service includes the frozen catalog in its
immutable snapshot. This read resolves the current mission's authoritative
`primarySkill` key to its canonical display name; it cannot choose a mission,
change a mapping, alter rewards, or expose `mission_catalog`.

No Migration 017 is required. Migrations 001–016 remain byte-for-byte unchanged,
and `migrations-pre-sprint16.sha256` records their package baseline.

## Sprint 18 Hidden Achievement Read Confidentiality

Migration `202608070017_sprint18_achievement_center.sql` replaces only the
existing zero-argument `get_achievement_catalog()` read definition. Migration
011 previously returned complete hidden catalog definitions and relied on the
browser to mask locked entries. Sprint 18 performs that masking inside the
authenticated `SECURITY DEFINER` read boundary instead.

For a hidden catalog row without a matching owner row in `user_achievements`,
the response contains a null key and category plus the approved `?` / `?????`
placeholder fields. Once an authoritative unlock exists for `auth.uid()`, the
real catalog definition is returned. Visible milestones are unchanged.

The function remains zero-argument, derives its owner exclusively from
`auth.uid()`, pins `search_path = ''`, and grants only authenticated execution.
It performs no insert, update, delete, evaluation, or reward operation. Existing
RLS and direct-write revocations remain unchanged. `migrations-pre-sprint18.sha256`
records the immutable 001–016 baseline without changing earlier baselines.

## Sprint 19 Daily Mission Choice Authority

Migration `202608070018_sprint19_daily_mission_choice.sql` adds
`daily_mission_choice_state`, keyed by `(user_id, daily_key)`. Its `choices`
array contains one to three server-generated option snapshots plus internal
template identity; selected identity and timestamp remain null until a choice
is locked. RLS is enabled, no browser policy exists, and all direct privileges
are revoked from `public`, `anon`, and `authenticated`.

The replaced internal `request_daily_mission_at_sprint9(timestamptz)` retains
the same authentication, onboarding, logical-day, rollover, advisory-lock, and
existing-mission behavior. Only the no-current-mission branch changes: it now
creates or restores a stable choice row. The public zero-argument wrapper from
Sprint 11.1 still supplies `dev_effective_vault_now()`, so approved staging and
real production time use the identical choice engine.

`select_daily_mission_choice(p_choice_id uuid)` is the only new authenticated
mutation contract. PostgreSQL derives `auth.uid()`, effective time, timezone,
logical day, offered row, template snapshot, canonical skill, fixed 25 XP
definition, ready lifecycle, replacement count, and mission UUID. Duplicate
selection of the winning ID is idempotent. A conflicting ID cannot switch the
mission after lock. Another owner, stale-day ID, arbitrary UUID, catalog key, or
tampered mission object cannot satisfy offered membership.

Only the public option projection crosses the read boundary; internal
`templateKey` is removed. Selection inserts no mission history and updates no
XP, skill XP, achievement, or streak table. Completion continues to award 25
overall XP and 15 mapped skill XP through the existing action transaction.

Apply after Migration 017:

```text
supabase/migrations/202608070018_sprint19_daily_mission_choice.sql
```

`migrations-pre-sprint19.sha256` records migrations 001–017 without changing
any historical baseline.

## Sprint 20 Skill Path Authority

Migration `202608070019_sprint20_skill_paths.sql` adds `user_skill_paths` with
one row per owner and canonical skill. `path_active`, activation/deactivation
timestamps, and a state-consistency check preserve soft preference state.
`skill_progression`, `mission_history`, onboarding, and Sprint 19 choice rows
are neither migrated nor rewritten.

The table has RLS enabled and intentionally has no browser policy. All direct
privileges are revoked from `public`, `anon`, and `authenticated`. Three narrow
contracts are executable only by `authenticated`:

- `get_skill_paths()` accepts no arguments and returns only `auth.uid()` rows.
- `activate_skill_path(p_skill_key text)` requires an active canonical catalog
  key and idempotently activates it.
- `deactivate_skill_path(p_skill_key text)` requires a canonical catalog key
  and idempotently soft-deactivates it.

All use `SECURITY DEFINER`, `SET search_path = ''`, schema-qualified objects,
and owner/skill advisory locking for mutation convergence. The mutation bodies
write only `user_skill_paths`: they award no XP or skill XP, create no mission
or history, alter no streak or achievement, and do not touch Daily Mission
Choice. Fitness is available through the same active canonical catalog
validation as every other skill, regardless of onboarding focus.

Apply after Migration 018 and before deploying the Sprint 20 frontend:

```text
supabase/migrations/202608070019_sprint20_skill_paths.sql
```

`migrations-pre-sprint20.sha256` records migrations 001–018 without changing
any historical fingerprint baseline.

## Sprint 21 Skill Path Mission Offer Authority

Migration `202608070020_sprint21_skill_path_mission_offers.sql` adds
`skill_path_mission_offer_state`, keyed by `(user_id, daily_key, skill_key)`.
Each row stores zero to three server-built offer snapshots and, optionally, the
single planned offer. Offer UUIDs are generated inside PostgreSQL. Template
identity remains internal; public responses contain only the opaque offer ID
and the presentation fields required by Skill Center.

The table has RLS enabled, no browser policies, and no direct grants for
`public`, `anon`, or `authenticated`. Only these authenticated contracts are
exposed:

- `get_skill_path_mission_offers()` restores all current-day active-path offer
  states for `auth.uid()` and accepts no arguments.
- `request_skill_path_mission_offers(p_skill_key text)` validates an active
  canonical owner path and creates/restores the bounded stable set.
- `select_skill_path_mission_offer(p_offer_id uuid)` proves current-day exact
  membership and records one immutable planned selection.

All three use `SECURITY DEFINER`, `SET search_path = ''`, schema-qualified
objects, and the existing effective server clock/logical-day functions. Internal
builders are fully revoked. Mutations are confined to offer state and cannot
touch mission, progression, history, streak, achievement, or Analytics tables.

Migration 020 also adds `skill_path` as a path-only `mission_catalog.focus_key`
and inserts six active canonical templates for each of Back-End Engineering,
Reading, and Writing. All twelve canonical skills consequently have at least
three eligible offers. The new focus is not recognized by Sprint 19's saved
onboarding-focus mapping and therefore cannot enter primary Daily Mission
Choice.

Apply after Migration 019 and before deploying the Sprint 21 frontend:

```text
supabase/migrations/202608070020_sprint21_skill_path_mission_offers.sql
```

`migrations-pre-sprint21.sha256` records migrations 001–019 without changing
any historical fingerprint baseline.

## Sprint 21.1 Effective-Clock Compatibility

Migration `202608070021_sprint21_1_effective_clock_compatibility.sql` conditionally
provides the zero-argument `public.dev_effective_vault_now()` dependency on
production databases where staging-only Migration 012 was intentionally not
installed.

The migration uses the exact catalog lookup
`pg_catalog.to_regprocedure('public.dev_effective_vault_now()')`. It deliberately
uses `CREATE FUNCTION`, never `CREATE OR REPLACE FUNCTION`:

- Existing staging function: no operation; Migration 012 remains untouched.
- Missing production function: install a `VOLATILE`, `SECURITY DEFINER`, empty-
  search-path SQL helper returning only `pg_catalog.clock_timestamp()`.

The production branch immediately revokes all execution from `public`, `anon`,
and `authenticated`. It creates no `dev_environment_config`,
`dev_test_accounts`, `dev_test_state`, developer mutation function, allowlist,
environment gate, offset, or simulated-clock capability. Internal authorities
owned by the migration role retain their normal invocation path.

Current references are:

- Migration 012: the staging helper definition plus staging-only developer and
  authoritative wrapper calls.
- Migration 016: `build_vault_daily_mission(...)`.
- Migration 018: `select_daily_mission_choice(uuid)`.
- Migration 020: `get_skill_path_mission_offers()`,
  `request_skill_path_mission_offers(text)`, and
  `select_skill_path_mission_offer(uuid)`.

Apply after Migration 020:

```text
supabase/migrations/202608070021_sprint21_1_effective_clock_compatibility.sql
```

`migrations-pre-sprint21.1.sha256` records migrations 001–020 without changing
any historical fingerprint baseline.

## Sprint 22 Side Mission Authority

Migration `202608070022_sprint22_side_mission_lifecycle.sql` adds
`side_mission_state`, uniquely keyed by `(user_id, daily_key)`. Direct table
writes are revoked and RLS is enabled. The only authenticated contracts are:

- `get_side_mission()` — zero-argument current-day restoration and safe stale
  expiration.
- `promote_skill_path_offer_to_side_mission(uuid)` — proves a current selected
  Sprint 21 offer and creates today's single slot.
- `start_side_mission()` — zero-argument idempotent READY-to-ACTIVE transition.
- `complete_side_mission()` — zero-argument atomic ACTIVE completion with exact
  +10 overall XP, +10 mapped skill XP, and one Side history record.

All use `auth.uid()`, the established effective server clock and logical-day
functions, `SECURITY DEFINER`, empty search paths, schema qualification, and
owner/day locking. Internal helpers are fully revoked. Migration 022 also adds
`mission_history.mission_type` with a legacy-safe `daily` default, restores the
history RPC with that field, and extends Analytics with Daily/Side counts.
Streak capture and first-Daily-mission evaluation are narrowed to Daily rows;
total-XP and skill-progression achievements remain driven by authoritative
persisted totals.

Apply after Migration 021 and before the Sprint 22 frontend:

```text
supabase/migrations/202608070022_sprint22_side_mission_lifecycle.sql
```

`migrations-pre-sprint22.sha256` records migrations 001–021 without changing
any historical baseline.

## Sprint 23 Side Mission Observability Authority

Migration `202608070023_sprint23_side_mission_observability.sql` adds
`side_mission_event_ledger`. It is written only by an authoritative trigger on
`side_mission_state`; RLS is enabled and all direct privileges are revoked from
`public`, `anon`, and `authenticated`. Each mission can have at most one event
of each type:

| Event | Authoritative source | Reward recorded |
|---|---|---:|
| `promoted` | inserted Side Mission state | 0 / 0 |
| `started` | lifecycle becomes `active` | 0 / 0 |
| `completed` | lifecycle becomes `completed` | +10 / +10 |
| `expired` | lifecycle becomes `expired` | 0 / 0 |

The completed event reward columns are constrained to exactly +10 overall and
+10 skill XP; every other event is constrained to zero. These columns are audit
evidence only. `progression_state`, `skill_progression`, and exact verified
`mission_history` remain the economy sources of truth.

Migration reconciliation creates events only from persisted authoritative
state. A historical completion event requires a completed/rewarded state plus
an exact matching Side history row with +10/+10 and the canonical skill. No
missing mission or reward is fabricated. Duplicate pre-existing Side history
causes an explicit migration failure rather than silent repair.

Two partial unique indexes harden completion history:

- one completed Side history record per `(user_id, daily_session_id)`;
- one completed Side history record per `(user_id, mission_id)`.

`get_side_mission_observability(p_period text)` is an authenticated read-only
RPC. It derives ownership from `auth.uid()`, uses the established effective
clock and logical day, accepts only `7d`, `30d`, or `all`, and returns lifecycle
counts, promotion-cohort completion rate, verified Side reward totals, XP by
canonical skill, and at most 20 recent lifecycle events.

`audit_side_mission_invariants()` is fully revoked from browser roles. Database
administrators may execute it in the SQL editor; zero rows means the checked
state, history, reward, skill, and event relationships agree. It detects only
and never mutates or repairs data.

Apply after Migration 022:

```text
supabase/migrations/202608070023_sprint23_side_mission_observability.sql
```

`migrations-pre-sprint23.sha256` records migrations 001–022 without changing
any historical fingerprint baseline.

## Sprint 24 Operational Hardening Authority

Migration `202608070024_sprint24_operational_hardening.sql` adds three
observational tables with RLS enabled and no browser policies or privileges:

- `vault_operational_monitoring_runs`: timestamps, health state, invariant and
  anomaly counts, alert changes, and structured category/severity counts.
- `vault_operational_findings`: one immutable structured finding per
  `(run_id, fingerprint)` with optional affected owner/day/mission references.
- `vault_operational_alerts`: one row per deterministic fingerprint with
  severity, source, current details, occurrence count, and open/resolved state.

The database-administrator-only functions are:

- `detect_vault_operational_anomalies()` — internal read-only rule set.
- `run_vault_operational_monitoring()` — serialized scan, finding persistence,
  alert upsert/deduplication, automatic observational resolution, and structured
  result.
- `get_vault_operational_health()` — read-only latest health, unresolved
  severity, recent category, volume, and retention summary without affected
  user/mission identifiers.
- `prune_vault_operational_data(integer, integer)` — bounded cleanup with 30–
  3650 retention days and 1–5000 records per class per call.

Every function uses `SECURITY DEFINER`, `SET search_path = ''`, and schema-
qualified objects. Execute is revoked from `public`, `anon`, and
`authenticated`; no browser or service-role credential is introduced.

Monitoring may write only the three operational tables. Cleanup may delete only
old monitoring runs (cascading their findings) and old resolved alerts. Open
alerts, Sprint 23 events, mission history/state, progression, skills,
achievements, streaks, and Daily state are never eligible.

Apply after Migration 023:

```text
supabase/migrations/202608070024_sprint24_operational_hardening.sql
```

`migrations-pre-sprint24.sha256` records migrations 001–023 without changing
historical baselines.

## Sprint 24.1 Legacy XP Reconciliation Hardening

Migration `202608070025_sprint24_1_legacy_xp_reconciliation.sql` adds one
administrator-only observational table:

- `vault_xp_reconciliation_baselines` stores a one-time explicitly attested
  legacy account snapshot: server-read total XP, server-summed completed
  history XP, server timestamp, required audit reason, and database principal.

The table begins empty. Existing-account status, creation timestamp, mission
chronology, and migration ordering do not qualify an account automatically.
The table has RLS enabled, no browser policies, and all privileges revoked from
`public`, `anon`, and `authenticated`.

`establish_vault_legacy_xp_baseline(uuid, text)` is database-owner-only. It
accepts an investigated account identifier and audit reason, locks the
progression row, reads total XP and history itself, and inserts at most one
baseline. It accepts no XP, date, history amount, or replacement value and is
fully revoked from browser roles.

Migration 025 replaces only `detect_vault_operational_anomalies()`:

- `overall-progression-legacy-provenance-gap` is a warning only for a difference
  captured by explicit administrator attestation.
- `overall-progression-post-boundary-divergence` is critical when current total
  XP no longer equals baseline total XP plus the completed-history delta.
- `overall-progression-authoritative-divergence` is critical for every
  unattested account, including accounts that existed before Migration 025,
  when total differs from 75 plus all verified completed-history XP.

No timestamps are used to qualify a legacy cohort or decide which history
rewards count after an attested baseline. The detector compares the history sum
recorded by the privileged snapshot with the current sum.
Migration 025 never updates `progression_state`, `skill_progression`, or
`mission_history`.

Apply after Migration 024:

```text
supabase/migrations/202608070025_sprint24_1_legacy_xp_reconciliation.sql
```

`migrations-pre-sprint24.1.sha256` records migrations 001–024 without changing
any earlier baseline.

## Sprint 24.2 Forward-Only Baseline Remediation

Migration `202608070026_sprint24_2_baseline_remediation.sql` repairs production
state created by the unsafe early Migration 025 without editing Migration 025
or gameplay data.

Schema compatibility:

- Adds `attestation_reason`, `established_by`, and `attestation_status` only
  when the early baseline schema lacks them.
- Preserves rows that already contain a complete explicit reason and database
  principal, qualifying them as `attested`.
- Deletes only automatic rows linked to the exact `sprint24_1` /
  `sprint24_1_migration` boundary timestamp with `legacy_snapshot` provenance
  and no attestation evidence.
- Removes the obsolete per-baseline `boundary_key`; keeps the boundary table as
  RLS-protected, revoked, superseded migration/incident metadata.
- Adds constraints requiring every trusted attestation to contain a valid
  reason and principal.

`establish_vault_legacy_xp_baseline(uuid, text)` is recreated with the reviewed
owner-only contract. It accepts no XP, history, date, timestamp, or operator
claim. It serializes by account, locks `progression_state`, computes completed
history XP server-side, records `session_user`, and inserts at most one
immutable attestation.

The prior anomaly detector is retained under a revoked internal name so all
non-overall Sprint 24 rules remain unchanged. The replacement detector applies
the corrected overall-XP classifications: unattested mismatch is critical,
explicitly attested pre-boundary gap is warning, post-boundary mismatch is
critical, and malformed provenance is warning while remaining unable to
suppress authoritative reconciliation.

No alert, progression, skill, history, mission, achievement, or streak row is
mutated. Both tables and all helper functions remain revoked from `public`,
`anon`, and `authenticated`; privileged functions use `SECURITY DEFINER`, an
empty fixed search path, and schema-qualified objects.

Apply after the production-applied Migration 025:

```text
supabase/migrations/202608070026_sprint24_2_baseline_remediation.sql
```

`migrations-pre-sprint24.2.sha256` records migrations 001–025 without changing
any historical fingerprint baseline.

## Sprint 24.3 Monitoring Helper Compatibility

Migration `202608070027_sprint24_3_monitoring_helper_compatibility.sql` creates
a direct, schema-compatible `detect_vault_operational_anomalies()` and removes
`detect_vault_operational_anomalies_pre_sprint24_2()`.

The final detector includes all Sprint 24 non-overall rules and the Sprint 24.2
attestation-aware reconciliation rules. It contains no `boundary_key`
reference. `run_vault_operational_monitoring()` is unchanged and naturally
resolves obsolete alerts after a successful complete scan. Detector,
monitoring, and attestation execution remain revoked from `public`, `anon`, and
`authenticated`; no gameplay or alert rows are directly changed by Migration
027.

Apply after Migration 026:

```text
supabase/migrations/202608070027_sprint24_3_monitoring_helper_compatibility.sql
```

`migrations-pre-sprint24.3.sha256` records migrations 001–026 unchanged.
