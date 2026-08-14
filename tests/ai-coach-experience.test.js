"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const coachFactory = require("../js/ai-coach.js");
const dashboard = require("../js/dashboard.js");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const html = read("dashboard.html");
const css = read("css/dashboard.css");
const coachSource = read("js/ai-coach.js");
const dashboardSource = read("js/dashboard.js");
const serviceSource = read("js/application-service.js");
const repositorySource = read("js/user-repository.js");
const migration30Path = "supabase/migrations/202608070030_sprint27_ai_coach_foundation.sql";
const migration30 = read(migration30Path);
const tests = [];
const test = (name, run) => tests.push({ name, run });

const context = (overrides = {}) => ({
  accepted: true,
  contextVersion: 1,
  mode: "overview",
  generatedAt: "2026-08-13T18:00:00.000Z",
  progression: { totalXP: 235 },
  skills: {
    activeCount: 2,
    totalSkillXP: 100,
    top: [
      { key: "front_end_engineering", name: "Front-End Engineering", totalXP: 90 },
      { key: "fitness", name: "Fitness", totalXP: 10 },
    ],
  },
  dailyMission: {
    availability: "mission",
    lifecycleState: "completed",
    title: "Complete a Coding Session",
    focusKey: "programming",
    focusName: "Programming",
    primarySkillName: "Front-End Engineering",
  },
  customization: {
    effectiveFocusKey: "programming",
    effectiveFocusName: "Programming",
    onboardingFocusKey: "programming",
    onboardingFocusName: "Programming",
  },
  sideMission: null,
  skillPaths: { activeCount: 1, active: [{ key: "fitness", name: "Fitness" }] },
  recent: {
    completedCount: 4,
    dailyCompleted: 3,
    sideCompleted: 1,
    skillDistribution: [
      { key: "front_end_engineering", name: "Front-End Engineering", skillXP: 45 },
    ],
  },
  streak: { current: 2, longest: 4 },
  achievements: { unlockedCount: 4, totalCount: 11 },
  ...overrides,
});

const guidance = async (overrides = {}) => coachFactory
  .createCoachService().getAdvice(context(overrides));

test("Sprint 28 creates no Migration 031", () => {
  const files = fs.readdirSync(path.join(root, "supabase/migrations"));
  assert.equal(files.some((name) => /^202608070031_/.test(name)), false);
});

test("Sprint 28 deterministic output uses the versioned advisory schema", async () => {
  const advice = await guidance();
  assert.equal(advice.advisoryVersion, 2);
  for (const key of [
    "summary", "insight", "recommendedFocus", "whyItMatters", "nextStep",
    "momentumInsight", "skillInsight", "destination", "destinationLabel",
  ]) assert.ok(advice[key].length > 0, key);
  assert.equal(Object.isFrozen(advice), true);
});

test("all four advisory modes remain supported presentation intent", async () => {
  for (const mode of coachFactory.MODES) {
    const advice = await guidance({ mode });
    assert.equal(advice.mode, mode);
    assert.equal(advice.advisoryVersion, 2);
  }
});

test("guidance refresh is deterministic for unchanged authoritative context", async () => {
  const first = await guidance();
  const second = await guidance();
  assert.deepEqual(first, second);
});

test("Daily Mission choice-required state produces bounded next-step advice", async () => {
  const advice = await guidance({
    dailyMission: {
      availability: "choice_required", lifecycleState: null, title: null,
      focusKey: "programming", focusName: "Programming", primarySkillName: null,
    },
  });
  assert.match(advice.nextStep, /Choose one of today’s Vault-approved mission paths/);
  assert.equal(advice.destination, "missions");
});

test("completed Daily Mission guidance protects primary progress", async () => {
  const advice = await guidance();
  assert.match(advice.nextStep, /Protect the progress/);
  assert.match(advice.whyItMatters, /primary work is already secured/);
});

test("active Side Mission is advisory and routes to Skill Center", async () => {
  const advice = await guidance({
    sideMission: { lifecycleState: "active", title: "Restore Mobility", skillName: "Fitness" },
  });
  assert.match(advice.nextStep, /Continue Restore Mobility/);
  assert.equal(advice.destination, "skills");
});

test("growing streak produces a consistency observation", async () => {
  const advice = await guidance({ mode: "consistency" });
  assert.match(advice.insight, /current Daily Mission streak is 2 days/);
  assert.match(advice.momentumInsight, /2-day Daily Mission streak active/);
  assert.equal(advice.destination, "analytics");
});

test("strongest and recent skills produce grounded skill guidance", async () => {
  const advice = await guidance({ mode: "skill_focus" });
  assert.match(advice.insight, /strongest developed skill at 90 XP/);
  assert.match(advice.skillInsight, /leads recent development with 45 verified skill XP/);
  assert.equal(advice.destination, "skills");
});

test("different current mission skill explains depth-versus-range tradeoff", async () => {
  const dailyMission = { ...context().dailyMission, primarySkillName: "Back-End Engineering" };
  const advice = await guidance({ dailyMission });
  assert.match(advice.whyItMatters, /strongest lifetime progression/);
  assert.match(advice.whyItMatters, /depth and range/);
});

