# KVNX Vault Database

Version: Sprint 9.2

The authoritative schema and policies live in:

- `supabase/migrations/202608070001_sprint7_foundation.sql`
- `supabase/migrations/202608070002_sprint7_1_security_correction.sql`
- `supabase/migrations/202608070003_sprint7_2_prototype_persistence.sql`
- `supabase/migrations/202608070004_sprint7_2_replacement_persistence.sql`
- `supabase/migrations/202608070005_sprint8_server_authority.sql`
- `supabase/migrations/202608070006_sprint9_daily_mission_authority.sql`
- `supabase/migrations/202608070007_sprint9_2_daily_reset_countdown.sql`

Run all seven migrations in filename order for a new project. The Sprint 7.1
correction secures an existing Sprint 7 database, and the Sprint 7.2 migration
pair adds only narrow transitional completion and replacement persistence
functions. Migration 005 revokes the prototype completion function from the
authenticated role and installs the production action authority. Migration 006
installs server-authoritative daily identity, generation, rollover, and
replacement selection without editing migrations 001–005. Migration 007 adds
the server-derived next-reset response contract without editing migrations
001–006 or changing mission authority.

## Tables

| Table | Authoritative state | Ownership |
|---|---|---|
| `profiles` | First name, validated IANA timezone, and account timestamps | `user_id → auth.users.id` |
| `onboarding_profiles` | Existing onboarding contract | `user_id → auth.users.id` |
| `progression_state` | Authoritative stored total XP | `user_id → auth.users.id` |
| `daily_mission_state` | Per-day definition, lifecycle state, reward status, replacement count, and logical date | `(user_id, daily_key)` with `user_id → auth.users.id` |
| `mission_history` | Terminal mission records | `user_id → auth.users.id` |

Derived progression values—level, next threshold, remaining XP, and percentage—are not stored. `progression.js` recomputes them from `total_xp`, preserving one progression engine.

Mission definitions remain JSON because their stable domain contract already exists and future backward-compatible metadata may vary. Lifecycle state remains separate columns so constraints and restoration stay explicit.

## Repository Contract

`js/user-repository.js` is the only module that knows table names, column names, Supabase query syntax, or persistence RPCs. It exposes reads plus intent-oriented writes:

- `loadProfile()` / `saveProfile()`
- `loadOnboarding()` / `saveOnboarding()`
- `loadProgression()`
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

RLS is enabled on all five tables. Policies are restricted to the `authenticated` Postgres role and compare each row with:

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
tests. They do not claim a live Supabase connection. After migrations 006 and
007 are reviewed and installed, test the real project exactly as follows.

### Account A

1. Sign in, load the dashboard, and record the mission id and current XP.
2. Refresh, log out/in, and open a second tab; verify every view shows the same mission id.
3. Complete Mission A once; verify XP increases by exactly 25.
4. Verify Mission A is `completed`, `completion_awarded` is true, and exactly
   one matching `mission_history` row exists with 25 XP.
5. Refresh; verify XP and completed state remain.
6. Prepare the replacement; verify Mission B is server-selected and stored as `ready`, reward 25,
   and `replacements_used = 1` without an XP change.
7. Complete Mission B; verify XP increases by exactly 25 and one Mission B
   history row exists.
8. Refresh, then log out and back in; verify Mission B remains completed and the
   authoritative total remains.

### Concurrency

1. Open the same Account A mission in two tabs.
2. Trigger Complete in both tabs as closely as possible.
3. Verify only one response is accepted, total XP increases by 25 only once,
   `completion_awarded` is true, and exactly one history row exists.
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
