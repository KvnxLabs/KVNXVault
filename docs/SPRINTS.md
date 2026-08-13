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

Status: ✅ Complete

Goal: Server-authoritative mission validation and XP awarding.

Completed: Replaced the placeholder intent RPC with trusted PostgreSQL lifecycle validation for start, complete, and skip; canonicalized the saved 25-XP reward; added ordered row locking; applied mission/progression/history mutations atomically; prevented duplicate and concurrent rewards; returned a stable authoritative response; reconciled local coordinator and progression state to the server result; moved the dashboard out of prototype transition mode; revoked authenticated execution of the Sprint 7.2 completion adapter; preserved the hardened one-replacement path; and added framework-free authority and security contract tests plus an exact live integration plan.

Definition of Done: The browser submits only mission id and action. PostgreSQL derives ownership from `auth.uid()`, validates the saved mission and lifecycle, determines reward and final state, awards XP once, records terminal history once, and returns the authoritative state. Two concurrent completions produce one 25-XP award. Refresh and later login restore the same result. Direct authoritative table writes and RLS protections remain unchanged.

Result: KVNX Vault mission completion and XP awarding are no longer trusted client results. The database is the final authority across refreshes, tabs, devices, and repeated calls while the existing generator, lifecycle semantics, coordinator, progression rendering engine, authentication, onboarding, and product design remain intact.

Notes: The browser-derived daily-session id and the separate replacement-definition handoff remain transitional. The replacement function accepts no XP, canonicalizes reward, and preserves the one-replacement rule. No live Supabase test is claimed without project credentials. Server-issued daily identity, timezone rollover, and fully server-selected mission definitions are candidates for Sprint 9.

## Sprint 9

Status: ✅ Complete

Goal: Server-authoritative daily missions.

Completed: Added validated profile timezone storage with a UTC fallback;
server-derived logical dates; one durable mission row per user/day; zero-argument
daily retrieval and replacement RPCs; trusted onboarding-based template
selection; server UUID mission instances; canonical 25-XP rewards; advisory-lock
and unique-constraint idempotency; authoritative rollover expiration with
zero-XP history; current-day Sprint 8 action validation; client reconciliation;
and framework-free daily authority/security tests.

Definition of Done: The browser requests today's mission without sending user
state. Refreshes, logins, tabs, and devices converge on one mission. A new
logical day expires unfinished prior work and creates a distinct mission.
Replacement content is server-selected and remains limited to one. Sprint 8
completion still awards exactly 25 XP once, RLS remains enabled, and direct
authoritative writes remain revoked.

Result: Daily mission existence, identity, content, rollover, and replacement
ownership now live behind PostgreSQL authority. The coordinator and progression
engine remain local reconciliation/display models, while client generation is
compatibility/test-only.

Notes: No live Supabase connection is claimed. Migration 006 must be reviewed
and installed before testing a deployed Sprint 9 client. Onboarding UI remains
unchanged; a future settings sprint may expose timezone preference safely.

## Sprint 9.1 — Daily Complete Experience

Status: ✅ Complete

Goal: Make the exhausted daily-mission state feel clear, rewarding, and
intentional without changing Sprint 9 authority or dashboard structure.

Completed: Added a restrained Daily Complete panel for a completed mission with
zero replacements remaining; rendered the authoritative progression total;
replaced vanished controls with explicit next-day guidance; preserved the
first-completion replacement action; restored the state after refresh and later
login; removed it when the server returns a new daily mission; and added
accessible status, focus-recovery, display-only reset, and security-regression
coverage.

Definition of Done: Daily Complete appears only for
`mission.lifecycle.state === "completed"` together with
`dailyStatus.replacementsRemaining === 0`. It exposes no additional mission
action, performs no XP math, and cannot create or reset a mission. A new daily
server snapshot removes the prior state. All Sprint 1–9 tests remain passing.

Result: After both available missions are completed, the mission card now
communicates a calm end-of-day outcome instead of appearing broken. The panel
shows server-restored XP and “New mission available tomorrow” without inventing
an exact reset time.

Notes: This is a UX polish follow-up, not a backend redesign. Authentication,
RLS, mission limits, XP rules, server-authoritative generation, action RPCs,
repository contracts, and migrations 001–006 are unchanged. No database
migration is required, and no history link is shown because no history route
exists yet.

## Sprint 9.2 — Daily Reset Countdown

Status: ✅ Complete

Goal: Replace static next-day guidance with a trustworthy, display-only
countdown while keeping PostgreSQL authoritative over the logical day.

Completed: Added migration 007 with one internal timezone-aware reset helper;
extended the zero-argument daily and replacement responses with `nextResetAt`;
carried that value through the repository and application snapshot; rendered a
restrained hour/minute countdown only inside Daily Complete; retained the safe
static fallback for missing or invalid timestamps; and added one-time
“New mission ready” accessibility messaging at zero.