test("active paths with low Side activity receive optional-practice advice", async () => {
  const recent = { ...context().recent, sideCompleted: 0, dailyCompleted: 4 };
  const advice = await guidance({ mode: "next_step", recent });
  assert.match(advice.nextStep, /Explore one active Skill Path/);
  assert.equal(advice.destination, "skills");
});

test("no recent completions produces an honest consistency rebuild", async () => {
  const recent = {
    completedCount: 0, dailyCompleted: 0, sideCompleted: 0, skillDistribution: [],
  };
  const dailyMission = { ...context().dailyMission, lifecycleState: "ready" };
  const advice = await guidance({ recent, dailyMission, streak: { current: 0, longest: 0 } });
  assert.match(advice.momentumInsight, /No recent verified momentum/);
  assert.match(advice.whyItMatters, /single verified completion/);
});

test("Coach destinations are a closed route allowlist", () => {
  assert.deepEqual(Object.keys(coachFactory.DESTINATIONS), [
    "dashboard", "missions", "skills", "vault", "analytics", "achievements",
  ]);
  Object.values(coachFactory.DESTINATIONS).forEach(({ href }) => {
    assert.match(href, /^#(?:dashboard|missions|skills|vault|analytics|achievements)$/);
  });
});

test("invalid or mismatched destinations are rejected", () => {
  const candidate = {
    advisoryVersion: 2,
    source: "ai",
    mode: "overview",
    summary: "Summary",
    insight: "Insight",
    recommendedFocus: "Fitness",
    whyItMatters: "Why",
    nextStep: "Review progress.",
    momentumInsight: "Momentum",
    skillInsight: "Skill",
    destination: "https://attacker.example",
    destinationLabel: "Leave KVNX",
    generatedAt: "2026-08-13T18:00:00.000Z",
  };
  assert.equal(coachFactory.validateAdvisoryResponse(candidate), null);
  assert.equal(coachFactory.validateAdvisoryResponse({
    ...candidate,
    destination: "skills",
    destinationLabel: "Open arbitrary URL",
  }), null);
});

test("authoritative fields remain invalid in the richer schema", () => {
  const candidate = {
    advisoryVersion: 2, source: "ai", mode: "overview", summary: "Summary",
    insight: "Insight", recommendedFocus: "Fitness", whyItMatters: "Why",
    nextStep: "Review progress.", momentumInsight: "Momentum", skillInsight: "Skill",
    destination: "skills", destinationLabel: "Review Skill Center",
    generatedAt: "2026-08-13T18:00:00.000Z", preferenceMutation: "fitness",
  };
  assert.equal(coachFactory.validateAdvisoryResponse(candidate), null);
});

test("legacy Sprint 27 provider responses remain safely compatible", () => {
  const response = {
    source: "ai", mode: "overview", summary: "Summary", insight: "Insight",
    recommendedFocus: "Fitness", nextStep: "Review the Skill Center.",
    generatedAt: "2026-08-13T18:00:00.000Z",
  };
  assert.equal(coachFactory.validateAdvisoryResponse(response)?.source, "ai");
});

test("Coach surface renders richer semantic guidance below Quick Actions", () => {
  const coachStart = html.indexOf("<section class=\"dashboard-card dashboard-card--coach");
  const coachEnd = html.indexOf("<section class=\"missions-view\"", coachStart);
  const coachMarkup = html.slice(coachStart, coachEnd);
  assert.ok(html.indexOf("data-mission-card") < html.indexOf("data-coach-card"));
  assert.ok(html.indexOf("id=\"actions-card-title\"") < html.indexOf("data-coach-card"));
  for (const marker of [
    "What the Coach notices", "Why this matters", "Momentum", "Skill development",
    "Recommended focus", "Next step",
  ]) assert.match(coachMarkup, new RegExp(marker));
  assert.doesNotMatch(coachMarkup, /app-button--primary/);
});

test("mode controls are accessible and map exactly to the closed modes", () => {
  assert.match(html, /role="group" aria-label="Coach guidance view"/);
  const modes = [...html.matchAll(/data-coach-mode="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(modes, coachFactory.MODES);
  assert.match(html, /data-coach-status role="status" aria-live="polite" aria-atomic="true"/);
  assert.doesNotMatch(html, /data-coach-content[^>]*aria-live/);
});

test("Coach destination CTA is an anchor and navigation only", () => {
  assert.match(html, /<a class="coach-card__destination" href="#dashboard" data-coach-destination>/);
  const renderer = dashboardSource.match(/const renderCoach = \(snapshot\) => \{[\s\S]*?\n  \};/)?.[0] || "";
  assert.match(renderer, /coachDestination\.href = viewModel\.destination\.href/);
  assert.doesNotMatch(renderer, /setMissionCustomization|routeAction|complete|start|replace|award|unlock/i);
});

test("Dashboard view model distrusts advice destinations", () => {
  const view = dashboard.coach.createViewModel({ coach: {
    available: true,
    status: "ready",
    advice: {
      source: "deterministic", mode: "overview", summary: "Summary", insight: "Insight",
      recommendedFocus: "Fitness", nextStep: "Next", destination: "javascript:alert(1)",
    },
  } });
  assert.deepEqual(view.destination, { href: "#dashboard", label: "Return to Dashboard" });
});

test("refresh and mode changes use only the read-only Coach loader", () => {
  const handler = dashboardSource.match(/const requestCoachGuidance = async \(mode\) => \{[\s\S]*?\n  \};/)?.[0] || "";
  assert.match(handler, /vaultApplication\.loadCoach/);
  assert.match(handler, /aria-busy/);
  assert.match(handler, /coachRequestInFlight/);
  assert.doesNotMatch(handler, /setMissionCustomization|routeAction|startSideMission|completeSideMission|requestReplacement/);
});

test("Coach remains downstream of protected restoration", () => {
  assert.ok(dashboardSource.indexOf("renderCoach(applicationSnapshot)")
    < dashboardSource.indexOf("protectedContentGate.reveal()"));
  assert.match(serviceSource, /getVaultCoachContext\("overview"\)\.catch\(\(\) => null\)/);
  assert.match(serviceSource, /coach = Object\.freeze\(\{ available: false, status: "unavailable", advice: null \}\)/);
});

test("Coach failure copy preserves core dashboard availability", () => {
  assert.match(html, /Guidance is temporarily unavailable\. Your missions and progression remain fully available\./);
  assert.doesNotMatch(serviceSource.match(/const loadCoach = async[\s\S]*?\n    };/)?.[0] || "", /throw error/);
});

test("responsive and focus styles support mobile and keyboard use", () => {
  assert.match(css, /\.coach-card__modes button:focus-visible/);
  assert.match(css, /\.coach-card__destination:focus-visible/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.coach-card__insights \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.coach-card__modes[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(css, /\.coach-card[^}]*min-width:\s*[4-9]\d{2}px/);
});

test("Coach frontend contains no provider network, secret, or operational access", () => {
  const frontend = [html, coachSource, dashboardSource, serviceSource, repositorySource].join("\n");
  assert.doesNotMatch(coachSource, /fetch\(|XMLHttpRequest|WebSocket|\.rpc\(|\.from\(/i);
  assert.doesNotMatch(frontend, /OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|sk-[A-Za-z0-9_-]{20,}/i);
  assert.doesNotMatch(frontend, /run_vault_operational_monitoring|get_vault_operational_health|vault_operational_alert/i);
});

test("Coach frontend exposes no mission, preference, progression, or reward authority", () => {
  const coachUi = [coachSource, dashboardSource.match(/const KVNXCoachExperience[\s\S]*?const KVNXMissionCustomizationExperience/)?.[0] || ""].join("\n");
  assert.doesNotMatch(coachUi, /setMissionCustomization|completeSideMission|startSideMission|requestReplacement|selectDailyMission|awardXP|unlockAchievement/i);
  assert.doesNotMatch(coachSource, /xpAward\s*:|skillXpAward\s*:|overallXPReward\s*:|skillXPReward\s*:/i);
});

test("Daily and Side reward contracts remain unchanged", () => {
  const daily = read("supabase/migrations/202608070012_sprint11_1_developer_test_panel.sql");
  const side = read("supabase/migrations/202608070022_sprint22_side_mission_lifecycle.sql");
  assert.match(daily, /if v_reward <> 25 then/);
  assert.match(daily, /v_skill_reward := 15/);
  assert.match(side, /v_total_xp := v_total_xp \+ 10/);
  assert.match(side, /v_skill_total := v_skill_total \+ 10/);
});

test("historical migrations 001 through 030 remain unchanged", () => {
  const baseline = read("../migrations-pre-sprint27.sha256").trim().split("\n");
  assert.equal(baseline.length, 28);
  baseline.forEach((line) => {
    const [digest, relativePath] = line.trim().split(/\s+/);
    const actual = crypto.createHash("sha256")
      .update(fs.readFileSync(path.join(root, "..", relativePath))).digest("hex");
    assert.equal(actual, digest, relativePath);
  });
  const migration30Digest = crypto.createHash("sha256").update(migration30).digest("hex");
  assert.equal(migration30Digest, "ef3ddf1f6626f1b4d59eb2fdb89d3a4e6412d365ac7700be938d66e4d5944dc5");
});

test("JavaScript syntax and local HTML references remain valid", () => {
  for (const file of ["ai-coach.js", "dashboard.js", "application-service.js", "user-repository.js"]) {
    assert.equal(spawnSync(process.execPath, ["--check", path.join(root, "js", file)]).status, 0, file);
  }
  for (const match of html.matchAll(/(?:src|href)="((?:js|css)\/[^"#]+)"/g)) {
    assert.equal(fs.existsSync(path.join(root, match[1])), true, match[1]);
  }
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failures += 1; console.error(`✗ ${name}`); console.error(error); }
  }
  if (failures) process.exitCode = 1;
})();
