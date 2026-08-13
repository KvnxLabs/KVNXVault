# KVNX Vault Architecture

Version: 2.1

Author: Doug (Founder)  
Architect: Sensei

## Mission

KVNX Vault is a premium personal progression platform built to help people become the strongest version of themselves.

Every feature must reinforce one idea:

> Build the person who can build the life.

The application should feel calm, premium, intentional, and focused. Never distracting. Never overwhelming. Never gamified for the sake of gamification.

## Core Principles

1. Simplicity beats complexity.
2. Every feature must have a purpose.
3. Performance is a feature.
4. Quality over quantity.
5. The UI should disappear so the user can focus on their growth.
6. Build for years, not weeks.

## Design Language

Inspired by Apple, Linear, Notion, Stripe, and GitHub.

Avoid gaming UI, crypto UI, generic AI websites, excessive gradients, and visual clutter.

## Tech Stack

Current frontend: HTML5, CSS3, vanilla JavaScript, Supabase Auth, and Supabase PostgreSQL with Row Level Security.

Future possibilities: React, Node.js, PostgreSQL, authentication, and AI integration. Do not introduce frameworks until they solve a real problem.

## Project Structure

```text
app/
  index.html
  login.html
  signup.html
  onboarding.html
  dashboard.html
  missions.html
  skills.html
  achievements.html
  vault.html
  analytics.html
  settings.html
  assets/
    images/
    icons/
    logos/
    fonts/
  css/
    style.css
    auth.css
    dashboard.css
    onboarding.css
    components.css
    animations.css
  js/
    script.js
    auth.js
    config.js
    auth-service.js
    route-guard.js
    protected-page.js
    user-repository.js
    application-service.js
    onboarding-state.js
    onboarding.js
    mission-generator.js
    mission-lifecycle.js
    mission-coordinator.js
    progression.js
    dashboard.js
    missions.js
    skills.js
    vault.js
  components/
  tests/
    mission-lifecycle.test.js
    mission-coordinator.test.js
    auth-service.test.js
    route-guard.test.js
    application-service.test.js
    security-contract.test.js
    prototype-persistence.test.js
    replacement-persistence.test.js
    mission-replacement-bugfix.test.js
    skill-progression.test.js
  supabase/
    migrations/
  docs/
```

## Navigation Flow

Landing Page → Login → Create Account → Onboarding → Vault Introduction → Dashboard → All Application Features.

The landing page, login, and signup are public. Onboarding and dashboard require a restored authenticated session.

## Application State Boundaries

Sprint 2 onboarding data is temporary and session-scoped. `onboarding-state.js` is the single interface for reading, writing, and clearing that state. It uses `sessionStorage` only so the create-account, onboarding, and dashboard pages can share placeholder personalization during the current browser-tab session.

This temporary state is not an account system and must not store email addresses, passwords, authentication tokens, or durable user records. A future backend should replace this adapter without requiring the onboarding UI to be rewritten.

Sprint 3 mission completion state is intentionally page-scoped. Completing the prototype mission updates only the current dashboard document and resets on refresh. The onboarding answers remain session-scoped so the dashboard can regenerate the same personalized first mission during the current browser-tab session.

Sprint 4 progression state is also page-scoped. `progression.js` owns XP totals, level thresholds, level-up detection, and derived progress values. Its level configuration is the only place where the prototype curve is balanced. Refreshing the dashboard creates a fresh progression instance; no progression value is written to browser storage.

Sprint 5 mission lifecycle state is page-scoped and owned by `mission-lifecycle.js`. Each generated mission definition receives a separate lifecycle controller when the dashboard loads. Refreshing the page creates a new `ready` state. The lifecycle controller is the only authority that can accept or reject state transitions and issue validated XP-bearing completion events.

Sprint 6 daily mission state is page-scoped and owned by `mission-coordinator.js`. The coordinator requests one definition, creates its lifecycle controller, holds terminal history in memory, and enforces the one-replacement limit. Refreshing the dashboard creates a new coordinator and clears its current mission, history, and replacement count. None of this state is written to `sessionStorage`, `localStorage`, or a backend.

Sprint 7 replaces prototype state ownership with durable authenticated storage. `auth-service.js` owns Supabase Auth. `user-repository.js` owns all storage details. `application-service.js` restores domain engines and persists their public state without placing database logic inside them. `onboarding-state.js` is now an in-memory compatibility cache only; Supabase owns durable onboarding, progression, coordinator, lifecycle, and history state.

Sprint 7.1 corrects the durable mutation boundary before Supabase is connected.
Profiles and onboarding remain user-owned durable records. Progression and
mission state can be read for restoration, but the browser cannot directly write
XP totals, lifecycle results, or history. The dashboard runs mission actions in
an explicitly labeled session-only prototype mode until Sprint 8 implements the
trusted intent handler.

Sprint 7.2 corrects the prototype persistence handoff discovered during live
integration. An accepted local `mission.completed` event still flows through
the unchanged progression engine. The application service may then pass that
exact immutable event and progression snapshot to a narrow transitional
repository adapter. The database locks the saved rows, reads the saved mission
reward, computes the permitted next total from the stored total, and persists
the completion only when the engine snapshot matches. Refresh and later login
therefore restore the earned prototype XP and terminal lifecycle state.

Sprint 7.2 also persists an accepted coordinator replacement through a separate
`persistValidatedPrototypeReplacement(...)` adapter. Only a validated
`coordinator.mission-replaced` event and its immutable coordinator snapshot may
cross this boundary. The database rechecks the saved terminal mission and the
one-replacement limit, then replaces the definition, restores lifecycle state
to `ready`, clears completion and terminal markers, and preserves the consumed
replacement count. This function accepts no XP value and never updates
progression.