Definition of Done: `nextResetAt` comes from authenticated identity, saved IANA
timezone, and database time. No browser payload can provide the reset time. The
timer updates once per minute and cannot create, expire, replace, or reset a
mission. A new mission still appears only through the existing authoritative
`requestDailyMission()` reconciliation. The Sprint 9.1 visibility rule remains
`completed` plus `replacementsRemaining === 0`.

Result: Daily Complete now shows “Next mission in” with a calm `HHh MMm`
display, reaches `00h 00m`/“New mission ready” without local state mutation, and
falls back to “New mission available tomorrow” when the server timestamp is not
usable. Countdown ticks are excluded from live announcements; readiness is
announced once.

Notes: This is a UX and server-time contract follow-up, not a change to daily
mission authority. Authentication, RLS, XP, mission limits, replacement rules,
server mission generation, and action validation remain unchanged. Run
`202608070007_sprint9_2_daily_reset_countdown.sql` after migration 006 before
testing the deployed client.

## Sprint 10 — Skill Progression System

Status: ✅ Complete

Goal: Make every accepted mission completion contribute permanently to one
server-authoritative area of mastery while preserving overall account XP.

Completed: Added a fixed twelve-skill server catalog; user-owned
`skill_progression` rows; RLS and direct-write revocations; server-side
mission-to-skill mapping; `primarySkill` on authoritative mission definitions;
canonical 15-XP skill rewards; atomic overall/skill/lifecycle/history updates;
zero-argument skill restoration with timezone-aware daily gains; shared overall
and skill level configurations; immutable application snapshots; real Skills
Overview rendering; restrained dual-award completion feedback; history skill
attribution; and focused framework-free authority, persistence, concurrency,
security, restoration, and UI tests.

Definition of Done: The browser still sends only mission id and action. One
accepted completion awards exactly 25 overall XP and exactly 15 XP to the
server-selected primary skill. Duplicate and concurrent completion cannot award
either value twice. Skill totals and today's gain restore after refresh and
later login, survive replacement and new-day mission creation, and render from
immutable authoritative snapshots. RLS permits users to read only their own
skill progression, and direct browser writes remain revoked.

Result: KVNX Vault now distinguishes total account progression from the skills
the user is mastering. The existing dashboard immediately reflects permanent
skill growth without trusting browser calculations or redesigning the product.

Notes: Sprint 8 mission-action validation, Sprint 9 daily authority, Sprint 9.1
Daily Complete behavior, Sprint 9.2 countdown, authentication, one-replacement
limit, and the 25-XP overall rule remain intact. The product has no separate
Skills page yet, so Sprint 10 populates the existing dashboard Skills card and
does not invent a route. No live Supabase connection is claimed. Run
`202608070008_sprint10_skill_progression.sql` after migration 007 before testing
the deployed client.

## Sprint 10.1 — UUID SQL Hotfix

Status: ✅ Complete

Goal: Correct the production UUID function resolution failure without changing
any mission, progression, countdown, authentication, or security behavior.

Completed: Recorded the live PostgreSQL `42883` error; traced it to
`public.gen_random_uuid()` in the preserved Sprint 9 implementations; added
migration 009; recreated only `request_daily_mission_at_sprint9(timestamptz)`
and `request_daily_mission_replacement_sprint9()` with
`extensions.gen_random_uuid()`; preserved explicit empty `search_path`,
`SECURITY DEFINER`, ownership derivation, grants/revocations, locking, lifecycle
and replacement rules; and added focused immutable-migration, authority,
frontend-boundary, and skill-regression tests.

Definition of Done: Both initial and replacement mission identities remain
server-generated UUIDs. The active database definitions contain no
`public.gen_random_uuid()` call. The public daily/replacement RPCs remain
zero-argument, the replacement limit remains one, and Sprint 10 overall/skill
awards are unchanged. Migrations 001–008 remain byte-for-byte identical.

Result: Supabase can resolve the UUID generator through its explicit
`extensions` schema while the existing empty-search-path security posture
remains intact. No frontend code, product behavior, RLS policy, authentication
flow, reward rule, or dashboard view changed.

Notes: Migration 006 remains immutable historical input and still contains the
original faulty text; migration 009 replaces the active functions created from
it. Automated verification is contract/static only because no live Supabase
project is connected. Run
`202608070009_sprint10_1_uuid_function_hotfix.sql` after migration 008 before
retesting daily mission generation.

## Sprint 10.2 — Skill Progression Restoration Bug Fix

Status: ✅ Complete

Goal: Correct the live `0 ACTIVE` Skills Overview result after an accepted
Programming completion without changing skill persistence, rewards, mission
authority, or dashboard design.

