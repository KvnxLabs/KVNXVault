# KVNX Vault Architecture

Version: 1.5

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

Current frontend: HTML5, CSS3, and vanilla JavaScript.

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
  docs/
```

## Navigation Flow

Landing Page → Login → Create Account → Onboarding → Vault Introduction → Dashboard → All Application Features.

The landing page is public. Everything else belongs to the application.

## Application State Boundaries

Sprint 2 onboarding data is temporary and session-scoped. `onboarding-state.js` is the single interface for reading, writing, and clearing that state. It uses `sessionStorage` only so the create-account, onboarding, and dashboard pages can share placeholder personalization during the current browser-tab session.

This temporary state is not an account system and must not store email addresses, passwords, authentication tokens, or durable user records. A future backend should replace this adapter without requiring the onboarding UI to be rewritten.

Sprint 3 mission completion state is intentionally page-scoped. Completing the prototype mission updates only the current dashboard document and resets on refresh. The onboarding answers remain session-scoped so the dashboard can regenerate the same personalized first mission during the current browser-tab session.

Sprint 4 progression state is also page-scoped. `progression.js` owns XP totals, level thresholds, level-up detection, and derived progress values. Its level configuration is the only place where the prototype curve is balanced. Refreshing the dashboard creates a fresh progression instance; no progression value is written to browser storage.

Sprint 5 mission lifecycle state is page-scoped and owned by `mission-lifecycle.js`. Each generated mission definition receives a separate lifecycle controller when the dashboard loads. Refreshing the page creates a new `ready` state. The lifecycle controller is the only authority that can accept or reject state transitions and issue validated XP-bearing completion events.

Sprint 6 daily mission state is page-scoped and owned by `mission-coordinator.js`. The coordinator requests one definition, creates its lifecycle controller, holds terminal history in memory, and enforces the one-replacement limit. Refreshing the dashboard creates a new coordinator and clears its current mission, history, and replacement count. None of this state is written to `sessionStorage`, `localStorage`, or a backend.

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