Sprint 7.3 corrects replacement identity and request-state handling without
changing the Sprint 7.2 persistence boundary. Mission catalog entries are
templates that describe what to do; each call to `generateMission()` now creates
a separate mission instance with a browser-native UUID. The coordinator also
rejects overlapping replacement requests, and the dashboard restores the
replacement button's disabled and `aria-busy` states in a guaranteed cleanup
path based on whether the latest coordinator snapshot still permits a retry.

Sprint 8 moves normal mission actions across the final authority boundary.
The production dashboard sends only mission-instance identity and action intent
to `request_vault_mission_action(...)`. PostgreSQL derives the user from
`auth.uid()`, locks the daily-mission and progression rows, validates the saved
lifecycle state, reads the canonical saved reward, applies mission/progression/
history changes atomically, and returns the resulting authoritative snapshot.
The application service rebuilds its local coordinator and progression model
from that response. If local state disagrees, the server response wins.

Sprint 9 moves daily identity, creation, rollover, and replacement selection
behind the same trusted boundary. Production restoration calls the zero-argument
`request_daily_mission()` RPC. PostgreSQL derives the user from `auth.uid()`,
resolves the logical date from server time and the saved IANA timezone, selects
a mission template from saved onboarding, creates a server UUID instance,
persists at most one row for `(user_id, daily_key)`, and returns the exact saved
mission. The coordinator remains the local render/lifecycle model but no longer
decides whether today's mission exists.

Sprint 10 adds a second, server-authoritative progression axis without changing
overall XP. Every authoritative mission definition now carries a
server-selected `primarySkill`. On an accepted completion, PostgreSQL awards
the existing 25 overall XP plus 15 XP to that one skill in the same transaction.
The browser submits neither value, skill identity, nor level. Skill totals are
restored through a zero-argument repository read and converted into immutable
display snapshots by the shared progression engine.

## Authentication Boundary

`auth-service.js` is the only application interface to Supabase Auth. It supports email/password sign-up, sign-in, sign-out, current-session retrieval, authenticated current-user verification, and auth-state observation. Only the public project URL and publishable key are supplied to the browser.

`route-guard.js` owns pure routing decisions. `protected-page.js` restores the user before onboarding or dashboard renders. Static route protection is an experience boundary, not a data-security boundary; PostgreSQL RLS remains authoritative.

## Repository and Persistence Boundary

`user-repository.js` is the only module that knows Supabase table, column, query, and RPC details. It resolves ownership through the authenticated user and maps database rows back to the existing KVNX contracts.

`application-service.js` coordinates restoration around the unchanged domain responsibilities:

```text
Authenticated user
  → User Repository
  → Application Service
  → Mission Coordinator / Lifecycle / Progression
  → Immutable application snapshot
  → Dashboard Renderer
```

The application service restores `totalXP` into `progression.js` so levels and percentages remain derived in one place. It restores the persisted mission definition and lifecycle state through the coordinator's backward-compatible restoration option. Completed missions remain terminal after restoration, preserving duplicate-completion protection.

The production durable mutation is `requestMissionAction({ missionId, action })`.
The repository sends only intent to `request_vault_mission_action`; it exposes no
generic progression setter. The Sprint 7 RPC that accepted a final XP total and
the Sprint 7.2 completion adapter are revoked for authenticated production use.
Sprint 8 implements transition validation, reward selection, atomic mission/
progression/history writes, and the authoritative returned snapshot behind the
intent contract.

For the current demo, `application-service.js` supports a clearly labeled
`prototype` transition mode. Existing lifecycle and progression behavior runs
locally. Sprint 7.2 adds `persistValidatedPrototypeProgression(...)`, a narrow
repository adapter that accepts only the accepted completion event and immutable
snapshot returned by `progression.js`. It is not exposed by the application
service or dashboard, and it is not a generic XP setter. A separate legacy
adapter exists only so the original Sprint 7 test harness remains unchanged.

The companion `persistValidatedPrototypeReplacement(...)` repository adapter
is equally narrow. The application service calls it only after coordinator
replacement validation succeeds. It receives the new definition and
replacement metadata needed for restoration, but no progression value and no
user id. Rejected replacements never reach persistence, and the coordinator
continues to own the one-replacement-per-session rule.

The retained prototype adapters do not make the browser a trusted authority. A user
can modify client code, and the saved mission definition originated in the
client. The database bounds a write to one stored reward, blocks a second saved
completion, and computes the written total itself; Sprint 8 must still move the
actual action validation, reward selection, and audit contract now live behind
`requestMissionAction()`. The browser-generated daily-session identity and the
separate replacement-definition handoff remain transitional boundaries.

## Server-Authoritative Mission Boundary

```text
Dashboard intent
  → Application Service
  → User Repository
  → request_vault_mission_action(missionId, action)
  → auth.uid() ownership + row locks
  → lifecycle validation + saved reward lookup
  → atomic mission / progression / history mutation
  → authoritative response
  → client reconciliation through coordinator + progression engines
```

Supported browser actions are `start`, `complete`, and `skip`. Expiration is
not exposed as a client-controlled authoritative action. Ready missions may
start, complete, or skip; active missions may complete or skip; completed,
skipped, and expired states are terminal. Rejected actions mutate nothing and
award zero XP.

The database locks `daily_mission_state` before `progression_state` for every
action. Concurrent completion requests therefore serialize: the first valid
request can award 25 XP and record history, while the next observes `completed`
and returns `already-completed` with zero XP. Refresh, later login, multiple
tabs, and multiple devices all converge on the same stored result.

The response contract contains `accepted`, `reason`, a server event, the current
mission definition/lifecycle, authoritative overall progression, the updated
skill when completion succeeds, daily replacement status, and the server-created
history record when applicable. `progression.js` receives returned totals only
to derive levels, thresholds, remaining XP, and display percentage; it does not
authorize or persist either award.

## Server-Authoritative Skill Progression