Completed: Traced the full SQL → RPC → repository → application-service → UI
flow; verified migration 008 already persists the mapped Front-End Engineering
row and returns `updatedSkill`; verified the zero-argument restoration RPC,
authenticated grant, RLS policy, and immutable client normalization; identified
the accepted-completion dashboard branch as the fault; and added the missing
Skills redraw plus authoritative dual-award notice in that branch.

Definition of Done: A Programming mission awards 25 overall XP and 15
Front-End Engineering XP once. Skills Overview changes from its true empty
state to the authoritative Level 1 / 15 XP result immediately, and the same
total returns after refresh and logout/login. Restoration failures use the
existing generic Vault error and never silently render `0 ACTIVE`. All prior
tests and migrations remain unchanged.

Result: The browser now presents the skill snapshot the application service had
already reconciled. PostgreSQL remains the only skill-XP authority; the UI only
redraws returned totals and derives level presentation through the shared
progression engine.

Notes: This is a JavaScript presentation bug fix. Migrations 001–009 are
byte-for-byte unchanged, migration 009 remains compatible, and no migration
010 is required. Sprint 8 validation, Sprint 9 daily authority, Sprint 9.1
Daily Complete, Sprint 9.2 countdown, Sprint 10 skill rules, Sprint 10.1 UUID
hotfix, authentication, RLS, rewards, and replacement limits are unchanged.

## Sprint 11 — Achievements & Milestones

Status: ✅ Complete

Goal: Add permanent, server-authoritative milestones without changing the
existing mission, XP, skill, countdown, authentication, or dashboard design
boundaries.

Completed: Added an eleven-entry achievement catalog; user-owned immutable
unlock rows; RLS and direct-write revocations; zero-argument read RPCs; atomic
achievement evaluation inside the active mission completion function; first
mission, first replacement, overall-XP, overall-level, and first-skill rules;
historical authoritative-data reconciliation; `newAchievements` in the
completion response; immutable application snapshots; a working Achievements
view in the existing dashboard shell; hidden and visible locked states; an
accessible multi-unlock notification; and focused authority, idempotency,
restoration, UI, security, and regression tests.

Definition of Done: The browser still sends only mission id and action. The
server alone selects eligibility, ownership, and unlock timestamp. Achievement
insertion commits with lifecycle, history, 25 overall XP, and 15 mapped skill
XP. Duplicate/concurrent requests cannot duplicate an unlock. Earned milestones
restore after refresh and logout/login and display with no fake data.

Result: Verified personal progress now produces a durable achievement record
without giving the browser milestone authority or redesigning unrelated areas.

Notes: Streak definitions are intentionally dormant because Sprint 11 has no
authoritative consecutive-day model. Migration 011 follows migration 009;
there is no migration 010. Migrations 001–009 remain byte-for-byte unchanged.
Automated database verification is contract/static only because this package
is not connected to a live Supabase project.

## Sprint 11.1 — Developer Test Panel

Status: ✅ Complete

Goal: Let approved developers simulate future authoritative days in minutes on
a separate staging database without creating a production cheat system.

Completed: Added a disabled-by-default server environment gate; an explicit
database-admin test-account allowlist; isolated per-user simulated clocks;
zero-argument one-hour, next-day, state-read, and clear-clock RPCs; integration
with the existing clock-aware daily, replacement, completion, skill, countdown,
and achievement authorities; an exact-host frontend loader; an isolated
development repository adapter; a clearly internal panel; production-domain
denials; documentation; and focused security/authority regression coverage.

Definition of Done: A permitted staging user can advance beyond the next
timezone-aware reset, request the normal authoritative mission, complete it for
exactly 25 overall and 15 mapped skill XP, trigger only legitimate achievement
rules, use one replacement, and repeat on the next simulated day. Another user
cannot see or change that clock. Clearing the clock restores real database
time. With either server gate closed, every development RPC rejects.

Result: Multi-day mission behavior can be exercised quickly without changing
PostgreSQL time, fabricating missions, granting progress, unlocking milestones,
or accepting ownership from the browser. Production users see no panel and
cannot activate test mutations.

Notes: Migration 012 is for a separate local/development or staging Supabase
project. It is hard-disabled by default even if installed accidentally, but it
must not be deliberately enabled on production. Migrations 001–009 and 011 are
byte-for-byte unchanged. Verification is contract/static because this package
is not connected to a live Supabase project.

## Sprint 12 — Vault History & Legacy

Status: ✅ Complete

Goal: Turn verified mission completion history into a permanent, searchable
personal archive without duplicating history, redesigning the dashboard, or
giving the browser ownership or write authority.

