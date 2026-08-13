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
  assert.equal(hash("js/user-repository.js"), "967b012508d0c12832349d02057bc056b594a99b41af69b8282d8067d51917ef");
  assert.equal(hash("js/application-service.js"), "a231d71b5da5e28ea5c1ff53ced7b79d782c95d647799b103852850e9f6e0932");
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
  assert.equal(hash("css/dashboard.css"), "dd0ed98fd8bffbdbffc1870d43feadd3c50b5f8d1d4c4ec297292040d278ab15");
  assert.equal(hash("js/dashboard.js"), "4db6e97f3f4867912992cab1881a3763212348c6f66e8da0b28c7f85ae6af0b0");
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
