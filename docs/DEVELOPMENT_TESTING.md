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
