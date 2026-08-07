# KVNX Vault Architecture

Version: 1.4

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
    progression.js
    dashboard.js
    missions.js
    skills.js
    vault.js
  components/
  tests/
    mission-lifecycle.test.js
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

The runtime flow is: Dashboard Interaction → Mission Lifecycle → Validated Lifecycle Event → Progression Engine → Dashboard Renderer. Progression receives `event.xpAwarded`, never the raw mission reward from a button click.

## Future Daily Scheduling Boundary

A future scheduler should decide which definition becomes today's one mission and when an unfinished mission should receive an `expire` action. It should not mutate mission state directly. Completed missions should move to history before the next daily definition is selected. Mission definitions may later come from templates, backend rules, recurring schedules, or AI while preserving the same generator contract. Production time, recurrence, history, and cross-device conflict resolution belong to a backend boundary; Sprint 5 does not simulate background time or durable scheduling.

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