Completed: Reused `mission_history`; retained its chronological owner index;
added authoritative archival capture for mission description and original
lifecycle state; added the exact zero-argument `get_vault_history()` RPC;
joined skill names and exact-timestamp achievement unlocks; added bounded
range pagination and immutable history snapshots; activated the existing Vault
view; added Today, Yesterday, Earlier This Week, Earlier This Month, and Older
grouping; added title/category/skill search; completed, achievement, skill,
category, newest, and oldest controls; added keyboard-operable entry expansion;
and added restoration, pagination, ordering, grouping, filtering, UI, RLS,
cross-user, and read-only regression coverage.

Definition of Done: Every rendered entry originates in the authenticated
user's authoritative completed `mission_history`. The browser supplies no
owner and performs no history write. Initial and later pages remain bounded;
refresh and logout/login restore the same archive; inaccessible historical
details remain explicitly unavailable instead of being fabricated.

Result: The Vault now feels like a durable record of accomplished work while
remaining a read-only projection of the same server-owned mission, XP, skill,
and achievement facts.

Notes: Migration 013 is required because descriptions and pre-terminal states
were not previously retained. Migrations 001–009, 011, and 012 remain
byte-for-byte unchanged. The staging-only restrictions on migration 012 remain
in force. Database verification is contract/static because no live Supabase
project is connected.

## Sprint 13 — Analytics & Insights

Status: ✅ Complete

Goal: Turn the Analytics placeholder into a premium, read-only insight surface
that explains mission consistency, XP earned, skill development, and activity
over time using only authoritative persisted data.

Completed: Added the authenticated `get_vault_analytics(text)` aggregate RPC;
validated `7d`, `30d`, and `all` period contracts; reused `mission_history`,
`skill_catalog`, and `user_achievements`; added deterministic most-developed
skill ordering; added active-day and persisted-achievement summaries; added
repository normalization and deep freezing; added application-service request
ownership and concurrent-request sharing; activated Analytics in the existing
dashboard; and added responsive metrics, accessible mission and XP charts,
period-relative skill bars, loading, empty, error, retry, and reduced-motion
behavior.

Definition of Done: Analytics accepts no owner or authoritative totals from the
browser, leaks no cross-account data, performs no write, and never evaluates a
reward, progression level, skill level, achievement, or streak. Seven- and
thirty-day periods are zero-filled server windows; All Time uses active dates.
Every number comes from completed mission history or a persisted achievement
unlock. Existing mission, replacement, Daily Complete, countdown, skill,
achievement, Vault History, authentication, RLS, and developer-tool behavior
remains unchanged.

Result: Users can now see how consistently they are acting, how much verified
XP they earned, and which areas they are developing without turning Analytics
into a second source of truth.

Notes: Migration 014 is required and production-safe. It creates one read-only
RPC and no table or index. Active Days are distinct UTC dates with at least one
completed mission and are explicitly not streaks. Historical rows without
skill attribution remain honest: they contribute mission and overall XP totals
but not invented skill analytics. Migrations 001–013 and both established
fingerprint baselines remain unchanged. Database verification is contract/static
because no live Supabase project is connected.

## Sprint 14 — Authoritative Streak Tracking + Streak Achievements

Status: ✅ Code complete; database and deployment verification remain manual

Goal: Add a durable consistency signal for consecutive authoritative logical
days with at least one completed mission, without giving the browser date,
timezone, streak, history, or achievement authority.

Completed: Added one RLS-protected per-user streak state; atomic completed
history trigger evaluation; same-day idempotency; next-day increment and gap
reset rules; longest-streak preservation; safe reconstruction from canonical
completed history days; activation of the existing `THREE_DAY_STREAK` and
`SEVEN_DAY_STREAK` catalog keys; zero-argument restoration; strict immutable
repository mapping; application snapshot reconciliation; a restrained
Consistency card; global current/longest streak values in Analytics; and
focused regression coverage for concurrency, replacement, restoration,
security, developer-clock compatibility, and migration immutability.

Definition of Done: Only an accepted authoritative completion can add a streak
day. Multiple missions on one day count once. Skipped, expired, rejected, and
duplicate transitions do nothing. Current and longest values restore after
refresh and later login. Active Days remains a period activity count and never
defines streak progression. Overall XP remains 25, mapped skill XP remains 15,
and one replacement remains available per daily session.

Result: Consistency and its achievements now use the same trusted logical-day
identity as daily missions and the staging simulated clock. No existing
migration was edited. Migration 015 and a new pre-Sprint-14 fingerprint
baseline are included. Live Supabase, staging, and production deployment tests
are intentionally not claimed.

## Sprint 15 — Server-Authoritative Mission Catalog + Variety

Status: ✅ Code complete; database and deployment verification remain manual

Goal: Replace the single-template-per-focus server builder with a rich mission
catalog while preserving every ownership, lifecycle, reward, history,
achievement, Analytics, streak, replacement, and staging-clock boundary.

