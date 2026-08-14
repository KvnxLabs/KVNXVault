"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const dashboard = require("../js/dashboard.js");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const html = read("dashboard.html");
const source = read("js/dashboard.js");
const service = read("js/application-service.js");
const repository = read("js/user-repository.js");
const css = read("css/dashboard.css");
const quickMarkup = html.match(/<nav class="quick-actions"[\s\S]*?<\/nav>/)?.[0] || "";
const quickRenderer = source.match(/const renderQuickActions = \(snapshot\) => \{[\s\S]*?\n  \};/)?.[0] || "";
const tests = [];
const test = (name, run) => tests.push({ name, run });

const sideMission = (state) => ({
  id: "side-1",
  sourceOfferId: "offer-1",
  definition: {
    title: "Restore Mobility",
    description: "Complete one intentional mobility session.",
    estimatedDuration: "15 minutes",
    primarySkill: "fitness",
    skillName: "Fitness",
    overallXPReward: 10,
    skillXPReward: 10,
  },
  lifecycle: { state, rewardAwarded: state === "completed" },
});

test("Quick Actions render inside the authenticated Dashboard home", () => {
  assert.match(html, /data-protected-content hidden[\s\S]*data-dashboard-home[\s\S]*class="quick-actions"/);
  assert.match(quickMarkup, /aria-label="Quick access to Vault features"/);
});

