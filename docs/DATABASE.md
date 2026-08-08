# KVNX Vault Database

Version: Sprint 10

The authoritative schema and policies live in:

- `supabase/migrations/202608070001_sprint7_foundation.sql`
- `supabase/migrations/202608070002_sprint7_1_security_correction.sql`
- `supabase/migrations/202608070003_sprint7_2_prototype_persistence.sql`
- `supabase/migrations/202608070004_sprint7_2_replacement_persistence.sql`
- `supabase/migrations/202608070005_sprint8_server_authority.sql`
- `supabase/migrations/202608070006_sprint9_daily_mission_authority.sql`
- `supabase/migrations/202608070007_sprint9_2_daily_reset_countdown.sql`
- `supabase/migrations/202608070008_sprint10_skill_progression.sql`

Run all eight migrations in filename order for a new project. The Sprint 7.1
correction secures an existing Sprint 7 database, and the Sprint 7.2 migration
pair adds only narrow transitional completion and replacement persistence
functions. Migration 005 revokes the prototype completion function from the
authenticated role and installs the production action authority. Migration 006
installs server-authoritative daily identity, generation, rollover, and
replacement selection without editing migrations 001–005. Migration 007 adds
the server-derived next-reset response contract without editing migrations
001–006 or changing mission authority. Migration 008 adds the fixed skill
catalog, user-owned skill totals, history attribution, and atomic dual-award
contract without editing migrations 001–007.

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
