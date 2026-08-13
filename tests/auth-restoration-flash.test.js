"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const dashboard = require("../js/dashboard.js");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const hash = (relativePath) => crypto.createHash("sha256")
  .update(fs.readFileSync(path.join(root, relativePath)))
  .digest("hex");

const html = read("dashboard.html");
const components = read("css/components.css");
const dashboardCSS = read("css/dashboard.css");
const dashboardSource = read("js/dashboard.js");
const protectedPageSource = read("js/protected-page.js");

const createElement = ({ hidden = false } = {}) => {
  const classes = new Set();
  const attributes = new Map();
  return {
    hidden,
    textContent: "",
    classList: {
      add: (value) => classes.add(value),
      remove: (value) => classes.delete(value),
      contains: (value) => classes.has(value),
    },
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: (name) => attributes.get(name),
  };
};

const createGateHarness = () => {
  const loading = createElement();
  const content = createElement({ hidden: true });
  const title = createElement();
  const message = createElement();
  const retry = createElement({ hidden: true });
  const gate = dashboard.protectedContent.create({ loading, content, title, message, retry });
  return { gate, loading, content, title, message, retry };
};

const protectedShellStart = html.indexOf('<div class="shell" data-protected-content hidden>');
const protectedShell = protectedShellStart >= 0 ? html.slice(protectedShellStart) : "";
const gateSource = dashboardSource.match(/const KVNXProtectedContentGate = \(\(\) => \{[\s\S]*?\n\}\)\(\);/)?.[0] || "";
const initialRenderSource = dashboardSource.match(/renderCoordinator\(coordinatorSnapshot\);[\s\S]*?window\.addEventListener\("hashchange"/)?.[0] || "";
const navigationSource = dashboardSource.match(/const renderApplicationView = \(\) => \{[\s\S]*?\n  \};/)?.[0] || "";

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("default Guest identity is inside the hidden protected product shell", () => {
  assert.match(html, /<div class="shell" data-protected-content hidden>/);
  assert.match(protectedShell, /data-profile-name>Guest</);
});

test("default 75 XP is inside the hidden protected product shell", () => {
  assert.match(protectedShell, /data-xp-value>75</);
});

test("placeholder mission is inside the hidden protected product shell", () => {
  assert.match(protectedShell, /Build focused momentum/);
  assert.match(protectedShell, /Complete one intentional work session/);
});

test("placeholder skill state is inside the hidden protected product shell", () => {
  assert.match(protectedShell, /data-skills-count>0 active</);
});

test("placeholder streak state is inside the hidden protected product shell", () => {
  assert.match(protectedShell, /No active streak yet/);
});

test("the neutral loading gate is visible from initial HTML parsing", () => {
  assert.match(html, /data-protected-loading role="status"/);
  assert.match(html, /Restoring your Vault/);
  assert.doesNotMatch(html.match(/<main class="protected-restoration"[\s\S]*?<\/main>/)?.[0] || "", /Guest|Explorer|75 XP|Build focused momentum|No active streak/);
});

test("authenticated product content is revealed only after authoritative render", () => {
  assert.match(initialRenderSource, /renderMissionCenter\(applicationSnapshot\);[\s\S]*renderApplicationView\(\);[\s\S]*protectedContentGate\.reveal\(\)/);
  const { gate, loading, content } = createGateHarness();
  gate.reveal();
  assert.equal(loading.hidden, true);
  assert.equal(content.hidden, false);
});

test("restoration failure keeps product content hidden", () => {
  const { gate, loading, content, title, message, retry } = createGateHarness();
  gate.fail();
  assert.equal(content.hidden, true);
  assert.equal(loading.hidden, false);
  assert.equal(loading.classList.contains("is-error"), true);
  assert.equal(loading.getAttribute("role"), "alert");
  assert.equal(title.textContent, "We couldn't restore your Vault.");
  assert.equal(message.textContent, "Check your connection, then refresh the page.");
  assert.equal(retry.hidden, false);
});

for (const route of ["missions", "vault", "analytics", "achievements"]) {
  test(`#${route} survives restoration without hash mutation`, () => {
    assert.match(html, new RegExp(`href="#${route}"`));
    assert.match(navigationSource, new RegExp(`window\\.location\\.hash === "#${route}"`));
    assert.doesNotMatch(gateSource, /location\.(?:hash|replace|assign)|history\./);
  });
}

test("refresh and navigation do not reroll the mission", () => {
  assert.doesNotMatch(navigationSource, /requestDailyMission|requestReplacement|requestMissionAction|initialize/);
  assert.equal((dashboardSource.match(/vaultApplication\.initialize\(\)/g) || []).length, 1);
});

test("the restoration gate uses no arbitrary timer", () => {
  assert.doesNotMatch(gateSource, /setTimeout|setInterval|requestAnimationFrame|Date\.now/);
});

test("reduced-motion handling remains intact", () => {
  assert.match(components, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(dashboardCSS, /@media \(prefers-reduced-motion: reduce\)/);
});

test("existing protected-page authentication and onboarding routing remain intact", () => {
  assert.equal(hash("js/protected-page.js"), "9c7a92949b84d59aadf9647ef04c6c1d31688623a8f4ad7ed0bd0b68f399f71d");
  assert.match(protectedPageSource, /restoreRouteState/);
  assert.match(protectedPageSource, /evaluateProtectedRoute/);
});

test("the auth-pending exception applies only to the explicitly gated dashboard", () => {
  assert.match(components, /\.auth-pending body:not\(\[data-protected-loading-page\]\)/);
  assert.match(components, /\.auth-pending body\[data-protected-loading-page\]/);
  assert.doesNotMatch(read("onboarding.html"), /data-protected-loading-page/);
});

test("auth and routing remain unchanged while approved read-boundary modules retain current fingerprints", () => {
  const expected = {
    "js/auth-service.js": "3b0b2ac7b341528ac946000ea5eb8e72860b1f1ffefc0542f0f3eb48c3db95d5",
    "js/route-guard.js": "17ca3c71023d603f951cb8b593d57e09a1e3dac3e802cda32a4344b0897d71ad",
    "js/application-service.js": "5fa58695c22110408147fa03f930a7ea75baa5dd3f5a31c34c368db1998e5063",
    "js/user-repository.js": "db03e585ca6928e3dcdf6f90a0af2ea21cd2ef8bc63d7a67aa10d45332e42233",
  };
  Object.entries(expected).forEach(([file, digest]) => assert.equal(hash(file), digest, file));
  assert.doesNotMatch(gateSource, /supabase|repository|vaultApplication|\.rpc\(|\.from\(/i);
});

test("the Sprint 16 hotfix added no migration and migrations 001 through 016 remain immutable", () => {
  assert.equal(fs.existsSync(path.join(root, "supabase/migrations/202608070017_sprint16_mission_center.sql")), false);
  assert.equal(fs.existsSync(path.join(root, "supabase/migrations/202608070017_sprint16_1_auth_restoration_flash.sql")), false);
  const baseline = read("../migrations-pre-sprint16.sha256").trim().split("\n");
  assert.equal(baseline.length, 15);
  baseline.forEach((line) => {
    const [digest, relativePath] = line.trim().split(/\s+/);
    const actual = crypto.createHash("sha256")
      .update(fs.readFileSync(path.join(root, "..", relativePath)))
      .digest("hex");
    assert.equal(actual, digest, relativePath);
  });
});

test("the hotfix introduces no browser authority or secret", () => {
  const boundary = [html, components, gateSource].join("\n");
  assert.doesNotMatch(boundary, /service_role|postgres(?:ql)?:\/\/|SUPABASE_SERVICE|database[_-]?password/i);
  assert.doesNotMatch(gateSource, /missionId|xpReward|skillXP|streak|dailyKey|timezone|userId/);
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try {
      await run();
      console.log(`✓ ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`✗ ${name}`);
      console.error(error);
    }
  }
  if (failures) process.exitCode = 1;
})();
