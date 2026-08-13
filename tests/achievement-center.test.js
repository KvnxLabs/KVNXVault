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
const css = read("css/dashboard.css");
const service = read("js/application-service.js");
const repository = read("js/user-repository.js");
const migration8 = read("supabase/migrations/202608070008_sprint10_skill_progression.sql");
const migration11 = read("supabase/migrations/202608070011_sprint11_achievements.sql");
const migration17 = read("supabase/migrations/202608070017_sprint18_achievement_center.sql");

const achievement = (key, name, description, overrides = {}) => Object.freeze({
  key, name, description, icon: "◆", category: "Progression", hidden: false,
  displayOrder: 10, unlocked: false, unlockedAt: null, ...overrides,
});

const achievements = Object.freeze([
  achievement("FIRST_MISSION", "First Mission", "Complete your first mission.", { category: "Missions", unlocked: true, unlockedAt: "2026-08-10T12:00:00.000Z", displayOrder: 10 }),
  achievement("FIRST_REPLACEMENT", "Second Wind", "Complete your first replacement mission.", { category: "Missions", displayOrder: 20 }),
  achievement("LEVEL_2", "Level Two", "Reach overall Level 2.", { displayOrder: 30 }),
  achievement("LEVEL_5", "Level Five", "Reach overall Level 5.", { hidden: true, displayOrder: 40 }),
  achievement("FIRST_SKILL", "First Mastery", "Earn XP in your first skill.", { category: "Skills", unlocked: true, unlockedAt: "2026-08-11T12:00:00.000Z", displayOrder: 50 }),
  achievement("100_XP", "100 XP", "Build 100 total account XP.", { unlocked: true, unlockedAt: "2026-08-12T12:00:00.000Z", displayOrder: 60 }),
  achievement("250_XP", "250 XP", "Build 250 total account XP.", { displayOrder: 70 }),
  achievement("500_XP", "500 XP", "Build 500 total account XP.", { displayOrder: 80 }),
  achievement("1000_XP", "1,000 XP", "Build 1,000 total account XP.", { hidden: true, displayOrder: 90 }),
  achievement("THREE_DAY_STREAK", "Three-Day Streak", "Complete missions on three consecutive authoritative days.", { category: "Consistency", hidden: true, unlocked: true, unlockedAt: "2026-08-13T12:00:00.000Z", displayOrder: 100 }),
  achievement("SEVEN_DAY_STREAK", "Seven-Day Streak", "Complete missions on seven consecutive authoritative days.", { category: "Consistency", hidden: true, displayOrder: 110 }),
]);

const snapshot = Object.freeze({
  achievements,
  progression: Object.freeze({ currentXP: 175 }),
  skills: Object.freeze([Object.freeze({ key: "front_end_engineering", totalXP: 30 })]),
  streak: Object.freeze({ currentStreak: 1, longestStreak: 3 }),
  history: Object.freeze([]),
});

const view = (overrides = {}, options = {}) => dashboard.achievements.createCenterViewModel(
  Object.freeze({ ...snapshot, ...overrides }), options,
);
const tests = [];
const test = (name, run) => tests.push({ name, run });