```text
Mission intent
  → mission/day lock
  → overall progression lock
  → primary-skill row lock
  → validate lifecycle + canonical rewards
  → +25 overall XP +15 skill XP + terminal history
  → one atomic commit
  → immutable overall and skill snapshots
  → dashboard rendering
```

`skill_catalog` is the fixed Sprint 10 catalog. `skill_progression` stores one
row per `(user_id, skill_key)` and creates that row lazily on the first accepted
mission completion for the skill. Direct browser writes are revoked and RLS
restricts reads to `auth.uid()`. `mission_history` records `skill_key` and
`skill_xp_awarded`, allowing today's gain to restore after replacement, refresh,
or a later login.

The mission-to-skill mapping is server data/rules, not client inference:

| Mission focus | Primary skill |
|---|---|
| Programming | Front-End Engineering |
| Business / Finance | Business |
| Fitness / Health | Fitness |
| Reading | Reading |
| Learning | Learning |
| Career | Leadership |
| Creativity | Product Design |
| Relationships | Communication |
| Mindset | Discipline |
| Any future/unmapped focus | Problem Solving |

Back-End Engineering and Writing are included in the catalog for future mission
templates. Adding a skill requires a catalog row and mapping rule; it does not
require a new per-user table or dashboard contract.

## Database Ownership Boundary

Every product table references `auth.users.id` through `user_id`. RLS policies
restrict row visibility to `(select auth.uid()) = user_id`. Sprint 7.1
additionally revokes browser writes to progression, mission state, and history.
RLS prevents cross-user access but cannot establish that a current user's
client-submitted XP value was earned; trusted mission validation is required for
that authority.

See `docs/DATABASE.md` and `docs/AUTHENTICATION.md` for schema, policies, setup, static-page limits, and operational guidance.

## Onboarding Philosophy

Onboarding learns direction, not personality. Each screen asks one clear question, required choices are validated in context, and answers are collected only when they directly shape the first dashboard. The final Vault introduction lives within `onboarding.html` to prevent a visual flash between onboarding and the dashboard handoff.

## Dashboard Philosophy

The dashboard is the command center. It should answer one question immediately: “What should I do next?” Everything unnecessary should be removed.

### Sprint 10 Skills presentation

The existing Skills Overview card renders the restored authoritative skill
list. Each item shows name, level, progress bar, total XP, and server-derived
today gain. Empty accounts receive a neutral first-mission prompt instead of
placeholder mastery. The product does not yet contain a `skills.html` route, so
Sprint 10 does not invent or redesign a separate Skills page.

An accepted completion briefly shows the authoritative overall and skill awards
in a restrained status notice. The notice performs no arithmetic, does not
persist state, and respects the existing reduced-motion rule. Refresh and login
rebuild the card from PostgreSQL, while replacement and new-day mission creation
leave lifetime skill totals unchanged.

Sprint 10.2 closes the final presentation handoff in that flow. The database
was already persisting the 15-XP skill award atomically, the zero-argument RPC
was already restoring owned rows, and the application service was already
merging `updatedSkill` into its immutable snapshot. The accepted-completion
dashboard branch refreshed overall progression and mission state but omitted
`renderSkills(snapshot.skills)`, leaving the pre-completion empty card visible.
It now redraws Skills Overview and the restrained dual-award notice from the
same authoritative completion response. Refresh and login continue to restore
through `get_skill_progression()`; a restoration error blocks dashboard
initialization and uses the existing safe Vault error rather than masquerading
as an empty account.

### Sprint 9.1 Daily Complete presentation

The dashboard renders a dedicated Daily Complete state only when the restored
server snapshot says the current mission is `completed` and
`dailyStatus.replacementsRemaining` is exactly `0`. The renderer does not infer
completion from missing or hidden controls. A completed first mission with one
replacement remaining continues to show the existing replacement action.

The Daily Complete panel replaces the mission action area and displays the
current XP from the progression snapshot. Sprint 9.2 adds `nextResetAt` to the
authoritative daily response. PostgreSQL calculates that absolute timestamp
from database time and the authenticated profile's saved IANA timezone. The
browser formats only the remaining display duration and updates it once per
minute. It never selects the reset boundary.

When the display reaches zero, it changes to “New mission ready” and waits for
the normal zero-argument `requestDailyMission()` reconciliation path. It does
not create, expire, replace, or reset a mission locally. Missing or invalid
timestamps retain the safe “New mission available tomorrow” fallback. The
browser clock can make the presentation early or late, but cannot affect which
mission PostgreSQL considers current.

The status uses a text heading plus a decorative check, an initially polite
atomic success region, and a programmatic focus target. Focus moves into the
status only when an action that just disappeared held focus. The countdown is
an `aria-live="off"` timer, so minute changes are not announced. A separate
polite status announces “New mission ready” once. There is no new animation, so
existing reduced-motion behavior remains unchanged. No history action is shown
because the product has no usable mission-history route.

## Mission Generation Boundary

`mission-generator.js` is the single mission-generation interface. Its asynchronous `generateMission()` contract accepts onboarding answers and resolves to a stable mission object containing `id`, `focus`, `title`, `description`, `estimatedDuration`, `difficulty`, and `xpReward`.

Beginning in Sprint 9, that browser generator is compatibility/test-only for
historical domain suites. Production daily and replacement missions come from
PostgreSQL. The server catalog preserves the same definition contract and the
Sprint 7.3 template-versus-instance distinction: templates decide content;
`gen_random_uuid()` supplies each authoritative instance identity.

A mission template and a mission instance are distinct:

- A **mission template** determines what the mission is: focus, title,
  description, duration, difficulty, and reward.
- A **mission instance** is one concrete issuance of that template. Its `id` is
  the template identifier plus a UUID created with `crypto.randomUUID()` when
  available, or `crypto.getRandomValues()` on older supported browsers.

If neither cryptographic browser API exists, the generator uses a monotonic
timestamp-and-sequence fallback for uniqueness without presenting weak random
data as secure. Titles and focus values are never used as unique identity.
Downstream modules continue to receive the unchanged mission definition
contract.