Completed: Added 66 protected templates across ten canonical focus categories
and a General custom-focus fallback; canonical skill foreign keys; deterministic
owner/day selection; five-template recent-use avoidance; least-recently-used
fallback; current-template replacement exclusion; nullable authoritative
template identity in history; snapshot-safe archival capture; production
removal of the legacy browser generator; a new pre-Sprint-15 fingerprint
baseline; documentation; and focused security and regression coverage.

Definition of Done: The browser asks for a daily mission or replacement but
cannot choose its focus, template, copy, skill, reward, UUID, owner, date, or
logical day. Same-day requests restore one saved mission. Replacement remains
limited to one and awards nothing until completion. Completion remains exactly
25 overall XP and 15 mapped skill XP. Completing two missions on one logical
day remains one streak day.

Result: Daily missions now vary meaningfully without adding a client-side
source of truth or changing the existing dashboard design. Existing missions
and history survive migration without fabricated template identities.

Notes: Migration 016 is required. Migrations 001–015 remain byte-for-byte
unchanged. Live Supabase, staging, and production deployment tests are not
claimed by this package.

## Sprint 16 — Mission Center

Status: ✅ Code complete; deployment and live verification remain manual

Goal: Turn Missions navigation into a premium, dedicated surface for the
existing server-authoritative daily mission without creating a second mission
system or changing the dashboard overview.

Completed: Activated `#missions` in the existing shell; added authoritative
mission detail and explicit Ready, Active, Completed, Skipped, and Expired
states; reused the established Start, Complete, Skip, and replacement action
paths; added Daily Complete, replacement availability, canonical skill,
server-returned reward, current XP, streak, and reset presentation; added a
five-item authoritative recent-history preview with Vault links; added honest
loading, error, and empty states; added responsive and accessibility behavior;
added a read-only canonical skill catalog restoration; and added focused Sprint
16 regression, authority, migration, syntax, and security coverage.

Definition of Done: Opening or refreshing Mission Center restores the same
authoritative mission and cannot reroll, replace, reward, advance streak,
unlock achievements, or mutate history. Explicit actions still cross Application
Service and Repository to the existing authenticated RPCs. Rewards remain 25
overall XP and 15 mapped skill XP. Daily Complete still requires a completed
mission with no replacement remaining, and Vault remains the full archive.

Result: Missions is now a first-class product surface while Dashboard remains
the overview. The mission system, logical day, one-replacement limit, Sprint 15
selection, streaks, achievements, and staging clock retain their existing
authority.

Notes: No database migration is required. Migrations 001–016 remain unchanged.
No live Supabase, staging, production deployment, or natural new-day verification
is claimed by this package.

## Sprint 17 — Authoritative Skill Center

Status: ✅ Code complete; deployment and live verification remain manual

Goal: Turn Skills navigation into a dedicated lifetime mastery surface without
adding browser reward authority, duplicate progression state, or a new backend
contract.

Completed: Activated `#skills` in the existing shell; merged the canonical skill
catalog with persisted skill totals; added Active and Not Started presentation;
reused the existing skill progression configuration for level, current-level
progress, and XP remaining; added authoritative summary metrics, deterministic
filtering/sorting, keyboard-native detail disclosures, bounded recent verified
gains, and Vault links; preserved the Sprint 16.1 restoration gate; reconciled
accepted completion snapshots into both skill surfaces; and added focused
authority, accessibility, migration, syntax, security, and packaging coverage.

Definition of Done: Opening, filtering, sorting, expanding, refreshing, or
revisiting Skill Center cannot add XP, mutate a skill, alter streaks, unlock an
achievement, expose the mission catalog, or request another user's data. The
surface renders only catalog identity, persisted totals, existing progression
math, and attributed completed history already present in the immutable
application snapshot. Rewards remain exactly 25 overall XP and 15 mapped skill
XP through accepted server completion.

Result: Skills is now a first-class product surface while Dashboard remains the
overview, Vault remains the full archive, Analytics remains period-based, and
Mission Center remains unchanged. Legacy history without trustworthy skill
attribution is omitted from recent gains rather than fabricated.

Notes: No database migration is required. Migrations 001–016 remain unchanged.
No live Supabase, staging, production deployment, or live verification is
claimed by this package.

## Sprint 20 — Server-Authoritative Skill Paths

Status: ✅ Code complete; migration, deployment, and live verification remain manual

Goal: Let users activate and pause canonical development paths while preserving
the distinction between intentional development and verified lifetime progress.

Completed: Added soft owner/skill path persistence, canonical active-skill
validation, idempotent and concurrency-safe activation/deactivation, zero-
argument restoration, strict frozen Repository/Application Service snapshots,
Skill Center path controls, a separate Developing filter, and compact zero-XP
path presentation. Fitness uses the same canonical flow for every account.

