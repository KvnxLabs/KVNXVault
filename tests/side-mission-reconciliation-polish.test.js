"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const dashboardExperiences = require("../js/dashboard.js");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const source = read("js/dashboard.js");
const css = read("css/dashboard.css");
const service = read("js/application-service.js");
const repository = read("js/user-repository.js");
const migration22 = read("supabase/migrations/202608070022_sprint22_side_mission_lifecycle.sql");
const actionFlow = source.match(/let sideMissionActionInFlight = false;[\s\S]*?sideMissionCompleteButtons\.forEach/)?.[0] || "";
const renderFlow = source.match(/const renderSideMission = \(snapshot\) => \{[\s\S]*?\n  \};/)?.[0] || "";

const tests = [];
const test = (name, run) => tests.push({ name, run });
const snapshotFor = (state) => ({
  sideMission: {
    id: "mission",
    sourceOfferId: "offer",
    definition: {
      title: "Restore Mobility",
      description: "Complete a deliberate mobility session.",
      estimatedDuration: "20 minutes",
      primarySkill: "fitness",
      skillName: "Fitness",
      overallXPReward: 10,
      skillXPReward: 10,
    },
    lifecycle: {
      state,
      rewardAwarded: state === "completed",
    },
  },
});

test("READY exposes only Start Side Mission", () => {
  const model = dashboardExperiences.sideMission.createViewModel(snapshotFor("ready"));
  assert.equal(model.canStart, true);
  assert.equal(model.canComplete, false);
});

test("ACTIVE exposes only Complete Side Mission", () => {
  const model = dashboardExperiences.sideMission.createViewModel(snapshotFor("active"));
  assert.equal(model.canStart, false);
  assert.equal(model.canComplete, true);
});

test("COMPLETED is terminal with no mutation actions", () => {
  const model = dashboardExperiences.sideMission.createViewModel(snapshotFor("completed"));
  assert.equal(model.stateLabel, "Completed");
  assert.equal(model.rewardAwarded, true);
  assert.equal(model.canStart, false);
  assert.equal(model.canComplete, false);
});

test("EXPIRED is terminal with no mutation actions or reward implication", () => {
  const model = dashboardExperiences.sideMission.createViewModel(snapshotFor("expired"));
  assert.equal(model.stateLabel, "Expired");
  assert.equal(model.rewardAwarded, false);
  assert.equal(model.canStart, false);
  assert.equal(model.canComplete, false);
});

test("button visibility is always derived from the authoritative view model", () => {
  assert.match(renderFlow, /button\.hidden = !viewModel\.canStart/);
  assert.match(renderFlow, /button\.hidden = !viewModel\.canComplete/);
});

test("author CSS cannot override terminal hidden actions", () => {
  assert.match(css, /\.side-mission-panel__actions \.app-button\[hidden\] \{ display: none; \}/);
});

test("hidden terminal actions are removed from keyboard focus", () => {
  assert.match(renderFlow, /button\.hidden = !viewModel\.canStart/);
  assert.match(renderFlow, /button\.hidden = !viewModel\.canComplete/);
  assert.match(css, /\.app-button\[hidden\] \{ display: none; \}/);
});

test("successful response replaces the local snapshot before status interpretation", () => {
  const snapshotIndex = actionFlow.indexOf("applicationSnapshot = result.snapshot");
  const acceptedIndex = actionFlow.indexOf("if (!result.accepted)");
  assert.ok(snapshotIndex >= 0 && acceptedIndex > snapshotIndex);
});

test("successful response renders terminal controls before ancillary redraws", () => {
  const sideIndex = actionFlow.indexOf("renderSideMission(result.snapshot)");
  const progressionIndex = actionFlow.indexOf("renderProgression(result.snapshot.progression)");
  assert.ok(sideIndex >= 0 && progressionIndex > sideIndex);
});

test("post-commit rendering errors cannot report a mutation failure", () => {
  const postCommitCatch = actionFlow.match(/catch \(renderError\) \{[\s\S]*?\n    \}/)?.[0] || "";
  assert.match(postCommitCatch, /renderSideMission\(result\.snapshot\)/);
  assert.doesNotMatch(postCommitCatch, /could not be updated|saved state remains unchanged/);
});

test("completed rendering clears stale mutation copy with verified confirmation", () => {
  assert.match(renderFlow, /viewModel\.state === "completed"[\s\S]*secured/);
  assert.match(actionFlow, /renderSideMission\(result\.snapshot\)/);
});

test("a duplicate terminal retry reconciles the returned completed snapshot", () => {
  assert.match(actionFlow, /A retry may be rejected[\s\S]*already[\s\S]*terminal/);
  assert.match(actionFlow, /\["completed", "expired"\]\.includes\(state\)/);
});