The dashboard renders that object but does not know how it was created. Future rule engines, APIs, or AI-generated missions must preserve this object contract so the presentation layer does not need to be rewritten.

## Mission Lifecycle Boundary

Mission definitions and mission state are separate concepts. `mission-generator.js` answers **what the user should do** and preserves the definition contract: `id`, `focus`, `title`, `description`, `estimatedDuration`, `difficulty`, and `xpReward`. `mission-lifecycle.js` answers **what is happening to that mission** and stores only `missionId`, lifecycle `state`, and whether the completion reward has already been issued.

Valid states are `ready`, `active`, `completed`, `skipped`, and `expired`. Valid transitions are:

- `ready` → `active`, `completed`, `skipped`, or `expired`
- `active` → `completed`, `skipped`, or `expired`
- `completed`, `skipped`, and `expired` are terminal

Every transition returns an immutable result containing `accepted`, `reason`, the next mission snapshot, and an event with `missionId`, `previousState`, `currentState`, `eventType`, `requestedAction`, `xpAwarded`, and `timestamp`. Invalid transitions return `accepted: false`, preserve the current state, and award zero XP.

The controller updates its state before returning an accepted completion. Once completed, the mission is terminal and every later completion request is rejected with zero XP. The dashboard never implements duplicate-completion rules.

The runtime flow is: Dashboard Interaction → Mission Coordinator → Mission Lifecycle → Validated Lifecycle Event → Progression Engine → Dashboard Renderer. Progression receives `event.xpAwarded`, never the raw mission reward from a button click.

## Daily Mission Coordinator Boundary

`mission-coordinator.js` holds the mission returned for the current page and
reconciles authoritative snapshots. In production it does not own the logical
day, decide whether a mission should exist, or select replacement content. Its
local generation path remains only for historical tests and compatibility.

When created, the coordinator requests exactly one definition from the injected generator and creates exactly one lifecycle controller. It exposes an immutable snapshot:

```js
{
  currentMission: {
    definition,
    lifecycle
  },
  history,
  dailyStatus: {
    state,
    hasCurrentMission,
    canRequestReplacement,
    replacementsUsed,
    replacementsRemaining
  }
}
```

The coordinator routes `start`, `complete`, `skip`, and controlled `expire` actions into the current lifecycle instance and returns the validated lifecycle event with the next coordinator snapshot. Only one current mission exists. Ready and active missions cannot be replaced. A completed, skipped, or expired mission can be replaced only through the explicit `requestReplacement()` action, and only once per page session. Replacement requests never award XP and always create a new lifecycle controller.

Every accepted terminal event creates one immutable in-memory history record:

```js
{
  missionId,
  title,
  focus,
  finalState,
  xpAwarded,
  terminalAt
}
```

The history contract uses `terminalAt` for completed, skipped, and expired missions so consumers do not need state-specific timestamp fields. History is durable and now also records skill attribution, but it still has no user-facing page.

## Future Persistence, Scheduling, and Recurrence Boundaries

A future repository should restore the current definition, lifecycle state, completion-award status, history, replacement count, and authoritative daily-session identity. It should preserve the coordinator snapshot boundary rather than exposing storage details to the dashboard.

Sprint 9 owns timezone-aware daily boundaries without a browser timer or
scheduler. On the first request after a logical-day change, PostgreSQL expires
stale `ready`/`active` missions with zero XP, inserts duplicate-safe history,
and creates the new day atomically. Completed/skipped/expired rows remain
historical and are never overwritten.

Timezone changes take effect on the next request. Because changing timezone
can move the logical date backward or forward, the current product should expose
timezone editing only in a future authenticated settings UI with confirmation;
the unique `(user_id, daily_key)` constraint prevents duplicates either way.

Recurring missions may later extend definitions with backward-compatible metadata such as `recurrence`, `schedule`, and `frequency`. Those fields should be added only when generation and scheduling rules consume them. Definitions may come from templates, backend rules, recurring schedules, or AI while preserving the existing required mission contract.

## Progression Boundary

`progression.js` is the central derivation engine for both overall and skill
progression. PostgreSQL applies the authoritative rewards; the engine receives
stored totals and derives immutable level snapshots for rendering. Historical
prototype tests still exercise `addXP`, but production code never uses it to
authorize or persist an award. The dashboard must never calculate levels, XP
requirements, percentages, or remaining XP.

The progression snapshot contains `configuration`, `currentLevel`, `currentXP`,
`currentLevelXP`, `nextLevel`, `xpForNextLevel`, `xpRemaining`,
`progressPercentage`, and `isMaxLevel`. Future achievements or AI
recommendations should consume authoritative totals and these snapshots rather
than duplicating this math.

## Future Reusable Components

Navigation, Sidebar, XP Card, Mission Card, Skill Card, Achievement Card, Statistic Card, Progress Bar, Modal, Buttons, Notifications, and Charts.

## Naming Convention

- Files: lowercase and dash-separated.
- Variables: camelCase.
- Classes: BEM.
- Functions: verb first.

Examples: `dashboard.html`, `mission-card.js`, `xp-progress.css`, `renderDashboard()`, `updateXP()`, `createMission()`, and `saveVault()`.

## Development Workflow

1. Define the problem.
2. Design the solution.
3. Build the feature.
4. Test locally.
5. Review.
6. Commit.
7. Push.
8. Deploy.

No shortcuts.

## Sprint Workflow

Each sprint contains a goal, acceptance criteria, tasks, implementation, review, and deployment.

## AI Workflow

- Sensei: Product architecture, folder structure, planning, and code review.
- Claude: Implementation, boilerplate, and components.
- Doug: Founder and developer.

## Sprint 10.1 UUID Hotfix Boundary

