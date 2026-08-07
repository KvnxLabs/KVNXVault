# KVNX Vault Authentication

Version: Sprint 8

## Provider and Boundary

KVNX Vault uses Supabase Auth for email/password identity. `js/auth-service.js` is the only authentication boundary. It creates the browser client and exposes sign-up, sign-in, sign-out, current-session, current-user, and auth-change methods.

The browser receives only:

- The Supabase project URL
- The public publishable key (or legacy anon key)

Never place a service-role key, database password, JWT secret, or other private credential in this static project. A service-role key bypasses Row Level Security and must never be used in browser code.

## Manual Supabase Setup

1. Create a Supabase project.
2. Open **SQL Editor** and run these migrations once, in filename order:
   - `supabase/migrations/202608070001_sprint7_foundation.sql`
   - `supabase/migrations/202608070002_sprint7_1_security_correction.sql`
   - `supabase/migrations/202608070003_sprint7_2_prototype_persistence.sql`
   - `supabase/migrations/202608070004_sprint7_2_replacement_persistence.sql`
   - `supabase/migrations/202608070005_sprint8_server_authority.sql`
3. Open **Authentication → Providers → Email** and enable email/password authentication.
4. Decide whether email confirmation is required. KVNX Vault supports both modes:
   - Confirmation enabled: sign-up shows a clear “Check your email” state.
   - Confirmation disabled: sign-up receives a session and continues to onboarding.
5. Open **Authentication → URL Configuration**.
6. Set **Site URL** to `https://kvnx-vault.vercel.app`.
7. Add `https://kvnx-vault.vercel.app/login.html` to **Redirect URLs**.
8. Add the exact local-development URL only if you use a local HTTP server. Do not open the HTML through `file://` because module/network behavior and redirect origins differ.
9. Open **Project Settings → API Keys** and copy the project URL and public publishable key.
10. Replace the two placeholders in `js/config.js`.

Required public configuration:

```js
window.KVNXConfig = Object.freeze({
  supabaseUrl: "https://YOUR_PROJECT_REF.supabase.co",
  supabasePublishableKey: "YOUR_SUPABASE_PUBLISHABLE_KEY",
  vaultApplicationUrl: "https://kvnx-vault.vercel.app",
  authRedirectPath: "/login.html",
});
```

`kvnxlabs.com` is the KVNX Labs company site. It is not the Vault application
origin and must not receive Vault authentication callbacks. If Vault later moves
to `https://vault.kvnxlabs.com`, change `vaultApplicationUrl`, the Supabase Site
URL, and the redirect allowlist together. Authentication and domain logic do not
otherwise depend on either hostname.

Committing the public publishable key is supported for a browser application because RLS, not key secrecy, protects rows. The service-role key is fundamentally different and must remain server-only.

## Session and Routing Flow

```text
Landing page
  → Login or Create Account
  → Supabase Auth session
  → Onboarding when no completed onboarding record exists
  → Dashboard when onboarding is complete
```

`js/route-guard.js` owns routing decisions. `js/protected-page.js` applies those decisions to onboarding and dashboard before user-specific content renders.

- Unauthenticated onboarding/dashboard access returns to `login.html`.
- Authenticated users without completed onboarding go to `onboarding.html`.
- Authenticated users with completed onboarding go to `dashboard.html`.
- Returning users are routed after session restoration.
- Sign-out ends the Supabase session, clears the in-memory onboarding cache, and returns to login.

## Static-Page Security Limit

Client-side route guards can prevent accidental display of authenticated UI, but static HTML files remain publicly downloadable. They must contain no secrets or private user data.

Database Row Level Security is the authoritative cross-user access boundary.
Every query is evaluated against the authenticated JWT, and every user-owned row
is restricted by `auth.uid()`. RLS does not prove that progression values
submitted by a user's own browser are valid.

## Error Handling

Authentication screens map provider failures to restrained messages and never show raw database or provider details. Protected pages stop rendering user state when restoration fails. An expired session returns the user to login. Confirmation-required sign-ups do not pretend an authenticated session exists.

## Current Security Scope

Sprint 7.1 guarantees user-to-user database isolation through RLS and removes
direct browser table writes to progression, mission lifecycle state, and mission
history. Sprint 7.2 permits one narrow function to persist a locally validated
prototype completion: PostgreSQL computes the next total from the stored total
and saved mission reward and requires the progression-engine snapshot to match.
An additional narrow Sprint 7.2 function persists a coordinator-approved
replacement mission without accepting or changing XP. It derives ownership
from `auth.uid()`, rechecks the saved terminal mission and replacement limit,
and resets only the daily mission row for the new ready mission.

Sprint 8 removes prototype completion from the production path. Normal mission
actions call a security-definer PostgreSQL function that derives identity from
`auth.uid()`, accepts only mission id and action, locks the owned mission and
progression rows, validates lifecycle state, determines the canonical reward,
updates state and XP, creates terminal history, and returns one authoritative
snapshot. Direct writes stay revoked and RLS stays enabled.

The public publishable key can invoke only the specifically granted function;
it cannot select another user's rows or write authoritative tables directly.
Raw SQL errors remain behind repository error mapping. The browser never sends
user id, XP, reward, lifecycle result, level data, or history.

The current daily-session id is still browser-derived, and replacement mission
content still crosses the narrow Sprint 7.2 replacement function. Migration 005
canonicalizes the replacement reward to 25 and keeps the one-replacement rule,
but server-issued daily boundaries and a fully server-selected mission catalog
remain future hardening work.
