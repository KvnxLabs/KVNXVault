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
const migration8 = read("supabase/migrations/202608070008_sprint10_skill_progression.sql");
const migration15 = read("supabase/migrations/202608070015_sprint14_authoritative_streaks.sql");

const thresholds = [
  { level: 1, totalXP: 0 }, { level: 2, totalXP: 100 },
  { level: 3, totalXP: 250 }, { level: 4, totalXP: 450 },
  { level: 5, totalXP: 700 },
];
const progressionEngine = {
  createProgression: (totalXP, configuration) => ({ totalXP, configuration }),
  getSnapshot: ({ totalXP }) => {
    const current = thresholds.filter((threshold) => totalXP >= threshold.totalXP).at(-1);
    const next = thresholds.find((threshold) => threshold.level === current.level + 1) || null;
    const currentLevelXP = totalXP - current.totalXP;
    const range = next ? next.totalXP - current.totalXP : Math.max(1, currentLevelXP);
    return Object.freeze({
      currentLevel: current.level,
      nextLevel: next?.level || null,
      currentLevelXP,
      xpForNextLevel: next?.totalXP || null,
      xpRemaining: next ? next.totalXP - totalXP : 0,
      progressPercentage: next ? Math.round((currentLevelXP / range) * 100) : 100,
      isMaxLevel: !next,
    });
  },
};

const snapshot = Object.freeze({
  skillCatalog: Object.freeze([
    Object.freeze({ key: "front_end_engineering", name: "Front-End Engineering", sortOrder: 10 }),
    Object.freeze({ key: "problem_solving", name: "Problem Solving", sortOrder: 20 }),
    Object.freeze({ key: "communication", name: "Communication", sortOrder: 30 }),
  ]),
  skills: Object.freeze([
    Object.freeze({ key: "problem_solving", name: "Problem Solving", totalXP: 145, todayGain: 15 }),
    Object.freeze({ key: "front_end_engineering", name: "Front-End Engineering", totalXP: 145, todayGain: 0 }),
  ]),
  history: Object.freeze([
    Object.freeze({ historyId: "h1", status: "completed", title: "Refine One Weak Point", primarySkillKey: "problem_solving", skillXPEarned: 15, completedAt: "2026-08-13T14:00:00.000Z" }),
    Object.freeze({ historyId: "h2", status: "completed", title: "Complete a Coding Session", primarySkillKey: "front_end_engineering", skillXPEarned: 15, completedAt: "2026-08-12T14:00:00.000Z" }),
    Object.freeze({ historyId: "h3", status: "completed", title: "Legacy Mission", primarySkillKey: null, skillXPEarned: 15, completedAt: "2026-08-11T14:00:00.000Z" }),
  ]),
});

const view = (options) => dashboard.skillCenter.createViewModel(snapshot, progressionEngine, options);
const tests = [];
const test = (name, run) => tests.push({ name, run });