A live Supabase request exposed PostgreSQL error `42883` because the internal
Sprint 9 creation functions called `public.gen_random_uuid()`. The project uses
an explicit empty `search_path` for privileged functions, and Supabase's
pgcrypto installation exposes the generator in the `extensions` schema rather
than `public`.

Migration 009 replaces only the two active internal definitions retained by
the Sprint 9.2 wrappers:

- `request_daily_mission_at_sprint9(timestamptz)`
- `request_daily_mission_replacement_sprint9()`

Both now call `extensions.gen_random_uuid()` explicitly. The public
zero-argument daily and replacement RPCs, `nextResetAt` wrapper, server-time
daily key, advisory locking, lifecycle rules, canonical rewards, replacement
limit, skill attribution, and immutable client reconciliation remain
unchanged. UUID identity stays inside PostgreSQL; no identifier-generation
authority moves to the browser.

Migrations are append-only. Migration 006 therefore remains byte-for-byte
unchanged as historical input even though it contains the original bad
qualification. After migration 009 is applied, the active `pg_proc`
definitions no longer contain `public.gen_random_uuid()`.

## Sprint 11 Achievement Authority

Achievements are a server-owned projection of verified account history. The
browser submits the unchanged mission intent `{ missionId, action }`. Inside
the same locked `request_vault_mission_action(text, text)` transaction,
PostgreSQL validates the lifecycle transition, commits canonical overall and
skill XP, writes terminal history, evaluates milestone predicates, and inserts
new `(user_id, achievement_key)` rows with the database timestamp. The primary
key plus `ON CONFLICT DO NOTHING` makes lifetime unlocks idempotent under
duplicate and concurrent requests.

The client restores the fixed catalog through `get_achievement_catalog()` and
the authenticated user's earned rows through `get_user_achievements()`. Both
RPCs take zero arguments. The application service merges those read-only
results into the immutable `achievements` snapshot and reconciles only the
`newAchievements` returned by an accepted server completion. The dashboard
formats that snapshot; it never evaluates eligibility or creates an unlock.

The existing dashboard shell now exposes its previously disabled Achievements
navigation target. Unlocked cards show authoritative metadata and timestamp.
Visible locked cards show `Locked`; hidden locked cards conceal their name and
description as `?????`. The completion notice renders every newly returned
achievement, uses a polite status, dismisses automatically, and removes motion
when reduced motion is requested.

Three- and seven-day streak definitions are cataloged for future compatibility
but have no evaluator predicates. Sprint 11 does not infer consecutive days
from presentation clocks or fabricate a streak without a dedicated
authoritative streak model.

## Sprint 11.1 Development Test Clock Boundary

Sprint 11.1 is staging infrastructure, not a product feature. The production
dashboard loads only an inert frontend gate. The panel repository, panel code,
and panel stylesheet are requested only when the build explicitly enables
development tools and the current hostname exactly matches the build allowlist.
Known KVNX production domains are always rejected by the loader.

The browser gate is convenience, not authority. Migration 012 adds two
independent server controls that default closed: one singleton environment flag
and an explicit authenticated test-account allowlist. A privileged function
must pass both checks before it can read or mutate that account's isolated
`dev_test_state` row. Those tables have RLS enabled, no browser policies, and no
browser grants. The RPCs accept no user id or arbitrary value.

```text
Approved staging build + exact host
→ authenticated allowlisted test account
→ disabled-by-default database environment gate
→ zero-argument dev clock action
→ current user's simulated timestamp only
→ normal authoritative mission/XP/skill/achievement RPC
→ immutable application restoration
```

The existing internal clock-injectable daily engine remains the source of new
missions and rollover. Production mission RPC signatures are unchanged.
`dev_effective_vault_now()` returns a simulated instant only for an allowlisted
account while the staging environment flag and that account's clock are
enabled; all other calls return `clock_timestamp()`. Completion still awards
25 overall XP and 15 mapped skill XP and invokes the Sprint 11 achievement
evaluator. Clearing the row immediately restores real database-time behavior.

A separate Supabase staging project is the supported deployment. Migration 012
is hard-disabled if accidentally installed on production, but deliberately
enabling its server flag on a production database is outside the supported
architecture.

## Sprint 12 Vault History & Legacy

The Vault is a read-only projection of `mission_history`, not a second history
store. Migration 013 retains the table and its existing
`(user_id, terminal_at DESC)` index, then adds only the two archival attributes
that could not survive the single current-mission row: mission description and
the lifecycle state immediately before the terminal transition. An internal
`BEFORE INSERT` trigger copies both from the authoritative saved mission while
the completion transaction still holds the original state. Older values remain
null when they cannot be proven; the UI identifies that limitation instead of
inventing content.

```text
Authoritative mission completion
→ existing mission_history insert
→ internal archive-detail trigger
→ existing skill and achievement authority
→ zero-argument get_vault_history()
→ bounded range page
→ immutable application history snapshot
→ grouping, search, filters, and entry details
```

`get_vault_history()` is an exact zero-argument `SECURITY DEFINER` read with an
empty `search_path`. It derives the owner from `auth.uid()`, returns completed
rows only, and orders by completion timestamp and history UUID descending.
Primary skill metadata comes from `skill_catalog`. Achievements appear on an
entry only when an existing `user_achievements.unlocked_at` exactly matches the
authoritative completion timestamp; no client or query heuristic assigns them.

The RPC returns a relation so Supabase/PostgREST range windows paginate the
ordered result without adding an owner argument. The repository requests 21
rows for a 20-row page, returns 20 immutable entries, and uses the extra row
only to expose `hasMore`. The application service merges later pages by stable
history identity and includes both `history` and `historyPagination` in every
public immutable snapshot. Refresh and later login execute the same restoration
contract.

Today, Yesterday, Earlier This Week, Earlier This Month, and Older are local
presentation groups. Search matches loaded authoritative title, category, and
skill values. Achievement, skill, category, and chronological controls filter
or sort only the loaded snapshot. They never query another owner or mutate a
history row. Long-term growth is handled through additional bounded pages, so
years of records are not loaded in one request.