Definition of Done: Path changes award nothing, create nothing in the mission
or Vault domains, preserve XP/history on deactivation, and cannot reroll or
alter Sprint 19 choices. Positive XP alone still enables skill detail. The
protected loading gate waits for Skill Path restoration.

Notes: Migration 019 is required. Migrations 001–018 remain byte-for-byte
unchanged. Sprint 20 adds no Side Missions, skill-specific mission generation,
new economy, custom skills, subcategories, or AI Coach. No production, staging,
or live Supabase verification is claimed by this package.

## Sprint 21 — Authoritative Skill Path Mission Offers

Status: ✅ Code complete; migration, deployment, and live verification remain manual

Goal: Let a user explore bounded, stable practice options for an active
canonical development path while keeping eligibility, content, logical time,
membership, and selection lock authoritative.

Completed: Added owner/day/skill offer persistence, up to three canonical
server-built snapshots, opaque IDs, active-path and exact-membership validation,
concurrency-safe stable restoration, one idempotent planned selection, frozen
Repository/Application Service restoration, and a separate responsive Skill
Center offer panel. Added path-only catalog coverage so every canonical skill
has an eligible pool without entering Sprint 19 onboarding focus selection.

Definition of Done: Offer request, view, and planned selection award nothing,
create no mission or history, and change no streak, achievement, Analytics,
Daily Mission Choice, replacement, or Daily Complete state. Paused paths cannot
request or select. Zero-XP Developing cards remain compact.

Notes: Migration 020 is required. Migrations 001–019 remain byte-for-byte
unchanged. Sprint 21 adds no Side Mission lifecycle, completion, XP economy,
recurrence, deadlines, capacity limits, AI Coach, custom skills, or Sprint 19
mission-pool integration. No live Supabase, staging, production deployment, or
live verification is claimed by this package.

## Sprint 21.1 — Production Effective-Clock Compatibility Hotfix

Status: ✅ Code complete; migration, emergency deployment, and live verification remain manual

Root cause: Production intentionally omitted staging-only Migration 012, while
the Sprint 15 catalog builder, Sprint 19 choice selection, and Sprint 21 offer
functions referenced Migration 012's internal zero-argument effective-clock
helper. PostgreSQL therefore raised `42883` when those paths executed.

Completed: Added a conditional Migration 021 catalog check. Staging does
nothing when its existing helper is present. Production receives only a revoked
zero-argument real-database-time fallback returning `clock_timestamp()`. Added
focused production/staging compatibility, privilege, dependency, reward,
authority, immutability, and regression coverage.

Definition of Done: Production restoration can resolve the effective-clock
dependency without installing Migration 012 or gaining developer tables,
allowlists, simulated state, mutation controls, or browser time authority.
Staging's existing simulated-clock behavior remains unchanged.

Notes: Migration 021 is required. Migrations 001–020 remain byte-for-byte
unchanged. There are no frontend changes. No production deployment, production
verification, staging verification, or live Supabase verification is claimed by
this package.

## Sprint 17.1 — Skill Center Empty-State Polish

Status: ✅ Code complete; deployment and live verification remain manual

Completed: Kept every canonical zero-XP skill visible while replacing its empty
disclosure with a compact static Not Started card. Only skills with positive
authoritative XP render native expandable details, progression, recent verified
gains, and Vault navigation. A reconciled first positive skill award changes the
same catalog skill to Active and restores the existing disclosure automatically.

Notes: This is a presentation-only refinement. Repository and Application
Service contracts, rewards, progression thresholds, authentication restoration,
and migrations 001–016 remain unchanged. No database migration is required.

## Sprint 18 — Authoritative Achievement Center Enhancement

Status: ✅ Code complete; migration, deployment, and live verification remain manual

Goal: Turn Achievements into a premium, detailed milestone surface without
moving evaluation, rewards, progression, or unlock authority into the browser.

Completed: Added authoritative summary metrics, Unlocked and Locked groups,
persisted unlock dates, most-recent ordering, keyboard-native filters, visible
requirement copy, conservative overall-XP and skill progress, unlocked streak
context, an intentional zero state, recoverable rendering failure, responsive
cards, and accepted-completion reconciliation through the existing immutable
snapshot and multi-achievement notification path.

Hidden confidentiality is now enforced at the authenticated database read
boundary. Locked hidden definitions are redacted before reaching browser
serialization and are defensively masked again in the Application Service and
Achievement Center projection. Real content appears only after a persisted
owner unlock exists. No mission attribution is fabricated because the current
archive does not persist exact achievement causality.

