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

Status: ✅ Complete

Goal: Daily Mission Coordinator.

Completed: Page-scoped daily mission coordinator, generator and lifecycle orchestration, immutable coordinator snapshots, one-current-mission ownership, explicit terminal-only replacement, one-replacement limit, controlled expiration route, in-memory terminal history, dashboard integration, and framework-free coordinator tests.

Definition of Done: The dashboard receives one current mission from the coordinator and routes all mission actions back through it. Ready and active missions cannot be replaced. Terminal missions create history, may be replaced explicitly once, and progression receives XP only from an accepted lifecycle completion event.

Result: KVNX Vault now has a deterministic coordination layer between onboarding direction, mission generation, lifecycle validation, progression, and presentation. The architecture can later gain durable daily sessions, backend scheduling, recurring missions, and AI-selected definitions without moving those responsibilities into the dashboard.

Notes: Coordinator state and history reset on refresh. Expiration remains a controlled architecture action. No authentication, database, persistence, local storage, server scheduling, history UI, achievements, statistics, notifications, or AI were introduced.

## Sprint 7

Status: ✅ Complete

Goal: Authentication and durable identity foundation.

Completed: Supabase email/password authentication, signup confirmation handling, sign-in, sign-out, authenticated session restoration, reusable protected-route decisions, durable profile/onboarding/progression/daily-mission/history repositories, transactional mission persistence, Row Level Security policies, browser-daily identity design, accessible failure states, and framework-free authentication/restoration tests.

Definition of Done: Unauthenticated application access returns to login. Authenticated users route according to durable onboarding completion. Existing onboarding, mission, lifecycle, coordinator, and progression contracts restore through service/repository adapters. Mission transitions, XP, and optional history commit atomically under the authenticated user. All pre-existing tests remain unchanged and passing.

Result: KVNX Vault now has secure multi-user identity and durable state boundaries without coupling Supabase to the dashboard or domain engines. RLS prevents users from accessing one another's records, while the application service preserves the existing direction → mission → lifecycle → progression → renderer architecture.

Notes: The browser uses only the public Supabase URL and publishable key. No service-role key, database password, social login, magic link, MFA, password reset, admin role, analytics, AI, or server scheduler was added. Static route guards protect presentation flow; RLS protects data. Mission/XP rules remain client-side prototypes and should become server-authoritative in a later sprint.

## Sprint 7.1

Status: ✅ Complete

Goal: Correct the security and deployment configuration boundaries before connecting Supabase.

Completed: Removed generic client progression/mission write methods from the production repository, introduced an intent-only mission-action contract, revoked the legacy browser-supplied XP RPC and direct mission/progression/history writes, added a database-owned baseline initializer, labeled the interactive mission flow as session-only until Sprint 8, corrected Supabase Auth guidance for the Vault Vercel deployment, and removed the unrelated company-domain CNAME from the Vault package.

Definition of Done: UI code has no preferred API for setting arbitrary XP totals. Durable mission requests contain only mission id and action. The legacy `p_total_xp` function is not executable by authenticated clients. RLS limits cross-user access while documentation explicitly states its same-user integrity limit. Supabase Site URL and redirects point to KVNX Vault, not the KVNX Labs company homepage. All Sprint 7 tests remain unchanged and passing.

Result: Sprint 7's identity and restoration architecture is preserved, while the unsafe implication that client results are authoritative has been removed. Sprint 8 can implement trusted validation behind the new intent contract without changing dashboard actions or domain-engine responsibilities.

Notes: This correction is not Sprint 8. Prototype mission actions and XP feedback remain page-scoped. The new SQL action function intentionally refuses mutation until trusted transition and reward rules are implemented.

## Sprint 7.2

Status: ✅ Complete

Goal: Correct prototype progression persistence without starting Sprint 8 or reopening the generic client-authoritative XP boundary.

Completed: Connected accepted prototype completion events to a narrow application-service/repository persistence adapter, added a database-bounded prototype progression function, persisted accepted coordinator replacements through a separate zero-XP adapter, reset the replacement lifecycle to ready while preserving the consumed replacement count, persisted the completed lifecycle state alongside progression, restored earned XP and the replacement mission across refresh and later login, preserved the intent-only mission action contract, and added framework-free refresh/login/replacement persistence coverage.

Definition of Done: A mission completion still passes through lifecycle and progression first. Only the resulting accepted completion event and immutable progression snapshot can reach the transitional completion adapter. Only an accepted coordinator replacement event and snapshot can reach the separate replacement adapter. PostgreSQL locks the current rows, reads the saved mission reward, computes the permitted next total, rejects mismatched snapshots, prevents replay, and persists one replacement without accepting or changing XP. All prior tests remain unchanged and passing.

Result: The real integration bugs that reset progression to 75 XP and left the replacement mission only in memory are fixed while the Sprint 7.1 RLS, direct-write revocations, repository abstraction, and intent-only Sprint 8 boundary remain intact. The validated prototype sequence now restores 75 → 100 → replacement → 125 across refresh and later login.

Notes: This is not Sprint 8. The browser still originates the prototype lifecycle event and mission definition, so the adapter is not an authoritative anti-cheat boundary. Sprint 8 remains responsible for trusted action validation, authoritative daily identity, reward selection, audit history, and conflict handling behind `requestMissionAction()`.

## Sprint 7.3

Status: ✅ Complete

Goal: Correct unique mission-instance identity and replacement request recovery without starting Sprint 8 or weakening the Sprint 7.1/7.2 boundaries.

Completed: Separated mission templates from mission-instance identity, assigned a browser-native UUID to every generated mission instance, added a non-random monotonic fallback for environments without Web Crypto, rejected overlapping coordinator replacement requests, and moved replacement-button disabled and `aria-busy` cleanup into a guaranteed finalization path.

Definition of Done: Repeated generation for the same programming focus produces distinct IDs while preserving the mission definition contract. The validated 75 → 100 → replacement → 125 sequence persists and restores across refresh and later login. Failed retryable requests restore the button, concurrent requests cannot create duplicate replacements, and the one-replacement limit remains enforced. All prior security and regression tests remain passing.

Result: Replacement persistence now receives a genuinely new mission-instance ID, so the existing Sprint 7.2 RPC can validate and save mission B without weakening its mission-mismatch check. UI request state recovers reliably, and both the interface and coordinator prevent overlapping replacements.

Notes: This is not Sprint 8. No authentication, RLS, direct-write privilege, XP authority, repository contract, or database function changed. The existing Sprint 7.2 migrations remain sufficient.

## Sprint 8

Status: ⏳ Planned

Goal: Server-authoritative daily boundaries and mission transition validation.

Planned: Move daily-session issuance, lifecycle validation, duplicate completion enforcement, and XP authorization behind trusted server functions while preserving current generator/coordinator/progression contracts and adding timezone settings, conflict handling, audit events, and end-to-end Supabase integration tests.
