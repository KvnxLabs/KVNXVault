# KVNX Vault Database

Version: Sprint 8

The authoritative schema and policies live in:

- `supabase/migrations/202608070001_sprint7_foundation.sql`
- `supabase/migrations/202608070002_sprint7_1_security_correction.sql`
- `supabase/migrations/202608070003_sprint7_2_prototype_persistence.sql`
- `supabase/migrations/202608070004_sprint7_2_replacement_persistence.sql`
- `supabase/migrations/202608070005_sprint8_server_authority.sql`

Run all five migrations in filename order for a new project. The Sprint 7.1
correction secures an existing Sprint 7 database, and the Sprint 7.2 migration
pair adds only narrow transitional completion and replacement persistence
functions. Migration 005 revokes the prototype completion function from the
authenticated role and installs the production action authority.

## Tables

| Table | Authoritative state | Ownership |
|---|---|---|
| `profiles` | First name and account timestamps | `user_id → auth.users.id` |
| `onboarding_profiles` | Existing onboarding contract | `user_id → auth.users.id` |
| `progression_state` | Authoritative stored total XP | `user_id → auth.users.id` |
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

`initialize_vault_session(...)` may create missing baseline rows. The database,
not the browser, selects the initial XP value of 75 and canonicalizes the stored
mission reward to the current catalog value of 25. Migration 005 also
canonicalizes existing saved definitions and replacement definitions.

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

Sprint 7 uses a clearly labeled temporary identifier:

```text
browser:<IANA-timezone>:<YYYY-MM-DD>
```

It is calculated once when the application service starts. This is durable enough for restoration but is not authoritative because the browser controls its clock and timezone.

A future backend should issue the daily-session id from the user's saved timezone and a server clock, then send explicit rollover/expiration commands through the coordinator boundary. No interval or fake scheduler is included.

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

The production dashboard now uses authoritative transition mode. Accepted
replacement definitions still use the separate zero-XP Sprint 7.2 function so
Mission A → replacement → Mission B remains compatible. Migration 005 hardens
that function by canonicalizing reward and returning the stored server snapshot.
It remains transitional; it accepts no XP and cannot write progression.

## Manual Live Supabase Integration Test

Automated tests in this package are framework-free contract and orchestration
tests. They do not claim a live Supabase connection. After migration 005 is
reviewed and installed, test the real project exactly as follows.

### Account A

1. Sign in and record the current `progression_state.total_xp`.
2. Complete Mission A once; verify XP increases by exactly 25.
3. Verify Mission A is `completed`, `completion_awarded` is true, and exactly
   one matching `mission_history` row exists with 25 XP.
4. Refresh; verify XP and completed state remain.
5. Prepare the replacement; verify Mission B is stored as `ready`, reward 25,
   and `replacements_used = 1` without an XP change.
6. Complete Mission B; verify XP increases by exactly 25 and one Mission B
   history row exists.
7. Refresh, then log out and back in; verify Mission B remains completed and the
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