test("refresh and logout-login restore the terminal state through the zero-argument read", () => {
  assert.match(service, /repository\.getSideMission\(\)/);
  assert.match(repository, /database\.rpc\("get_side_mission"\)/);
  assert.doesNotMatch(repository.match(/const getSideMission = async \(\) => \{[\s\S]*?\n    \};/)?.[0] || "", /userId|dailyKey|missionId/);
});

test("collapsed positive-XP cards align to content height", () => {
  assert.match(css, /\.skill-center__grid \{[\s\S]*?align-items: start;/);
  assert.match(css, /\.skill-center__card \{[\s\S]*?align-self: start;[\s\S]*?height: auto;/);
});

test("left collapsed and right expanded cards do not stretch one another", () => {
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)[\s\S]*?align-items: start/);
});

test("left expanded and right collapsed cards use the same independent-height rule", () => {
  assert.match(css, /\.skill-center__card[\s\S]*?align-self: start/);
  assert.doesNotMatch(css, /\.skill-center__card\s*\{[^}]*height:\s*100%/);
});

test("both expanded native disclosures keep full detail content", () => {
  assert.match(source, /document\.createElement\(skill\.expandable \? "details" : "article"\)/);
  assert.match(source, /card\.append\(heading, overview, detail, pathControl\)/);
  assert.match(css, /\.skill-center__card\.is-active\[open\] summary::after/);
});

test("single positive-XP skill remains content-sized", () => {
  assert.match(css, /\.skill-center__card \{[\s\S]*?height: auto/);
});

test("mobile remains a single-column card layout", () => {
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*?\.skill-center__grid \{ grid-template-columns: minmax\(0, 1fr\); \}/);
});

test("zero-XP Sprint 17.1 cards remain static and compact", () => {
  assert.match(source, /expandable: totalXP > 0/);
  assert.match(source, /if \(!skill\.expandable\)/);
  assert.match(css, /\.skill-center__static[\s\S]*?min-height: 82px/);
});

test("Side Mission +10 and +10 authority is unchanged", () => {
  assert.match(migration22, /v_total_xp := v_total_xp \+ 10/);
  assert.match(migration22, /v_skill_total := v_skill_total \+ 10/);
  assert.equal(crypto.createHash("sha256").update(migration22).digest("hex"), "ad958272c69b4050779e5c028ed7fa6ad27b2765ba28a7fcd1705180052e7efc");
});

test("history, streak exclusion, and Daily Complete isolation are unchanged", () => {
  assert.match(migration22, /insert into public\.mission_history/);
  assert.match(migration22, /new\.mission_type <> 'daily'/);
  assert.doesNotMatch(migration22.match(/create or replace function public\.complete_side_mission[\s\S]*?grant execute/)?.[0] || "", /daily_mission_state|replacements_used/);
});

test("Application Service and Repository contracts are unchanged", () => {
  assert.equal(crypto.createHash("sha256").update(service).digest("hex"), "a231d71b5da5e28ea5c1ff53ced7b79d782c95d647799b103852850e9f6e0932");
  assert.equal(crypto.createHash("sha256").update(repository).digest("hex"), "967b012508d0c12832349d02057bc056b594a99b41af69b8282d8067d51917ef");
});

test("migrations 001 through 022 remain byte-for-byte unchanged", () => {
  const baseline = read("../migrations-pre-sprint22.1.sha256").trim().split("\n");
  assert.equal(baseline.length, 21);
  baseline.forEach((line) => {
    const [digest, relativePath] = line.trim().split(/\s+/);
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "..", relativePath))).digest("hex");
    assert.equal(actual, digest, relativePath);
  });
});

test("Sprint 22.1 remains frontend-only while Sprint 23 owns Migration 023", () => {
  const migrations = fs.readdirSync(path.join(root, "supabase/migrations"));
  assert.deepEqual(
    migrations.filter((name) => /^202608070023_/.test(name)),
    ["202608070023_sprint23_side_mission_observability.sql"],
  );
  assert.equal(
    crypto.createHash("sha256").update(migration22).digest("hex"),
    "ad958272c69b4050779e5c028ed7fa6ad27b2765ba28a7fcd1705180052e7efc",
  );
});

test("JavaScript syntax, reduced motion, and secret boundaries remain valid", () => {
  for (const file of ["js/dashboard.js", "js/application-service.js", "js/user-repository.js"]) {
    assert.equal(spawnSync(process.execPath, ["--check", path.join(root, file)]).status, 0, file);
  }
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch([source, service, repository].join("\n"), /SUPABASE_SERVICE_ROLE_KEY|service_role\s*[:=]|postgres(?:ql)?:\/\//i);
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failures += 1; console.error(`✗ ${name}`); console.error(error); }
  }
  if (failures) process.exitCode = 1;
})();
