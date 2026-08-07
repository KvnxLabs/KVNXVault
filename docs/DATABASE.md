# KVNX Vault Database

Version: Sprint 7.2

The authoritative schema and policies live in:

- `supabase/migrations/202608070001_sprint7_foundation.sql`
- `supabase/migrations/202608070002_sprint7_1_security_correction.sql`
- `supabase/migrations/202608070003_sprint7_2_prototype_persistence.sql`
- `supabase/migrations/202608070004_sprint7_2_replacement_persistence.sql`

Run all four migrations in filename order for a new project. The Sprint 7.1
correction secures an existing Sprint 7 database, and the Sprint 7.2 migration
pair adds only narrow transitional completion and replacement persistence
functions.

## Tables

| Table | Authoritative state | Ownership |
|---|---|---|
| `profiles` | First name and account timestamps | `user_id → auth.users.id` |
| `onboarding_profiles` | Existing onboarding contract | `user_id → auth.users.id` |
| `progression_state` | Stored total XP; authoritative awarding begins in Sprint 8 | `user_id → auth.users.id` |
| `daily_mission_state` | Current definition, lifecycle state, reward status, replacement count, daily identity | `user_id → auth.users.id` |
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
- `initializeVaultSession({ dailySessionId, definition })`
- `requestMissionAction({ missionId, action })`
- `persistValidatedPrototypeProgression({ missionId, lifecycleEvent, progressionSnapshot })`
- `persistValidatedPrototypeReplacement({ replacementEvent, coordinatorSnapshot })`

The preferred repository contract has no `saveProgression(totalXP)`, generic
mission-state setter, or client-result persistence method. Its action request
contains only mission identity and intent.

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
must be removed when Sprint 8 replaces the old tests.

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
no XP total, reward, lifecycle result, history record, or user id. In Sprint 7.1
it validates the request shape and returns
`server-authority-pending-sprint-8` without mutating mission or progression data.
Sprint 8 will implement trusted transition validation, reward lookup, duplicate
protection, atomic writes, and the returned authoritative snapshot behind this
contract.

`initialize_vault_session(...)` may create missing baseline rows. The database,
not the browser, selects the initial XP value of 75. A submitted mission
definition is stored for restoration but its embedded reward is not trusted for
awarding XP.

The intended Sprint 8 result contract is:

```js
{
  accepted,
  missionState,
  xpAwarded,
  totalXP,
  progression
}
```

Atomicity and retry idempotency will continue to use the existing history key:

```text
user_id + daily_session_id + mission_id + terminal_at
```

## Durable Daily Identity

Sprint 7 uses a clearly labeled temporary identifier:

```text
browser:<IANA-timezone>:<YYYY-MM-DD>
```

It is calculated once when the application service starts. This is durable enough for restoration but is not authoritative because the browser controls its clock and timezone.

A future backend should issue the daily-session id from the user's saved timezone and a server clock, then send explicit rollover/expiration commands through the coordinator boundary. No interval or fake scheduler is included.

## Backup and Recovery Expectations

Supabase project backup settings should be selected before production launch. Migration files remain the reproducible schema source. Application errors block additional state-changing actions after a failed durable transition and instruct the user to reload the last stored state; raw database errors are never displayed.

Until Sprint 8, the dashboard explicitly uses prototype transition mode. A
validated completion and its progression snapshot are persisted through the
Sprint 7.2 transitional function, so XP and the completed state restore after a
refresh or later login. Accepted replacement definitions are persisted through
the separate zero-XP Sprint 7.2 replacement function, so the replacement can be
completed and restored without a mission mismatch. These remain prototype
persistence boundaries, not authoritative mission validation: the client still
originates the events and mission definitions. Sprint 8 replaces both adapters
with trusted action validation behind `request_vault_mission_action(...)`.