test("Daily Mission remains before and visually larger than Quick Actions", () => {
  assert.ok(html.indexOf("data-mission-card") < html.indexOf("id=\"actions-card-title\""));
  assert.match(css, /\.dashboard-card--missions,[\s\S]*\.dashboard-card--skills \{\s*grid-column: span 6/);
  assert.match(css, /\.dashboard-card--actions \{\s*grid-column: span 5/);
  assert.doesNotMatch(quickMarkup, /app-button--primary/);
});

test("only five implemented destinations appear", () => {
  assert.equal((quickMarkup.match(/<a /g) || []).length, 5);
  assert.doesNotMatch(quickMarkup, /Coming soon|disabled|New mission|Update skill|Add achievement/i);
});

test("Quick Actions use only existing hash routes", () => {
  const routes = [...quickMarkup.matchAll(/href="(#[^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(routes, ["#skills", "#skills", "#vault", "#analytics", "#achievements"]);
  routes.forEach((route) => assert.match(source, new RegExp(`window\\.location\\.hash === "${route}"`)));
});

test("Side Mission Quick Action opens the existing Skill Center flow", () => {
  assert.match(quickMarkup, /data-quick-action="side-mission"[\s\S]*href="#skills"|href="#skills"[\s\S]*data-quick-action="side-mission"/);
  assert.doesNotMatch(quickRenderer, /promote|startSideMission|completeSideMission|requestSkillPathMissionOffers/);
});

test("available capacity presents Side Mission exploration", () => {
  const view = dashboard.quickActions.createViewModel({ sideMissionCapacity: { slotAvailable: true } });
  assert.equal(view.sideAction.title, "Explore Side Missions");
  assert.equal(view.sideAction.href, "#skills");
});

test("planned Side Mission presents the existing start destination", () => {
  const view = dashboard.quickActions.createViewModel({ sideMission: sideMission("ready") });
  assert.equal(view.sideAction.title, "Start Side Mission");
  assert.equal(view.sideAction.state, "Planned");
  assert.match(view.sideAction.detail, /Fitness/);
});

test("active Side Mission presents Continue without changing lifecycle", () => {
  const snapshot = Object.freeze({ sideMission: Object.freeze(sideMission("active")) });
  const before = JSON.stringify(snapshot);
  const view = dashboard.quickActions.createViewModel(snapshot);
  assert.equal(view.sideAction.title, "Continue Side Mission");
  assert.equal(view.sideAction.state, "In Progress");
  assert.equal(JSON.stringify(snapshot), before);
});

test("completed Side Mission presents terminal review rather than reward action", () => {
  const view = dashboard.quickActions.createViewModel({ sideMission: sideMission("completed") });
  assert.equal(view.sideAction.title, "Review Side Mission");
  assert.equal(view.sideAction.state, "Completed");
  assert.doesNotMatch(view.sideAction.title, /complete|claim|reward/i);
});

test("expired Side Mission is represented honestly", () => {
  const view = dashboard.quickActions.createViewModel({ sideMission: sideMission("expired") });
  assert.equal(view.sideAction.state, "Expired");
  assert.match(view.sideAction.detail, /expired/i);
});

test("used capacity remains navigable without implying another reward", () => {
  const view = dashboard.quickActions.createViewModel({ sideMissionCapacity: { slotAvailable: false } });
  assert.equal(view.sideAction.title, "View Side Missions");
  assert.equal(view.sideAction.state, "Capacity Used");
});

test("missing contextual state degrades to a safe existing destination", () => {
  const view = dashboard.quickActions.createViewModel(undefined);
  assert.equal(view.sideAction.href, "#skills");
  assert.equal(Object.isFrozen(view), true);
  assert.equal(Object.isFrozen(view.sideAction), true);
  assert.match(quickRenderer, /catch \{[\s\S]*Static links remain valid/);
});

test("context is reconciled whenever authoritative Side Mission state renders", () => {
  assert.match(source, /const renderSideMission = \(snapshot\) => \{\s*renderQuickActions\(snapshot\)/);
  assert.match(source, /renderSideMission\(applicationSnapshot\)/);
  assert.match(source, /renderSideMission\(result\.snapshot\)/);
});

test("Quick Actions perform no network request or authority mutation", () => {
  assert.doesNotMatch(quickRenderer, /vaultApplication|repository|fetch|rpc|supabase|\.from\(/i);
  assert.doesNotMatch(quickRenderer, /awardXP|completeMission|startMission|promoteSkill|updateStreak|unlockAchievement/i);
  assert.doesNotMatch(repository, /quick.?action/i);
  assert.doesNotMatch(service, /quick.?action/i);
});

test("Quick Actions do not expose Sprint 24 privileged operations", () => {
  assert.doesNotMatch([quickMarkup, quickRenderer].join("\n"), /operational|monitoring|anomal|baseline|attest|prune/i);
});

test("links and contextual status are accessible without color or hover", () => {
  assert.equal((quickMarkup.match(/aria-label="[^"]+"/g) || []).length, 6);
  assert.match(quickMarkup, /data-quick-action-state="side-mission"/);
  assert.match(css, /\.quick-actions__item:focus-visible/);
  assert.match(css, /min-height: 94px/);
});

test("Quick Actions are responsive and reduced-motion safe", () => {
  assert.match(css, /@media \(max-width: 390px\)[\s\S]*\.quick-actions \{\s*grid-template-columns: 1fr/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.quick-actions__item \{\s*transition: none/);
  assert.doesNotMatch(css, /\.quick-actions[^}]*min-width:\s*[4-9]\d{2}px/);
});

test("no database migration 028 was created", () => {
  const migrations = fs.readdirSync(path.join(root, "supabase/migrations"));
  assert.equal(migrations.some((name) => /^202608070028_/.test(name)), false);
});

test("migrations 001 through 027 remain byte-for-byte unchanged", () => {
  const baseline = read("../migrations-pre-sprint25.sha256").trim().split("\n");
  assert.equal(baseline.length, 26);
  baseline.forEach((line) => {
    const [digest, relativePath] = line.trim().split(/\s+/);
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "..", relativePath))).digest("hex");
    assert.equal(actual, digest, relativePath);
  });
});

test("JavaScript and local HTML references remain valid", () => {
  assert.equal(spawnSync(process.execPath, ["--check", path.join(root, "js/dashboard.js")]).status, 0);
  for (const match of html.matchAll(/(?:src|href)="((?:js|css)\/[^"]+)"/g)) {
    assert.equal(fs.existsSync(path.join(root, match[1])), true, match[1]);
  }
});

test("Sprint 25 contains no frontend secret", () => {
  assert.doesNotMatch([html, source, service, repository].join("\n"), /service_role|postgres(?:ql)?:\/\/|SUPABASE_SERVICE|database[_-]?password/i);
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failures += 1; console.error(`✗ ${name}`); console.error(error); }
  }
  if (failures) process.exitCode = 1;
})();
