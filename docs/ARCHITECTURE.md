# KVNX Vault Architecture

Version: 1.7.2

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

The preferred durable mutation is `requestMissionAction({ missionId, action })`.
The repository sends only intent to `request_vault_mission_action`; it exposes no
generic progression setter. The Sprint 7 RPC that accepted a final XP total is
revoked and deprecated. Sprint 7.1's trusted function intentionally performs no
state mutation yet. Sprint 8 will implement validation, reward selection,
atomic mission/progression/history writes, and the authoritative returned
snapshot behind this contract.

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

This transitional adapter does not make the browser a trusted authority. A user
can modify client code, and the saved mission definition originated in the
client. The database bounds a write to one stored reward, blocks a second saved
completion, and computes the written total itself; Sprint 8 must still move the
actual action validation, daily-session authority, reward selection, and audit
contract behind `requestMissionAction()`.

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

## Mission Generation Boundary

`mission-generator.js` is the single mission-generation interface. Its asynchronous `generateMission()` contract accepts onboarding answers and resolves to a stable mission object containing `id`, `focus`, `title`, `description`, `estimatedDuration`, `difficulty`, and `xpReward`.

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

`mission-coordinator.js` answers **which mission belongs to the current daily page session**. It depends on the mission generator for content and the mission lifecycle engine for transition validation. It does not generate content, calculate XP, render UI, or mutate lifecycle state directly.

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

The history contract uses `terminalAt` for completed, skipped, and expired missions so consumers do not need state-specific timestamp fields. History has no page in Sprint 6 and is not persisted.

## Future Persistence, Scheduling, and Recurrence Boundaries

A future repository should restore the current definition, lifecycle state, completion-award status, history, replacement count, and authoritative daily-session identity. It should preserve the coordinator snapshot boundary rather than exposing storage details to the dashboard.

A future backend scheduler should own timezone-aware daily boundaries and send an explicit expiration command to the coordinator or lifecycle service. It should not mutate state directly. Completed missions should enter durable history before a new daily definition is selected. Sprint 6 uses no timers, intervals, background work, or server time.

Recurring missions may later extend definitions with backward-compatible metadata such as `recurrence`, `schedule`, and `frequency`. Those fields should be added only when generation and scheduling rules consume them. Definitions may come from templates, backend rules, recurring schedules, or AI while preserving the existing required mission contract.

## Progression Boundary

`progression.js` is the central progression engine. A validated mission-completion event supplies an XP reward, the progression engine applies that reward, and the dashboard renders the returned immutable snapshot. The dashboard must never calculate levels, XP requirements, percentages, or remaining XP.

The progression snapshot contains `currentLevel`, `currentXP`, `currentLevelXP`, `nextLevel`, `xpForNextLevel`, `xpRemaining`, `progressPercentage`, and `isMaxLevel`. Future achievements, skill progression, persistent storage, or AI recommendations should consume progression events or snapshots rather than duplicating this math.

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