The existing dashboard shell now activates the Vault navigation target. Each
completed entry exposes date, title, category, primary skill, canonical overall
and skill XP, exact-timestamp achievements, and status. Its keyboard-operable
summary expands authoritative description, completion timestamp, rewards,
unlocks, and original state. No separate task list, editable history, or fake
archive data is introduced.

## Sprint 13 Analytics & Insights

Analytics is a read-only aggregate projection, not a second event system. The
authoritative sources remain completed `mission_history` rows and persisted
`user_achievements` rows. Migration 014 adds one narrow RPC and does not add a
table, event writer, trigger, or index.

```text
Analytics period intent: 7d | 30d | all
→ Application Service
→ User Repository validation
→ get_vault_analytics(text)
→ auth.uid() owner boundary
→ authoritative server aggregation
→ deeply frozen application snapshot
→ accessible metrics and native DOM/CSS charts
```

The browser may select only a bounded period identifier. It never supplies an
owner, start or end date, mission count, XP value, skill value, achievement
count, or historical row. The repository rejects unsupported periods and
malformed responses, normalizes nonnegative integer values and ISO dates, and
deeply freezes the result. The application service owns restoration and shares
duplicate concurrent requests for the same period. Analytics failure is
isolated to the Analytics view; it does not invalidate the restored dashboard
session or enable a mutation path.

`7d` includes the current UTC calendar date and six prior UTC dates. `30d`
includes the current UTC date and twenty-nine prior UTC dates. Both return a
zero-filled daily series so inactivity is visible without client inference.
`all` includes every authenticated-owner completed history row and returns only
dates that contain activity, avoiding a synthetic multi-year calendar. Active
Days means distinct UTC dates with one or more completed missions. It is not a
current streak, longest streak, or achievement eligibility calculation.

Overview totals, mission activity, and XP activity use the saved canonical
awards in `mission_history`. Skill Development groups the saved
`skill_xp_awarded` values and labels its bars as relative XP earned during the
selected period; those bars are not skill-level progression. Most Developed
Skill sorts by period XP descending, then catalog order and skill key for a
deterministic tie. Achievement insight counts only persisted unlock timestamps
within the selected period and never evaluates eligibility.

The existing dashboard shell activates the Analytics navigation target and
retains the established visual language. Loading shows no fake metrics. An
account without completed history receives an intentional empty state. A
recoverable error offers retry without destroying the rest of the dashboard.
Charts use native semantic DOM/CSS, expose concise text labels plus hidden data
tables, work without color, stack responsively, and stop decorative motion when
reduced motion is requested.

## Sprint 14 Authoritative Consistency Streaks

Streaks are persisted progression derived from the same authoritative logical
day already attached to daily missions. They are not derived from browser time,
login activity, Analytics windows, or the currently loaded Vault page.

```text
Accepted mission completion
→ locked daily mission and canonical daily_session_id
→ authoritative completed mission_history insert
→ atomic streak trigger and owner-row lock
→ existing achievement evaluator
→ immutable completion response and restoration snapshot
```

`user_streak_state` stores one row per authenticated owner: current streak,
longest streak, and last completed logical day. The first completed day creates
`1 / 1`. An equal or earlier day is idempotent. Exactly one following calendar
day increments the current streak. Any later day resets current to one while
preserving the maximum. The trigger runs only for completed history inserts,
so skipped, expired, rejected, and duplicate transitions cannot advance it.
Two completed missions with the same authoritative daily key still count once.

The completion RPC remains the Sprint 11.1 authority behind an internal name.
A narrow wrapper preserves its two intent arguments and appends a streak
snapshot only after an accepted `mission.completed` event. Because migration
012's function still chooses `dev_effective_vault_now()`, approved staging
accounts exercise the exact same streak trigger with simulated logical days.

`get_vault_streak()` accepts no arguments, derives identity from `auth.uid()`,
and returns global progression independent of an Analytics period. The
repository validates calendar dates and numerical invariants, freezes the
response, and the application service restores it on every authenticated
initialization. Dashboard and Analytics surfaces only format those values;
Active Days remains its separate Sprint 13 period metric.

## Sprint 15 Authoritative Mission Catalog

Mission variety now comes from `mission_catalog`, a protected server-managed
catalog. The production dashboard no longer loads the legacy JavaScript mission
generator. It requests a mission with the existing zero-argument RPC and can
only render the authoritative definition returned by PostgreSQL.

```text
request_daily_mission()
→ auth.uid() + effective server clock
→ saved timezone logical day
→ saved onboarding primary focus
→ protected active catalog candidates
→ recent authoritative assignment/history check
→ deterministic server selection
→ server UUID + fixed 25 XP + canonical skill
→ existing daily_mission_state lifecycle
```

The catalog contains six templates for each canonical onboarding focus:
Career, Business, Programming, Fitness, Health, Learning, Creativity, Finance,
Relationships, and Mindset. Six General templates safely support custom focus
text. General selection preserves the user's saved display focus while using
the canonical Problem Solving skill.

Selection first avoids the five most recently assigned or completed template
identities. When all candidates have recent use, it chooses the least recently
used candidate. A deterministic hash of owner, authoritative daily key, and
template key breaks ties without client randomness. On replacement, the
current template is ranked last whenever another active candidate exists. A
single valid candidate remains a safe fallback.

Every definition is copied into `daily_mission_state`, including its title,
description, category, duration, difficulty, fixed reward, canonical skill,
and template key. The existing history trigger copies the selected description
and template identity into history during the same authoritative transaction.
Vault History continues reading saved snapshots, never mutable catalog copy.
Older missions remain valid and may retain a null template key when identity
cannot be proven.