Notes: Migration 017 is required solely for the confidentiality-safe read
contract. It changes no achievement eligibility, rewards, writes, RLS, mission
rules, replacement rules, streak rules, or progression thresholds. Migrations
001–016 remain byte-for-byte unchanged. No live Supabase, staging, production
deployment, or live verification is claimed by this package.

## Sprint 19 — Authoritative Daily Mission Choice

Status: ✅ Code complete; migration, deployment, and live verification remain manual

Goal: Give users controlled choice over the primary Daily Mission while keeping
definitions, membership, rewards, skill mapping, ownership, logical time, and
lifecycle authority inside PostgreSQL.

Completed: Added one persisted owner/logical-day choice row with up to three
active catalog options; stable focus-aware and recent-usage-aware ranking;
opaque choice IDs; exact offered-membership validation; advisory-lock and row
locking concurrency; duplicate-choice idempotency; conflicting-choice lockout;
server-owned mission UUID/content/reward/skill creation; immutable Repository
and Application Service choice snapshots; shared Dashboard and Mission Center
choice cards; pending-state duplicate prevention; responsive/accessibility
support; staging-clock reuse; focused security and regression coverage.

Definition of Done: Viewing or restoring choices cannot reroll them. Selecting
one option creates exactly one ready primary mission and awards nothing.
Existing missions bypass choice. Completion remains 25 overall XP plus 15
mapped skill XP. Replacement stays server-selected and limited to one. Choice
views and selections create no history, Analytics activity, streak progress, or
achievement evaluation.

Notes: Migration 018 is required. Migrations 001–017 remain byte-for-byte
unchanged. Sprint 19 intentionally adds no Side Missions, custom skills,
multi-focus selection, Fitness-specific rule, AI Coach, or additional XP
economy. Those remain future roadmap work built on this bounded choice-lock
authority model. No live Supabase, staging, production deployment, or live
verification is claimed by this package.

## Sprint 22 — Server-Authoritative Side Mission Lifecycle

Status: ✅ Code complete; migration, deployment, and live verification remain manual

Completed: Promotes one current planned Skill Path offer into a separate
account-wide Side Mission slot; adds READY/ACTIVE/COMPLETED and next-day
expiration; atomically awards exactly +10 overall and +10 canonical skill XP;
persists one typed Side completion; reconciles Skill Center, Vault, Analytics,
progression, and eligible progression achievements; and presents the same
authoritative slot in Skill Center and Mission Center.

Definition of Done: One rewarded/completable Side Mission per authenticated
owner per authoritative logical day. Retries and concurrency cannot double
award. Side work never changes the Daily Mission streak, Daily Complete,
replacement, primary choice, onboarding focus, or reset. Pausing prevents new
promotion but cannot destroy an already committed mission.

Notes: Migration 022 is required. Migrations 001–021 remain byte-for-byte
unchanged. Production continues using Migration 021 real database time;
staging retains Migration 012 simulation. No production deployment, production
verification, staging verification, or live Supabase verification is claimed.

## Sprint 22.1 — Completion Reconciliation + Skill Card Polish

Status: ✅ Code complete; deployment and live retest remain manual

Completed: Side Mission action handling now reconciles and renders the returned
authoritative snapshot before interpreting retry status or running ancillary
page redraws. Terminal completed/expired snapshots always remove both mutation
actions and replace stale status copy. A later presentation exception can no
longer misreport an already-committed database completion as a persistence
failure. The action buttons also have an explicit `[hidden]` display rule.

Skill Center's two-column grid now aligns items to the start, and each skill
card is content-sized. An expanded positive-XP disclosure no longer stretches
its collapsed neighbor. Native disclosure accessibility, mobile single-column
layout, and zero-XP compact cards remain unchanged.

Notes: Frontend only. Application Service, Repository, Migration 022, +10/+10
economy, lifecycle, history, Analytics, streak exclusion, Daily Mission, and
Daily Complete are unchanged. **NO DATABASE MIGRATION REQUIRED.** No production
retest is claimed by this package.

## Sprint 23 — Side Mission Operational Hardening + Economy Observability

Status: ✅ Code complete; migration, deployment, and live verification remain manual

Completed: Added a server-written append-only lifecycle ledger for promoted,
started, completed, and expired Side Mission transitions; idempotent event
capture inside the originating database transaction; trustworthy reconciliation
of existing Side Mission state; unique history hardening; a bounded
`auth.uid()`-owned read-only observability RPC; an administrator-only read-only
invariant audit; and documented production/staging diagnostic procedures.

Economy boundaries: Side Mission capacity remains one per authoritative
logical day and completion remains exactly +10 overall/+10 canonical skill XP.
Lifecycle events explain operations but do not replace progression or verified
history as XP sources of truth. Daily Mission streak, Daily Complete,
replacement, primary choice, achievement semantics, and Daily/Side Analytics
separation remain unchanged.

