# KVNX Vault Sprint History

## Sprint 0

Status: ✅ Complete

Goal: Create the first official KVNX Vault landing page.

Completed: Initial landing page, hero section, features section, roadmap section, footer, responsive layout, and initial animations.

Result: The project officially launched as a public landing page.

## Sprint 0.5

Status: ✅ Complete

Goal: Refine the landing page to production quality.

Completed: Accessibility improvements, metadata, Open Graph tags, Twitter cards, better animations, responsive improvements, CSS cleanup, JavaScript optimization, and performance improvements.

Result: Landing Page v1.0 completed.

## Sprint 1

Status: ✅ Complete

Goal: Build the application shell.

Completed: Login page, dashboard, responsive sidebar, top navigation, reusable application components, dashboard cards, placeholder data, and mobile shell navigation.

Definition of Done: The landing page remains unchanged. The user can navigate Landing Page → Login → Dashboard.

Result: The application foundation is ready for authentication work while the landing page remains frozen at v1.0.

Notes: No authentication, backend, database, XP logic, or feature logic. Layout only.

## Sprint 2

Status: ✅ Complete

Goal: Build the complete first-time onboarding experience.

Completed: Create-account shell, first-name handoff, six-question conversational onboarding, accessible progress and validation, custom responses, cinematic Vault introduction, temporary session-scoped state, and personalized dashboard placeholders.

Definition of Done: A new user can navigate Login → Create Account → Welcome → Onboarding → Vault Introduction → Personalized Dashboard. The landing page remains frozen at v1.0.

Result: KVNX Vault can now understand a new user's direction and prepare a meaningful first dashboard without authentication, a backend, a database, or durable persistence.

Notes: Email and password values are never submitted or stored. Onboarding answers exist only in the current browser-tab session. The founder-directed onboarding sprint replaces the previously planned Sprint 2 authentication slot.

## Sprint 3

Status: ✅ Complete

Goal: Build the personalized first-mission prototype.

Completed: Reusable rule-based mission generator, onboarding-to-mission mapping, personalized first-mission card, accessible completion feedback, a +25 XP placeholder update, and responsive mission presentation.

Definition of Done: After onboarding, the dashboard generates one mission from the user's primary focus. Completing it produces a calm success state and updates placeholder XP without durable persistence.

Result: KVNX Vault can now turn a user's stated direction into one immediate action without AI, a backend, a database, or a full XP system.

Notes: The mission generator and dashboard communicate through a stable mission object. Completion state is page-scoped and resets on refresh. The founder-directed mission sprint replaces the previously planned Sprint 3 authentication slot.

## Sprint 4

Status: ✅ Complete

Goal: Build the first reusable XP and level system.

Completed: Central progression engine, configurable five-level curve, immutable progression snapshots, mission-reward integration, automatic XP-card rendering, level-up detection, and a restrained level-up notification.

Definition of Done: Completing the first mission sends its XP reward through the progression engine. The dashboard renders the returned level, total XP, next threshold, remaining XP, and progress percentage without calculating progression itself.

Result: KVNX Vault now has a reusable, session-only progression boundary that can grow into skills, achievements, persistence, or AI-assisted guidance without coupling those systems to the dashboard.

Notes: Progression is page-scoped and resets on refresh. No authentication, backend, database, local storage, mission history, statistics, achievements, or AI were added. The founder-directed progression sprint supersedes the previously planned complete mission-engine sprint.

## Sprint 5

Status: ✅ Complete

Goal: Mission lifecycle foundation.

Completed: Separate mission-definition and mission-state boundaries, reusable lifecycle controller, ready/active/completed/skipped/expired states, validated immutable lifecycle events, start and skip interactions, expiration support, duplicate-completion protection, lifecycle-to-progression integration, restrained mission-state presentation, and framework-free automated tests.

Definition of Done: The dashboard requests mission actions but never decides mission state. Progression receives XP only from an accepted lifecycle completion event. Completed, skipped, and expired missions cannot award XP again, and all required transitions pass automated tests.

Result: KVNX Vault now has a reusable mission lifecycle foundation that can later support daily missions, recurring missions, history, achievements, backend validation, and AI-generated definitions without coupling those responsibilities to the dashboard.

Notes: Lifecycle state remains page-scoped and resets on refresh. Expiration is available through a controlled lifecycle action but no real clock or scheduler was added. No authentication, backend, database, persistence, history UI, statistics, notifications, achievements, or AI were introduced.

## Sprint 6

Status: ⏳ Planned

Goal: Daily mission orchestration prototype.

Planned: Add a page-scoped daily mission coordinator, one-mission-per-day selection rules, explicit generation/lifecycle orchestration, in-memory history records, and broader integration tests without persistence or real scheduling.

## Sprint 7

Status: ⏳ Planned

Goal: Authentication.

Planned: Authentication-provider selection, real account creation, sign-in, session handling, protected routes, logout, recovery, accessible server errors, and migration of temporary state into the user profile.