test("#achievements route remains in the existing shell", () => {
  assert.match(html, /href="#achievements"\s+data-view-link="achievements"/);
  assert.match(source, /window\.location\.hash === "#achievements"/);
});
test("#achievements survives auth restoration", () => {
  assert.match(source, /renderAchievements\(applicationSnapshot\);[\s\S]*renderApplicationView\(\);[\s\S]*protectedContentGate\.reveal\(\)/);
  assert.doesNotMatch(source, /location\.hash\s*=\s*"#dashboard"/);
});
test("placeholder achievements remain behind the protected gate", () => assert.match(html, /data-protected-content hidden[\s\S]*data-achievements-view hidden/));
test("summary counts authoritative unlocked rows", () => assert.equal(view().unlockedCount, 4));
test("summary counts the restored catalog", () => assert.equal(view().totalCount, 11));
test("completion percentage uses unlocked over total", () => assert.equal(view().completionPercentage, 36));
test("most recent unlock uses authoritative timestamps", () => assert.equal(view().mostRecent.name, "Three-Day Streak"));
test("most recent unlock exposes the authoritative date", () => assert.equal(view().mostRecent.dateLabel, "Aug 13, 2026"));
test("unlocked cards retain real catalog presentation", () => {
  const first = view().unlocked.find((item) => item.key === "FIRST_MISSION");
  assert.equal(first.name, "First Mission");
  assert.equal(first.description, "Complete your first mission.");
  assert.equal(first.statusLabel, "Unlocked");
});
test("unlocked timestamps are normalized", () => assert.equal(view().unlocked[0].unlockedAt, "2026-08-13T12:00:00.000Z"));
test("visible locked achievements retain their approved catalog copy", () => {
  const locked = view().locked.find((item) => item.key === "250_XP");
  assert.equal(locked.name, "250 XP");
  assert.equal(locked.statusLabel, "Locked");
});
test("hidden locked achievements are concealed", () => {
  const hidden = view().locked.filter((item) => item.confidential);
  assert.equal(hidden.length, 3);
  hidden.forEach((item) => assert.deepEqual(
    { key: item.key, icon: item.icon, name: item.name, description: item.description, requirement: item.requirement, progress: item.progress },
    { key: null, icon: "?", name: "?????", description: "?????", requirement: null, progress: null },
  ));
});
test("hidden names never survive the presentation view model", () => assert.equal(JSON.stringify(view().locked).includes("Level Five"), false));
test("hidden descriptions never survive the presentation view model", () => assert.equal(JSON.stringify(view().locked).includes("seven consecutive"), false));
test("hidden keys never survive user-visible or accessibility content", () => assert.equal(JSON.stringify(view().locked).includes("SEVEN_DAY_STREAK"), false));
test("visible requirements explain existing authoritative rules", () => assert.equal(view().locked.find((item) => item.key === "250_XP").requirement, "Reach 250 total XP."));
test("XP progress uses authoritative overall XP", () => {
  const progress = view().locked.find((item) => item.key === "250_XP").progress;
  assert.deepEqual(progress, { value: 175, target: 250, percentage: 70, label: "175 / 250 XP" });
});
test("completed XP progress clamps the bar without rewriting total XP", () => {
  const progress = view().unlocked.find((item) => item.key === "100_XP").progress;
  assert.equal(progress.value, 100);
  assert.equal(progress.label, "100 / 100 XP");
});
test("unlocked consistency context uses authoritative streak state", () => assert.equal(view().mostRecent.verifiedContext, "Current streak: 1 day · Longest streak: 3 days"));
test("skill milestone uses authoritative positive skill totals", () => assert.equal(view().unlocked.find((item) => item.key === "FIRST_SKILL").progress.label, "1 / 1 skill developed"));
test("binary skill progress is omitted when no authoritative skill exists", () => {
  const lockedAchievements = achievements.map((item) => item.key === "FIRST_SKILL" ? { ...item, unlocked: false, unlockedAt: null } : item);
  const result = view({ achievements: lockedAchievements, skills: [] });
  assert.equal(result.locked.find((item) => item.key === "FIRST_SKILL").progress, null);
});
test("unsupported mission progress is not fabricated", () => assert.equal(view().unlocked.find((item) => item.key === "FIRST_MISSION").progress, null));
test("recent unlocks are ordered newest first", () => assert.deepEqual(view().unlocked.map((item) => item.dateLabel), ["Aug 13, 2026", "Aug 12, 2026", "Aug 11, 2026", "Aug 10, 2026"]));
test("equal unlock timestamps use catalog display order", () => {
  const tied = achievements.map((item) => item.unlocked ? { ...item, unlockedAt: "2026-08-13T12:00:00.000Z" } : item);
  assert.deepEqual(view({ achievements: tied }).unlocked.map((item) => item.displayOrder), [10, 50, 60, 100]);
});
test("zero unlocks produce an intentional empty state", () => {
  const none = achievements.map((item) => ({ ...item, unlocked: false, unlockedAt: null }));
  assert.equal(view({ achievements: none }).empty, true);
  assert.match(html, /No milestones unlocked yet/);
});
test("restoration error preserves an honest recoverable state", () => assert.match(html, /data-achievement-center-error hidden[\s\S]*persisted milestones remain unchanged/i));
test("All, Unlocked, and Locked filters are presentation-only", () => {
  assert.equal(view({}, { filter: "all" }).achievements.length, 11);
  assert.equal(view({}, { filter: "unlocked" }).achievements.length, 4);
  assert.equal(view({}, { filter: "locked" }).achievements.length, 7);
});
test("filters are keyboard-native and expose pressed state", () => assert.match(html, /data-achievement-filter="all" aria-pressed="true"/));
test("Dashboard achievement notifications remain server-result driven", () => {
  assert.match(source, /const showAchievementUnlocks = \(newAchievements\)/);
  assert.match(source, /showAchievementUnlocks\(applicationResult\.newAchievements\)/);
});
test("multiple server-returned achievements remain supported", () => assert.match(source, /newAchievements\.forEach/));
test("Mission Center completion remains the established shared path", () => assert.match(source, /missionCenterComplete\?\.addEventListener\("click", completeFirstMission\)/));
test("Skill Center 17.1 static zero-XP behavior remains intact", () => assert.match(source, /document\.createElement\(skill\.expandable \? "details" : "article"\)/));
test("Vault remains the permanent archive surface", () => assert.match(html, /data-vault-view[\s\S]*Permanent record/));
test("Analytics remains its existing period surface", () => assert.match(html, /data-analytics-view[\s\S]*data-analytics-period="7d"/));
test("opening Achievement Center changes no overall XP", () => assert.doesNotMatch(source.match(/const renderAchievements[\s\S]*?\n  };/)?.[0] || "", /addXP|xpAwarded|complete\(/));
test("opening Achievement Center changes no skill XP", () => assert.doesNotMatch(source.match(/const renderAchievements[\s\S]*?\n  };/)?.[0] || "", /skillXPAwarded|saveSkill|setSkill/));
test("opening Achievement Center changes no streak", () => assert.doesNotMatch(source.match(/const renderAchievements[\s\S]*?\n  };/)?.[0] || "", /updateStreak|currentStreak\s*=/));
test("opening Achievement Center cannot unlock an achievement", () => assert.doesNotMatch(source.match(/const renderAchievements[\s\S]*?\n  };/)?.[0] || "", /unlockAchievement|evaluateAchievement|user_achievements/));
test("frontend exposes no generic achievement setter", () => assert.doesNotMatch([source, service, repository].join("\n"), /unlockAchievement\s*\(|setAchievementProgress|setAchievementState/i));
test("dashboard rendering performs no direct Supabase operation", () => assert.doesNotMatch(source, /supabase|\.rpc\(|\.from\(/i));
test("hidden achievement identities are absent from rendering source", () => assert.doesNotMatch(source, /LEVEL_5|1000_XP|THREE_DAY_STREAK|SEVEN_DAY_STREAK|Level Five|Three-Day Streak|Seven-Day Streak/));
test("Sprint 16.1 restoration gate remains unchanged", () => assert.match(source, /protectedContentGate\.reveal\(\)/));
test("Sprint 17.1 Not Started cards remain non-expandable", () => assert.match(css, /\.skill-center__static[\s\S]*grid-template-columns/));
test("overall mission reward remains exactly 25 XP", () => assert.match(migration8, /if v_reward <> 25 then/i));
test("mapped skill reward remains exactly 15 XP", () => assert.match(migration8, /v_skill_reward := 15;/i));
test("server remains the only achievement evaluator", () => assert.match(migration11, /create or replace function public\.evaluate_vault_achievements[\s\S]*security definer[\s\S]*set search_path = ''/i));
test("direct achievement writes remain revoked", () => assert.match(migration11, /revoke insert, update, delete on public\.user_achievements from authenticated/i));
test("Migration 017 redacts locked hidden catalog identities at the read boundary", () => {
  assert.match(migration17, /case when catalog\.hidden and earned\.achievement_key is null then null else catalog\.key end/i);
  assert.match(migration17, /then '\?\?\?\?\?' else catalog\.name end/i);
  assert.match(migration17, /left join public\.user_achievements as earned[\s\S]*earned\.user_id = v_user_id/i);
});
test("Migration 017 remains zero-argument, owner-derived, and read-only", () => {
  assert.match(migration17, /create or replace function public\.get_achievement_catalog\(\)/i);
  assert.match(migration17, /v_user_id uuid := auth\.uid\(\)/i);
  assert.match(migration17, /security definer[\s\S]*set search_path = ''/i);
  assert.doesNotMatch(migration17, /insert into|update public\.|delete from/i);
});
test("repository accepts only the approved confidential placeholder shape", () => {
  assert.match(repository, /const confidential = achievement\.hidden && !achievement\.key/);
  assert.match(repository, /achievement\.name !== "\?\?\?\?\?"/);
});
test("immutable application snapshots redact locked hidden definitions defensively", () => {
  assert.match(service, /const toPublicAchievement[\s\S]*achievement\?\.hidden && !achievement\?\.unlocked/);
  assert.match(service, /achievements: Object\.freeze\(achievements\.map\(toPublicAchievement\)\)/);
});
test("migrations 001 through 016 remain immutable", () => {
  const baseline = read("../migrations-pre-sprint16.sha256").trim().split("\n");
  assert.equal(baseline.length, 15);
  baseline.forEach((line) => {
    const [digest, relativePath] = line.trim().split(/\s+/);
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "..", relativePath))).digest("hex");
    assert.equal(actual, digest, relativePath);
  });
});
test("Sprint 18 creates only the exact Migration 017 read-contract correction", () => {
  const sprint18 = fs.readdirSync(path.join(root, "supabase/migrations")).filter((name) => name.includes("0017"));
  assert.deepEqual(sprint18, ["202608070017_sprint18_achievement_center.sql"]);
});
test("the pre-Sprint-18 migration baseline fingerprints 001 through 016", () => {
  const baseline = read("../migrations-pre-sprint18.sha256").trim().split("\n");
  assert.equal(baseline.length, 15);
  baseline.forEach((line) => {
    const [digest, relativePath] = line.trim().split(/\s+/);
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "..", relativePath))).digest("hex");
    assert.equal(actual, digest, relativePath);
  });
});
test("JavaScript syntax remains valid", () => assert.equal(spawnSync(process.execPath, ["--check", path.join(root, "js/dashboard.js")]).status, 0));
test("HTML local script and stylesheet references resolve", () => {
  for (const match of html.matchAll(/(?:src|href)="((?:js|css)\/[^"]+)"/g)) assert.equal(fs.existsSync(path.join(root, match[1])), true, match[1]);
});
test("responsive Achievement Center and reduced motion remain supported", () => {
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.achievement-center__metrics/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
test("Sprint 18 introduces no frontend credential or secret", () => assert.doesNotMatch([html, source, service, repository].join("\n"), /service_role|postgres(?:ql)?:\/\/|SUPABASE_SERVICE|database[_-]?password/i));

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failures += 1; console.error(`✗ ${name}`); console.error(error); }
  }
  if (failures) process.exitCode = 1;
})();