Security: Browser roles have no direct ledger privileges and cannot submit
telemetry, owner, logical day, time, lifecycle, skill, or reward. Rejected
request telemetry is intentionally left to server logs to avoid an abuse-driven
event stream. No founder/admin browser surface or privileged credential is
added.

Notes: Migration 023 is required. Migrations 001–022 remain byte-for-byte
unchanged. Migration 021 real-production/staging-simulation clock behavior is
unchanged. No production deployment, production verification, staging
verification, or live Supabase verification is claimed by this package.

## Sprint 24 — Operational Hardening

Status: ✅ Code complete; review, migration, scheduling, deployment, and live verification remain manual

Completed: Added administrator-only monitoring runs, immutable per-run
findings, deterministic deduplicated alerts, a read-only anomaly detector built
on Sprint 23 invariants, a serialized monitoring runner, a privacy-restrained
health summary, and bounded retention for old Sprint 24 operational data.

Detection covers only architecture-proven conditions: Sprint 23 invariant
violations, invalid Side +10/+10/canonical-skill snapshots, impossible lifecycle
order or event volume, invalid Daily +25/+15 completion history, and overall or
skill progression/history divergence. Detection and alerts never repair,
reward, subtract, delete, reset, suspend, or mutate gameplay state.

Security: All operational tables use RLS with no browser policies or grants.
All operational functions are revoked from `public`, `anon`, and
`authenticated`, use fixed empty search paths, and remain database-owner only.
No frontend, admin role, service credential, scheduler, or external dependency
is added.

Retention removes only bounded old monitoring runs/findings and resolved
alerts. Open alerts, Sprint 23 lifecycle events, authoritative mission history,
state, progression, skills, streaks, achievements, and Daily systems are
preserved. The Sprint 23 ledger remains intact to preserve its `all` contract.

Notes: Migration 024 is required. Migrations 001–023 remain byte-for-byte
unchanged. Sprint 24 does not implement Quick Actions or any user-facing
feature. No commit, push, deployment, migration application, or live
verification is claimed.

## Sprint 24.1 — Legacy XP Reconciliation Hardening

Status: ✅ Code complete; review, migration, deployment, and live verification remain manual

Completed: Added an explicit administrator-attested XP/history provenance
boundary for individually investigated accounts that may contain Sprint 7
prototype-era progression. No account is automatically treated as legacy.
Every unattested account—including pre-Migration-025 accounts—retains critical
reconstruction enforcement. An attested historical gap remains visible as a
warning, while every post-baseline divergence remains critical.

Authority: Baselines are observational snapshots, not rewards. They cannot add
or remove overall XP, Skill XP, history, achievements, streaks, or mission
state. RLS and full browser-role revocation protect both provenance tables; no
frontend authority, hard-coded account exception, or automatic alert deletion
is introduced. The database-owner function accepts only user identity and an
audit reason; XP/history values are always read from authoritative tables.

Notes: Migration 025 is required. Migrations 001–024 remain byte-for-byte
unchanged. This is Sprint 24.1, not Quick Actions or product Sprint 25. No
commit, push, deployment, production migration, XP modification, alert
deletion, or live verification is claimed.

## Sprint 24.2 — Production Baseline Remediation

Status: ✅ Code complete; review, production migration, and live verification remain manual

Completed: Added forward-only Migration 026 to remove only the automatically
trusted baseline rows produced by the unsafe early production Migration 025.
Identification uses the complete migration-owned provenance signature rather
than account IDs or XP differences. Explicit administrator attestations are
preserved, while every unattested account returns to full 75-plus-history
reconciliation.

The original `sprint24_1` boundary remains protected as superseded incident
metadata and confers no trust. The final owner-only attestation API reads and
locks server state, computes history, records a reason and principal, and
cannot mutate XP or gameplay. Detector rules retain all non-overall Sprint 24
checks and conservatively classify invalid provenance without letting it hide
an authoritative divergence.

Notes: Migration 026 is required. Migrations 001–025 remain byte-for-byte
unchanged. No alert is manually deleted; normal monitoring manages deterministic
alert lifecycle. No commit, push, deployment, production mutation, or live
verification is claimed.

## Sprint 24.3 — Monitoring Helper Compatibility Hotfix

Status: ✅ Code complete; review, production migration, and live verification remain manual

Completed: Replaced Migration 026's historical-helper delegation with a single
self-contained detector containing every Sprint 24 non-overall rule and the
reviewed Sprint 24.2 reconciliation rules. The obsolete helper is dropped, so
callable monitoring contains no reference to the removed `boundary_key`.

Notes: Migration 027 is required. Migrations 001–026 remain byte-for-byte
unchanged. Monitoring alert resolution remains deterministic and normal; no
gameplay or alert state is manually changed. No commit, push, deployment, or
production verification is claimed.
