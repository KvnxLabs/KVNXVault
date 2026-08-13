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