test("#skills route is activated in the existing dashboard shell", () => {
  assert.match(html, /href="#skills"\s+data-view-link="skills"/);
  assert.match(source, /window\.location\.hash === "#skills"/);
});
test("#skills survives protected restoration without hash mutation", () => {
  assert.match(source, /renderSkillCenter\(applicationSnapshot\);[\s\S]*renderApplicationView\(\);[\s\S]*protectedContentGate\.reveal\(\)/);
  assert.doesNotMatch(source, /location\.hash\s*=\s*"#dashboard"/);
});
test("no default Skill Center product state flashes before restoration", () => {
  assert.match(html, /data-protected-content hidden[\s\S]*data-skills-view hidden/);
  assert.match(html, /data-protected-loading[\s\S]*Restoring your Vault/);
});
test("canonical catalog and progression are merged read-only", () => {
  assert.deepEqual(view().skills.map((skill) => skill.key), ["front_end_engineering", "problem_solving", "communication"]);
});
test("active skills retain authoritative total XP", () => {
  assert.equal(view().skills.find((skill) => skill.key === "problem_solving").totalXP, 145);
});
test("catalog skills without progression render Not Started", () => {
  const skill = view().skills.find((entry) => entry.key === "communication");
  assert.equal(skill.active, false);
  assert.equal(skill.expandable, false);
  assert.equal(skill.stateLabel, "Not Started");
});
test("Not Started skills render as non-expandable article cards", () => {
  assert.match(source, /document\.createElement\(skill\.expandable \? "details" : "article"\)/);
  assert.match(source, /if \(!skill\.expandable\) \{[\s\S]*card\.append\(heading\);[\s\S]*grid\.append\(card\);[\s\S]*return;/);
});
test("Not Started cards expose no disclosure control or aria-expanded state", () => {
  const skillCenterRenderer = source.match(/const renderSkillCenter = \(snapshot\) => \{[\s\S]*?\n  const renderAchievements/)?.[0] || "";
  assert.doesNotMatch(skillCenterRenderer, /setAttribute\("aria-expanded"/);
  assert.match(css, /\.skill-center__card\.is-active summary::after/);
  assert.doesNotMatch(css, /\.skill-center__card\.is-not-started[^\n]*::after/);
});
test("Not Started cards stop before detail and progress construction", () => {
  assert.match(source, /if \(!skill\.expandable\) \{[\s\S]*return;[\s\S]*const overview = document\.createElement/);
  assert.match(source, /return;[\s\S]*detailHeading\.textContent = "Recent verified gains"/);
});
test("zero authoritative XP remains Not Started", () => {
  const skill = view().skills.find((entry) => entry.key === "communication");
  assert.equal(skill.totalXP, 0);
  assert.equal(skill.active, false);
  assert.equal(skill.expandable, false);
});
test("first positive authoritative skill XP activates disclosure after reconciliation", () => {
  const reconciled = dashboard.skillCenter.createViewModel({
    ...snapshot,
    skills: [...snapshot.skills, { key: "communication", name: "Communication", totalXP: 15, todayGain: 15 }],
  }, progressionEngine);
  const skill = reconciled.skills.find((entry) => entry.key === "communication");
  assert.equal(skill.totalXP, 15);
  assert.equal(skill.active, true);
  assert.equal(skill.expandable, true);
});
test("skill levels use the injected existing progression engine", () => {
  assert.equal(view().highestSkill.level, 2);
  assert.match(source, /createProgression\(totalXP, "skill"\)/);
});
test("current-level progress percentage is derived correctly", () => {
  assert.equal(view().highestSkill.progressPercentage, 30);
});
test("XP remaining comes from the existing progression engine", () => {
  assert.equal(view().highestSkill.xpRemaining, 105);
});
test("total Skill XP sums authoritative persisted totals", () => assert.equal(view().totalSkillXP, 290));
test("active skill count excludes zero-XP catalog entries", () => assert.equal(view().activeCount, 2));
test("highest skill is established only from positive authoritative XP", () => assert.equal(view().highestSkill.name, "Front-End Engineering"));
test("highest-skill ties resolve by canonical catalog order", () => assert.equal(view().highestSkill.key, "front_end_engineering"));
test("most recent developed skill comes from attributed completed history", () => assert.equal(view().recentlyDeveloped.key, "problem_solving"));
test("missing historical attribution is not fabricated", () => {
  assert.equal(view().skills.flatMap((skill) => skill.recentGains).some((gain) => gain.title === "Legacy Mission"), false);
  assert.match(source, /No attributed gains appear in the restored recent Vault window/);
});
test("recent verified gains preserve server-returned award values", () => assert.equal(view().highestSkill.recentGains[0].skillXPEarned, 15));
test("recent gain dates are formatted from authoritative timestamps", () => assert.match(view().highestSkill.recentGains[0].dateLabel, /Aug 12, 2026/));
test("active skill detail retains native keyboard-operable disclosure", () => {
  assert.equal(view().highestSkill.expandable, true);
  assert.match(source, /document\.createElement\(skill\.expandable \? "details" : "article"\)/);
  assert.match(source, /document\.createElement\(skill\.expandable \? "summary" : "div"\)/);
});
test("View in Vault uses the existing hash route", () => assert.match(source, /vaultLink\.href = "#vault"/));
test("Dashboard Skills Overview remains present", () => assert.match(html, /Skills Overview[\s\S]*data-skill-list/));
test("Dashboard links to the dedicated Skill Center", () => assert.match(html, /View Skill Center[\s\S]*#skills|href="#skills"[^>]*>View Skill Center/));
test("accepted completion reconciles the Skill Center", () => assert.match(source, /renderSkills\(applicationResult\.snapshot\.skills\);[\s\S]*renderSkillCenter\(applicationResult\.snapshot\)/));
test("refresh restoration uses the immutable Application Service snapshot", () => {
  assert.match(service, /skillCatalog:\s*Object\.freeze/);
  assert.match(service, /history:\s*Object\.freeze/);
});
test("logout and login reuse the same authoritative restoration path", () => {
  assert.equal((source.match(/vaultApplication\.initialize\(\)/g) || []).length, 1);
  assert.match(source, /vaultApplication\.signOut\(\)/);
});
test("opening Skill Center does not change overall XP", () => assert.doesNotMatch(source.match(/const renderSkillCenter[\s\S]*?\n  };/)?.[0] || "", /addXP|xpAwarded|complete\(/));
test("opening Skill Center does not change skill XP", () => assert.doesNotMatch(source.match(/const renderSkillCenter[\s\S]*?\n  };/)?.[0] || "", /skillXPAwarded|setSkill|saveSkill/));
test("opening Skill Center does not change streak", () => assert.doesNotMatch(source.match(/const renderSkillCenter[\s\S]*?\n  };/)?.[0] || "", /currentStreak\s*=|updateStreak/));
test("opening Skill Center does not unlock achievements", () => assert.doesNotMatch(source.match(/const renderSkillCenter[\s\S]*?\n  };/)?.[0] || "", /showAchievementUnlocks|unlockAchievement/));
test("Skill Center exposes no browser skill setter", () => assert.doesNotMatch([source, repository].join("\n"), /setSkill|saveSkill|updateSkillXP|awardSkillXP/i));
test("dashboard rendering performs no direct Supabase operation", () => assert.doesNotMatch(source, /supabase|\.rpc\(|\.from\(/i));
test("Skill Center exposes no mission catalog", () => assert.doesNotMatch(html.match(/data-skills-view[\s\S]*?data-achievements-view/)?.[0] || "", /templateKey|mission_catalog|selection_weight/i));
test("brand-new users receive an intentional empty state", () => {
  const empty = dashboard.skillCenter.createViewModel({ skillCatalog: snapshot.skillCatalog, skills: [], history: [] }, progressionEngine);
  assert.equal(empty.empty, true);
  assert.match(html, /No mastery recorded yet/);
});
test("Skill Center has an honest restoration error state", () => assert.match(html, /data-skill-center-error hidden[\s\S]*Your authoritative progression remains unchanged/));
test("filter controls are keyboard-native and expose pressed state", () => assert.match(html, /data-skill-filter="all" aria-pressed="true"/));
test("Active and Not Started filters use restored data only", () => {
  assert.equal(view({ filter: "active" }).skills.length, 2);
  assert.equal(view({ filter: "not-started" }).skills.length, 1);
});
test("sort options are deterministic", () => assert.deepEqual(view({ sort: "name" }).skills.map((skill) => skill.name), ["Communication", "Front-End Engineering", "Problem Solving"]));
test("progress bars provide accessible numeric text", () => assert.match(source, /setAttribute\("aria-valuenow", String\(skill\.progressPercentage\)\)/));
test("Skill Center stacks without horizontal overflow and respects reduced motion", () => {
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.skill-center__grid/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
test("overall completion reward remains exactly 25 XP", () => assert.match(migration8, /v_reward := \(v_daily_state\.mission_definition ->> 'xpReward'\)::integer;[\s\S]*if v_reward <> 25 then/i));
test("mapped skill completion reward remains exactly 15 XP", () => assert.match(migration8, /v_skill_reward := 15;/i));
test("Mission Center, Vault, Analytics, and loading gate remain present", () => {
  for (const marker of ["data-missions-view", "data-vault-view", "data-analytics-view", "data-protected-loading"]) assert.match(html, new RegExp(marker));
});
test("Sprint 14 streak authority remains on completed history only", () => assert.match(migration15, /if new\.final_state <> 'completed' then[\s\S]*perform public\.apply_vault_streak_day/i));
test("migrations 001 through 016 remain byte-for-byte unchanged", () => {
  const baseline = read("../migrations-pre-sprint16.sha256").trim().split("\n");
  assert.equal(baseline.length, 15);
  baseline.forEach((line) => {
    const [digest, relativePath] = line.trim().split(/\s+/);
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "..", relativePath))).digest("hex");
    assert.equal(actual, digest, relativePath);
  });
});
test("Sprint 17 created no Skill Center migration", () => assert.equal(fs.existsSync(path.join(root, "supabase/migrations/202608070017_sprint17_skill_center.sql")), false));
test("JavaScript syntax and local script references remain valid", () => {
  assert.equal(spawnSync(process.execPath, ["--check", path.join(root, "js/dashboard.js")]).status, 0);
  for (const match of html.matchAll(/(?:src|href)="((?:js|css)\/[^"]+)"/g)) assert.equal(fs.existsSync(path.join(root, match[1])), true, match[1]);
});
test("Sprint 17 contains no frontend credential or secret", () => assert.doesNotMatch([html, source, service, repository].join("\n"), /service_role|postgres(?:ql)?:\/\/|SUPABASE_SERVICE|database[_-]?password/i));

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failures += 1; console.error(`✗ ${name}`); console.error(error); }
  }
  if (failures) process.exitCode = 1;
})();
