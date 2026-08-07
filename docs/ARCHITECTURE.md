# KVNX Vault Architecture

Version: 1.1

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
    dashboard.js
    missions.js
    skills.js
    vault.js
  components/
  docs/
```

## Navigation Flow

Landing Page → Login → Create Account → Onboarding → Vault Introduction → Dashboard → All Application Features.

The landing page is public. Everything else belongs to the application.

## Application State Boundaries

Sprint 2 onboarding data is temporary and session-scoped. `onboarding-state.js` is the single interface for reading, writing, and clearing that state. It uses `sessionStorage` only so the create-account, onboarding, and dashboard pages can share placeholder personalization during the current browser-tab session.

This temporary state is not an account system and must not store email addresses, passwords, authentication tokens, or durable user records. A future backend should replace this adapter without requiring the onboarding UI to be rewritten.

## Onboarding Philosophy

Onboarding learns direction, not personality. Each screen asks one clear question, required choices are validated in context, and answers are collected only when they directly shape the first dashboard. The final Vault introduction lives within `onboarding.html` to prevent a visual flash between onboarding and the dashboard handoff.

## Dashboard Philosophy

The dashboard is the command center. It should answer one question immediately: “What should I do next?” Everything unnecessary should be removed.

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