Daily creation, replacement, completion, one-replacement enforcement, XP,
skills, achievements, streaks, Vault History, and Analytics retain their prior
RPCs and authority. The Sprint 11.1 effective clock reaches this same catalog
selector; it has no alternate test-mission path.

## Sprint 16 Mission Center

Mission Center is a dedicated presentation and action surface inside the
existing dashboard shell. `#missions` participates in the same hash router as
Dashboard, Achievements, Vault, and Analytics. It does not own or generate a
mission and it does not introduce a second lifecycle.

The responsibility split is intentional:

- Dashboard remains the compact progression overview and keeps its mission card.
- Mission Center presents the full current-mission detail, authoritative
  lifecycle, daily availability, mapped skill, reward, Daily Complete state,
  reset countdown, and five recent completed missions.
- Vault remains the full permanent archive, including filtering, search, and
  pagination. Mission Center links to `#vault` instead of duplicating it.

Mission Center projects the immutable Application Service snapshot. Its current
mission comes from `request_daily_mission()`, its lifecycle and `dailyStatus`
come from the saved daily mission response, its reset comes from server-returned
`nextResetAt`, and its recent list comes from the already restored Vault History
page. The canonical skill display name is resolved through an authenticated,
read-only repository query to the existing `skill_catalog`; catalog mutation
and mission-catalog access are not exposed.

All actions reuse the established path:

```text
Mission Center intent
→ Application Service
→ User Repository
→ existing authenticated RPC
→ immutable authoritative snapshot
→ Dashboard and Mission Center redraw
```

Opening, closing, refreshing, or revisiting `#missions` performs no replacement
and no client selection. Navigation never calls a mission mutation. Same-day
refresh and later login therefore restore the same saved mission instance.
Only explicit Start, Complete, Skip, or Prepare Next Mission controls invoke
their existing authoritative operations. The shared completion result continues
to drive XP/skill feedback and all server-returned achievement notifications.

## Sprint 17 Authoritative Skill Center

Skill Center is a read-only lifetime progression surface inside the existing
dashboard shell. `#skills` uses the same restoration gate and hash router as
Dashboard, Mission Center, Achievements, Vault, and Analytics. The authenticated
product shell remains hidden until the immutable application snapshot is ready,
so a hard refresh cannot expose default skill values or a guest identity.

The responsibility split remains narrow:

- Dashboard keeps the compact Skills Overview and links to `#skills`.
- Skill Center merges the protected canonical `skill_catalog` with the user's
  persisted `skill_progression` totals for active and Not Started presentation.
- Vault remains the permanent mission archive. Skill detail shows at most five
  attributed gains from the already restored bounded history window and links
  to `#vault` for the full archive.
- Analytics remains selected-period insight. Skill Center totals are lifetime
  authoritative progression and never derive from an Analytics period.

Level, current-level percentage, and XP remaining are presentation projections
of authoritative total skill XP through the existing `KVNXProgression` skill
configuration. Sprint 17 adds no threshold table or reward formula. A completion
still crosses the established Application Service and Repository action path;
its returned immutable snapshot redraws both Skills Overview and Skill Center.

Most-recent development and recent-gain rows require saved history attribution,
a positive server-returned skill award, completed state, and a valid completion
timestamp. Legacy rows without skill attribution are omitted instead of being
inferred from current mission copy. The initial bounded Vault page is reused;
opening Skill Center adds no network request and never downloads history once
per skill.

Filters, sorting, disclosure panels, and Vault navigation operate only on the
restored immutable snapshot. They cannot write skill XP, select a mission,
submit rewards, unlock achievements, or alter streaks. No database migration or
new read contract is required.

## Sprint 18 Authoritative Achievement Center

Achievement Center is the detailed read-only milestone surface at
`#achievements`. Dashboard completion feedback remains compact and continues to
render only `newAchievements` returned by the accepted server transaction;
Achievement Center never evaluates eligibility or creates an unlock.

The immutable application snapshot supplies persisted catalog/unlock state,
overall progression, skill progression, and streak state. Presentation merges
that authoritative data into Unlocked and Locked groups, summary totals, the
most recent persisted unlock, conservative requirement copy, and only progress
that can be proven from restored totals. Overall-XP bars use authoritative
account XP. First-skill progress uses positive persisted skill progression.
Unlocked consistency milestones may display current and longest authoritative
streak context. Mission causality is omitted because the current contract does
not persist an exact unlock-to-mission relationship.

Migration 017 narrows the existing zero-argument catalog read for hidden
confidentiality. A locked hidden catalog row is returned only as an approved
placeholder with null key/category and masked copy/icon. PostgreSQL reveals the
real definition only when the authenticated owner has a matching persisted
`user_achievements` row. The repository validates that exact placeholder shape,
and the Application Service defensively redacts locked hidden definitions again
before producing a public immutable snapshot.

```text
authenticated restoration
→ redacted achievement catalog + persisted owner unlocks
→ immutable application snapshot
→ Achievement Center summary, filters, and cards

accepted mission completion
→ existing PostgreSQL evaluator
→ persisted user_achievements + newAchievements
→ immutable snapshot reconciliation
→ existing notification + Achievement Center redraw
```

Hard refresh remains behind the Sprint 16.1 protected-content gate. Filters and
progress bars operate only on restored data and submit no identity, XP, skill
XP, streak, eligibility, or achievement state.

## Sprint 19 Authoritative Daily Mission Choice

Sprint 19 adds a persisted pre-lifecycle state without creating a second
mission system. When no `daily_mission_state` exists for the authenticated
logical day, the normal zero-argument daily RPC locks the existing owner/day
advisory key and creates or restores one `daily_mission_choice_state` row. That
row contains one to three exact server-built option snapshots from the active
Sprint 15 catalog. Existing daily missions bypass this path and restore without
modification.

