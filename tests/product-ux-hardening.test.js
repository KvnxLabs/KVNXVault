"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const hash = (relativePath) => crypto.createHash("sha256")
  .update(fs.readFileSync(path.join(root, relativePath))).digest("hex");
const html = read("dashboard.html");
const dashboard = read("js/dashboard.js");
const onboarding = read("js/onboarding.js");
const repository = read("js/user-repository.js");
const components = read("css/components.css");
const dashboardCSS = read("css/dashboard.css");
const tests = [];
const test = (name, run) => tests.push({ name, run });

test("the protected restoration gate still precedes all authenticated product content", () => {
  assert.ok(html.indexOf("data-protected-loading") < html.indexOf("data-protected-content hidden"));
  assert.ok(html.indexOf("protectedContentGate.reveal()") === -1);
  assert.match(dashboard, /renderApplicationView\(\);\s*protectedContentGate\.reveal\(\)/);
});

test("Daily Mission remains ahead of Quick Actions and Coach in document order", () => {
  const daily = html.indexOf("data-mission-card");
  const actions = html.indexOf("data-quick-actions");
  const coach = html.indexOf("data-coach-card");
  assert.ok(daily >= 0 && daily < actions && actions < coach);
});

test("all authenticated destinations use the existing in-shell hash router", () => {
  for (const route of ["dashboard", "missions", "skills", "achievements", "vault", "analytics"]) {
    assert.match(html, new RegExp(`href="#${route}"`));
  }
  assert.doesNotMatch(html.match(/<aside class="sidebar"[\s\S]*?<\/aside>/)?.[0] || "", /href="dashboard\.html"/);
});

test("unknown hashes normalize without a reload or mission request", () => {
  const routeRenderer = dashboard.match(/const renderApplicationView = \(\) => \{[\s\S]*?\n  \};/)?.[0] || "";
  assert.match(routeRenderer, /if \(!knownRoute\) window\.history\.replaceState\(null, "", "#dashboard"\)/);
  assert.doesNotMatch(routeRenderer, /requestDailyMission|requestReplacement|initialize|location\.reload/);
});

