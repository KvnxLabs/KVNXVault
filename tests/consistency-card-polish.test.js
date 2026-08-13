"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const hash = (relativePath) => crypto.createHash("sha256").update(read(relativePath)).digest("hex");
const html = read("dashboard.html");
const dashboardSource = read("js/dashboard.js");
const repositorySource = read("js/user-repository.js");
const serviceSource = read("js/application-service.js");
const consistencyCard = html.match(/<section class="dashboard-card dashboard-card--activity dashboard-card--streak[\s\S]*?<\/section>/)?.[0] || "";

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("Consistency card no longer renders the internal AUTHORITATIVE label", () => {
  assert.ok(consistencyCard);
  assert.doesNotMatch(consistencyCard, /AUTHORITATIVE/i);
  assert.doesNotMatch(consistencyCard, /dashboard-card__meta/);
});

test("Consistency heading remains unchanged", () => {
  assert.match(consistencyCard, /<h2 class="dashboard-card__title" id="consistency-card-title">Consistency<\/h2>/);
  assert.match(consistencyCard, /aria-labelledby="consistency-card-title"/);
});

test("current streak presentation remains unchanged", () => {
  assert.match(consistencyCard, /data-current-streak>No active streak yet<\/strong>/);
  assert.match(dashboardSource, /currentStreak\.textContent = value\.currentStreak > 0[\s\S]*formatStreakDays\(value\.currentStreak\)/);
});

test("longest streak presentation remains unchanged", () => {
  assert.match(consistencyCard, /<dt>Longest streak<\/dt><dd data-longest-streak>0 days<\/dd>/);
  assert.match(dashboardSource, /longestStreak\.textContent = formatStreakDays\(value\.longestStreak\)/);
});

test("last completed day presentation remains unchanged", () => {
  assert.match(consistencyCard, /<dt>Last completed day<\/dt><dd data-streak-last-day>Not started<\/dd>/);
  assert.match(dashboardSource, /const timestamp = value\.lastCompletedDailyKey[\s\S]*streakLastDay\.textContent = Number\.isFinite\(timestamp\)/);
});

test("zero state and singular-plural grammar remain unchanged", () => {
  assert.match(consistencyCard, /No active streak yet/);
  assert.match(consistencyCard, /Complete today's mission to begin building consistency\./);
  assert.match(dashboardSource, /value === 1 \? "day" : "days"/);
});

test("server-authoritative streak restoration remains unchanged", () => {
  assert.equal(hash("js/user-repository.js"), "70a39141a787b739243a713d464313ecb687e15360d4b189c987c3a82f0b7885");
  assert.equal(hash("js/application-service.js"), "11c0109e187e09967ed6c3c5beae4f7e7ff397e50146027f3e2e56be61f954e0");
  assert.match(repositorySource, /database\.rpc\("get_vault_streak"\)/);
  assert.match(serviceSource, /typeof repository\.getVaultStreak === "function"/);
});

test("streak achievements remain unchanged", () => {
  assert.equal(hash("supabase/migrations/202608070015_sprint14_authoritative_streaks.sql"), "c91879fb8c23577e91a27d635e4c5c7845ff9e94d9e9ed2d6f21412799b8d763");
  const migration = read("supabase/migrations/202608070015_sprint14_authoritative_streaks.sql");
  assert.match(migration, /THREE_DAY_STREAK[\s\S]*v_current_streak >= 3/);
  assert.match(migration, /SEVEN_DAY_STREAK[\s\S]*v_current_streak >= 7/);
});

test("mission completion rewards and streak trigger remain unchanged", () => {
  const achievements = read("supabase/migrations/202608070011_sprint11_achievements.sql");
  const streaks = read("supabase/migrations/202608070015_sprint14_authoritative_streaks.sql");
  assert.match(achievements, /if v_reward <> 25 then/);
  assert.match(achievements, /v_skill_reward := 15/);
  assert.match(streaks, /request_vault_mission_action_sprint13\(p_mission_id, p_action\)/);
});

test("Sprint 20 Skill Paths remain unchanged", () => {
  assert.equal(hash("supabase/migrations/202608070019_sprint20_skill_paths.sql"), "717d0a79a7d0cc25aaf79f86484fb50223208d26a60193cc0f845e2473179971");
  assert.match(serviceSource, /activateSkillPath: \(skillKey\) => setSkillPathActive\(skillKey, true\)/);
  assert.match(serviceSource, /deactivateSkillPath: \(skillKey\) => setSkillPathActive\(skillKey, false\)/);
});

test("no CSS or Dashboard rendering logic changed", () => {
  assert.equal(hash("css/dashboard.css"), "b4905d310bf1ccc66bb21c6ba90774473216b2dfdaabb7b00398cae0d8bc47f9");
  assert.equal(hash("js/dashboard.js"), "60b69b0821bf22645748785a62c8ab5861ecd561f95bf6bae3c75aba706b314f");
});

test("Sprint 20.1 remains migration-free after later migrations", () => {
  const migrations = fs.readdirSync(path.join(root, "supabase/migrations"));
  assert.equal(migrations.some((name) => /sprint20_1|sprint20\.1/.test(name)), false);
});

test("migrations 001 through 019 remain byte-for-byte unchanged", () => {
  const baseline = read("../migrations-pre-sprint20.1.sha256").trim().split("\n");
  assert.equal(baseline.length, 18);
  baseline.forEach((line) => {
    const [digest, relativePath] = line.trim().split(/\s+/);
    const actual = crypto.createHash("sha256")
      .update(fs.readFileSync(path.join(root, "..", relativePath))).digest("hex");
    assert.equal(actual, digest, relativePath);
  });
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failures += 1; console.error(`✗ ${name}`); console.error(error); }
  }
  if (failures) process.exitCode = 1;
})();