Choice ranking reuses saved onboarding focus, active canonical skill mappings,
and authoritative recent template usage. Unused templates rank first, followed
by least-recently-used templates, then a deterministic owner/day/template hash.
The first three valid candidates are persisted. Because the row is written once
under the daily lock, refresh, route changes, logout/login, and simultaneous
daily requests cannot reroll the options.

```text
request_daily_mission()
→ auth.uid() + effective server clock + saved timezone
→ current logical day + saved onboarding focus
→ existing mission? restore it
→ existing choice set? restore it
→ otherwise rank active catalog candidates and persist up to three

selectDailyMission(choiceId)
→ Repository sends one opaque UUID
→ PostgreSQL locks the owner/day state
→ validates exact offered membership
→ creates one server-UUID mission from the trusted option snapshot
→ existing lifecycle, replacement, completion, history, progression,
  achievement, and streak authorities continue unchanged
```

The immutable Application Service snapshot represents either `dailyChoice`
with no coordinator, or an existing coordinator mission. Dashboard and Mission
Center render the same frozen option array and call the same Application Service
method. They submit no title, description, template, reward, skill, focus,
owner, daily key, date, timezone, or lifecycle state.

Selection itself creates no history, awards no XP or skill XP, changes no
streak, and evaluates no achievement. The existing single server-selected
replacement remains the only post-selection change mechanism. This bounded
offer → opaque selection → server lock contract is the reusable authority
foundation for later Skill Paths, but Sprint 19 adds no multi-focus selection,
Side Missions, Fitness-specific behavior, or additional XP economy.

## Sprint 20 Server-Authoritative Skill Paths

Sprint 20 adds `user_skill_paths` as a separate preference domain. It does not
reinterpret `skill_progression`: positive lifetime XP still means a skill has
verified progress, while `pathActive` means only that the authenticated user
currently intends to develop that canonical skill. Any combination is valid:
inactive or active path, with zero or positive lifetime XP.

```text
Skill Center intent
→ Application Service
→ User Repository sends one canonical skill key
→ authenticated SECURITY DEFINER RPC
→ auth.uid() + active skill_catalog validation
→ soft owner/skill path state
→ validated frozen snapshot reconciliation
```

`get_skill_paths()` is a zero-argument restoration read. Activation and
deactivation are idempotent, serialized for one owner/skill pair, and return
the authoritative row. Deactivation is soft state; it cannot delete lifetime
progression or Vault history. The browser cannot create skills or submit a
display name, owner, XP, level, reward, mission, date, or timezone.

Skill Center merges the path slice with the existing catalog/progression view.
“With Progress” remains XP-based; “Developing” is path-based. An active path
with zero XP stays a compact, non-expandable Not Started card. The restoration
gate remains closed until path restoration succeeds.

Sprint 19 is deliberately not integrated. Path mutations do not read or write
Daily Mission Choice, reroll choices, create missions, alter onboarding focus,
or affect today's mission. A later bounded mission layer may use active paths
as server-owned eligibility input, but Sprint 20 implements no such economy.

## Sprint 21 Authoritative Skill Path Mission Offers

Sprint 21 adds a planning layer beside the existing Daily Mission system. An
authenticated user may request bounded practice offers only for a currently
active canonical development path. PostgreSQL derives the owner, effective
server time, saved timezone, logical day, canonical skill, eligible catalog
pool, recent authoritative use, and stable offer set. The browser submits only
the canonical path key when requesting a set and one opaque UUID when selecting
an offered item.

```text
Explore Missions
→ Application Service
→ Repository
→ authenticated offer RPC
→ active owner path + canonical skill validation
→ stable owner/day/skill offer row (zero to three snapshots)

Select Practice
→ one opaque offered UUID
→ exact persisted membership + current-day validation
→ planned state only
```

Offer rows are unique by owner, logical day, and skill. An owner/day/skill
advisory lock makes simultaneous requests converge; a row lock makes duplicate
selection idempotent and prevents a conflicting selection from replacing the
planned item. Repeated request, refresh, route changes, and logout/login restore
the same row. Paused paths cannot request or select offers.

This layer intentionally creates no mission instance or second lifecycle.
Requesting, viewing, or selecting an offer writes no mission history and changes
no overall XP, skill XP, streak, achievement, Analytics value, Daily Mission
Choice, replacement allowance, or Daily Complete state. The immutable
Application Service snapshot carries the restored planning state, and the Skill
Center renders it in a separate panel so zero-XP path cards remain compact.

The offer catalog pool uses the canonical mission-to-skill mapping. Migration
020 adds path-only templates for the three skills that previously lacked
eligible templates; the `skill_path` focus is outside every Sprint 19 onboarding
focus map, so primary Daily Mission selection remains unchanged.

## Sprint 21.1 Production Effective-Clock Compatibility

Production intentionally omits staging-only Migration 012, but later
authoritative functions call its internal `dev_effective_vault_now()` boundary.
Migration 021 closes that deployment-variant gap without installing any
developer infrastructure.

At migration time, PostgreSQL resolves the exact zero-argument signature with
`to_regprocedure('public.dev_effective_vault_now()')`:

- If it exists, the migration performs no operation. Staging retains Migration
  012's environment gate, account allowlist, per-owner simulated state, and
  real-clock fallback unchanged.
- If it does not exist, production receives a zero-argument internal helper
  whose complete result is `pg_catalog.clock_timestamp()`. The helper has no
  environment switch, offset, simulated state, identity, or browser input.

Direct execution is revoked from `public`, `anon`, and `authenticated`. Existing
`SECURITY DEFINER` authorities continue to call the helper internally under the
database owner. No frontend contract changes, and the browser remains unable to
supply time, dates, daily keys, timezones, or owners.

The compatibility boundary resolves the active production dependency in the
Sprint 15 catalog mission builder, Sprint 19 Daily Mission Choice selection,
and all three Sprint 21 Skill Path offer read/request/selection functions. It
does not alter their mission, reward, lifecycle, progression, or logical-day
logic.