test("hash navigation restores scroll position and moves focus to the active heading", () => {
  assert.equal((html.match(/data-view-heading="(?:dashboard|missions|skills|achievements|vault|analytics)"/g) || []).length, 6);
  assert.equal((html.match(/tabindex="-1" data-view-heading=/g) || []).length, 6);
  assert.match(dashboard, /const handleApplicationRouteChange = \(\) => \{[\s\S]*window\.scrollTo\(\{ top: 0, behavior: "auto" \}\);[\s\S]*heading\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(dashboard, /addEventListener\("hashchange", handleApplicationRouteChange\)/);
});

test("mobile navigation closes after a route is chosen without stealing destination focus", () => {
  assert.match(dashboard, /const setSidebarOpen = \(isOpen, \{ restoreFocus = true \} = \{\}\)/);
  assert.match(dashboard, /viewLinks\.forEach[\s\S]*setSidebarOpen\(false, \{ restoreFocus: false \}\)/);
});

test("the displayed Vault search shortcut is functional", () => {
  assert.match(html, /topbar__shortcut[^>]*>⌘ K</);
  assert.match(dashboard, /\(event\.metaKey \|\| event\.ctrlKey\)[\s\S]*event\.key\.toLowerCase\(\) === "k"[\s\S]*vaultSearch\?\.focus\(\)/);
});

test("Daily start and skip share one duplicate-submission guard", () => {
  const flow = dashboard.match(/let dailyLifecycleActionInFlight = false;[\s\S]*?const completeFirstMission/)?.[0] || "";
  assert.match(flow, /if \(dailyLifecycleActionInFlight\) return/);
  assert.match(flow, /dailyLifecycleActionInFlight = true/);
  assert.match(flow, /dailyLifecycleActionInFlight = false/);
  assert.match(flow, /action === "start"[\s\S]*vaultApplication\.start\(\)[\s\S]*vaultApplication\.skip\(\)/);
});

test("Daily lifecycle controls expose a pending state and reconcile before re-enabling", () => {
  const flow = dashboard.match(/const dailyLifecycleButtons = \[[\s\S]*?missionCenterSkip\?\.addEventListener/)?.[0] || "";
  assert.match(flow, /button\.disabled = true/);
  assert.match(flow, /button\.setAttribute\("aria-busy", "true"\)/);
  assert.match(flow, /applicationSnapshot = result\.snapshot/);
  assert.match(flow, /if \(reconciled\) button\.disabled = false/);
});

test("a failed Daily lifecycle mutation remains safely blocked for durable restoration", () => {
  const flow = dashboard.match(/const runDailyLifecycleAction = async[\s\S]*?\n  \};/)?.[0] || "";
  assert.match(flow, /catch \(error\) \{\s*showPersistenceFailure\(error\)/);
  assert.match(flow, /if \(reconciled\) button\.disabled = false/);
  assert.doesNotMatch(flow, /catch \(error\) \{[^}]*button\.disabled = false/);
});

test("existing completion, replacement, choice, Side Mission, customization, and Coach guards remain", () => {
  for (const guard of [
    "completionInFlight", "replacementInFlight", "dailyChoiceSelectionInFlight",
    "sideMissionActionInFlight", "missionCustomizationInFlight", "coachRequestInFlight",
  ]) assert.match(dashboard, new RegExp(`if \\([^\\n)]*${guard}`));
});

test("reduced-motion onboarding skips the cinematic delay after durable save", () => {
  const intro = onboarding.match(/const startVaultIntro = async \(\) => \{[\s\S]*?\n  \};/)?.[0] || "";
  const writeIndex = intro.indexOf("stateStore.write");
  const reducedIndex = intro.indexOf("prefers-reduced-motion: reduce");
  const firstTimerIndex = intro.indexOf("window.setTimeout");
  assert.ok(writeIndex >= 0 && reducedIndex > writeIndex && firstTimerIndex > reducedIndex);
  assert.match(intro, /matchMedia\?\.\("\(prefers-reduced-motion: reduce\)"\)\.matches[\s\S]*location\.assign\("dashboard\.html"\);[\s\S]*return/);
});

test("onboarding button copy uses DOM text rather than HTML parsing", () => {
  assert.doesNotMatch(onboarding, /\.innerHTML\s*=/);
  assert.match(onboarding, /nextButton\.replaceChildren\(document\.createTextNode/);
});

test("coarse-pointer controls and icon buttons meet the 44px target", () => {
  assert.match(components, /\.app-icon-button \{\s*width: 44px;\s*height: 44px/);
  assert.match(dashboardCSS, /\.sidebar__logout \{\s*min-height: 44px/);
  assert.match(dashboardCSS, /@media \(pointer: coarse\)[\s\S]*\.coach-card__modes button[\s\S]*min-height: 44px/);
});

test("the shell prevents horizontal page overflow across responsive layouts", () => {
  assert.match(dashboardCSS, /\.app-page \{[\s\S]*?overflow-x: clip/);
  for (const breakpoint of [1100, 860, 620, 480, 390]) {
    assert.match(dashboardCSS, new RegExp(`@media \\(max-width: ${breakpoint}px\\)`));
  }
});

test("the disabled notification control does not imply an unread notification", () => {
  assert.match(html, /topbar__notification[^>]*disabled/);
  assert.match(dashboardCSS, /\.topbar__notification:disabled::after \{\s*display: none/);
});

test("restored user and mission placeholders remain protected from first paint", () => {
  const shellStart = html.indexOf("data-protected-content hidden");
  for (const placeholder of ["Guest", "Explorer", "Build focused momentum", "No active streak yet"]) {
    assert.ok(html.indexOf(placeholder) > shellStart, placeholder);
  }
});

test("user-facing mutation failures remain restrained and never render raw backend errors", () => {
  assert.match(dashboard, /Your latest change couldn't be saved/);
  assert.doesNotMatch(dashboard, /persistenceError\.textContent\s*=\s*(?:error|error\?\.|String\(error)/);
  assert.doesNotMatch(dashboard, /\.innerHTML\s*=/);
});

test("Dashboard rendering still performs no direct Supabase access", () => {
  assert.doesNotMatch(dashboard, /supabase|\.rpc\(|\.from\(/i);
});

test("repository source is complete, syntactically valid, and retains the Sprint 28 contract", () => {
  assert.equal(spawnSync(process.execPath, ["--check", path.join(root, "js/user-repository.js")]).status, 0);
  assert.match(repository, /const getSkillCatalog = async/);
  assert.match(repository, /const getMissionCustomization = async/);
  assert.match(repository, /const getVaultCoachContext = async/);
  assert.match(repository, /const getSideMission = async/);
  assert.match(repository, /return Object\.freeze\(\{[\s\S]*getVaultCoachContext/);
});

test("authentication and protected routing authority remain unchanged", () => {
  assert.match(read("js/protected-page.js"), /restoreRouteState[\s\S]*evaluateProtectedRoute/);
  assert.match(read("js/auth.js"), /getFriendlyError/);
  assert.doesNotMatch(read("js/auth.js"), /service_role|SUPABASE_SERVICE/i);
});

test("Daily and Side Mission reward contracts remain unchanged", () => {
  const daily = read("supabase/migrations/202608070005_sprint8_server_authority.sql");
  const skills = read("supabase/migrations/202608070008_sprint10_skill_progression.sql");
  const side = read("supabase/migrations/202608070022_sprint22_side_mission_lifecycle.sql");
  assert.match(daily, /v_reward <> 25/);
  assert.match(daily, /v_total_xp := v_total_xp \+ v_reward/);
  assert.match(skills, /v_skill_reward := 15/);
  assert.match(side, /v_total_xp := v_total_xp \+ 10/);
  assert.match(side, /v_skill_total := v_skill_total \+ 10/);
});

test("Sprint 29 creates no Migration 031", () => {
  const migrations = fs.readdirSync(path.join(root, "supabase/migrations"));
  assert.equal(migrations.some((name) => /^202608070031_/.test(name)), false);
  assert.equal(migrations.length, 29);
});

test("historical migrations 001 through 030 remain byte-for-byte unchanged", () => {
  const baseline = read("../migrations-pre-sprint27.sha256").trim().split("\n");
  assert.equal(baseline.length, 28);
  baseline.forEach((line) => {
    const [digest, relativePath] = line.trim().split(/\s+/);
    const actual = crypto.createHash("sha256")
      .update(fs.readFileSync(path.join(root, "..", relativePath))).digest("hex");
    assert.equal(actual, digest, relativePath);
  });
  assert.equal(hash("supabase/migrations/202608070030_sprint27_ai_coach_foundation.sql"),
    "ef3ddf1f6626f1b4d59eb2fdb89d3a4e6412d365ac7700be938d66e4d5944dc5");
});

test("all JavaScript and local HTML references remain valid", () => {
  for (const file of fs.readdirSync(path.join(root, "js")).filter((name) => name.endsWith(".js"))) {
    assert.equal(spawnSync(process.execPath, ["--check", path.join(root, "js", file)]).status, 0, file);
  }
  for (const page of ["index.html", "login.html", "signup.html", "onboarding.html", "dashboard.html"]) {
    const source = read(page);
    for (const match of source.matchAll(/(?:src|href)="((?:js|css|assets)\/[^"#?]+)"/g)) {
      assert.equal(fs.existsSync(path.join(root, match[1])), true, `${page}: ${match[1]}`);
    }
  }
});

test("Sprint 29 introduces no secret, privileged operation, or conflict marker", () => {
  const frontend = [html, dashboard, onboarding, repository, read("js/application-service.js")].join("\n");
  assert.doesNotMatch(frontend, /service_role|SUPABASE_SERVICE|postgres(?:ql)?:\/\/|database[_-]?password/i);
  assert.doesNotMatch([html, dashboard].join("\n"), /run_vault_operational_monitoring|audit_side_mission_invariants|establish_vault_legacy_xp_baseline/);
  assert.doesNotMatch(frontend, /^(?:<<<<<<<|=======|>>>>>>>)/m);
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failures += 1; console.error(`✗ ${name}`); console.error(error); }
  }
  if (failures) process.exitCode = 1;
})();
