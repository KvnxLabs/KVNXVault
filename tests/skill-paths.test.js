"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const dashboard = require("../js/dashboard.js");
const repositoryFactory = require("../js/user-repository.js");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const migration = read("supabase/migrations/202608070019_sprint20_skill_paths.sql");
const migration18 = read("supabase/migrations/202608070018_sprint19_daily_mission_choice.sql");
const repositorySource = read("js/user-repository.js");
const serviceSource = read("js/application-service.js");
const dashboardSource = read("js/dashboard.js");
const html = read("dashboard.html");
const css = read("css/dashboard.css");

const progressionEngine = {
  createProgression: (totalXP) => ({ totalXP }),
  getSnapshot: ({ totalXP }) => Object.freeze({
    currentLevel: totalXP >= 100 ? 2 : 1,
    nextLevel: totalXP >= 100 ? 3 : 2,
    currentLevelXP: totalXP >= 100 ? totalXP - 100 : totalXP,
    xpForNextLevel: totalXP >= 100 ? 250 : 100,
    xpRemaining: totalXP >= 100 ? 250 - totalXP : 100 - totalXP,
    progressPercentage: totalXP >= 100
      ? Math.round(((totalXP - 100) / 150) * 100)
      : totalXP,
    isMaxLevel: false,
  }),
};

const baseSnapshot = Object.freeze({
  skillCatalog: Object.freeze([
    Object.freeze({ key: "front_end_engineering", name: "Front-End Engineering", sortOrder: 10 }),
    Object.freeze({ key: "fitness", name: "Fitness", sortOrder: 100 }),
  ]),
  skills: Object.freeze([
    Object.freeze({ key: "front_end_engineering", name: "Front-End Engineering", totalXP: 145, todayGain: 15 }),
  ]),
  skillPaths: Object.freeze([
    Object.freeze({ key: "fitness", name: "Fitness", pathActive: true, catalogActive: true }),
  ]),
  history: Object.freeze([
    Object.freeze({ historyId: "h1", status: "completed", title: "Complete a Coding Session", primarySkillKey: "front_end_engineering", skillXPEarned: 15, completedAt: "2026-08-13T12:00:00.000Z" }),
  ]),
});

const view = (options) => dashboard.skillCenter.createViewModel(baseSnapshot, progressionEngine, options);
const tests = [];
const test = (name, run) => tests.push({ name, run });

test("canonical active skill activation is owner-derived and idempotent", () => {
  assert.match(migration, /create or replace function public\.activate_skill_path\(p_skill_key text\)/i);
  assert.match(migration, /v_user_id uuid := auth\.uid\(\)/i);
  assert.match(migration, /if not v_path\.path_active then[\s\S]*update public\.user_skill_paths/i);
});
test("Fitness is a normal canonical path regardless of onboarding focus", () => {
  assert.match(read("supabase/migrations/202608070008_sprint10_skill_progression.sql"), /\('fitness', 'Fitness', 100\)/);
  const activateBody = migration.match(/create or replace function public\.activate_skill_path[\s\S]*?comment on function public\.activate_skill_path/)?.[0] || "";
  assert.doesNotMatch(activateBody, /onboarding|primary_focus|Doug|founder/i);
});
test("arbitrary and inactive catalog skills are rejected by activation", () => {
  assert.match(migration, /catalog\.skill_key = v_skill_key[\s\S]*catalog\.active = true[\s\S]*raise exception 'Canonical active skill required'/i);
});
test("unauthenticated activation and deactivation are rejected", () => {
  assert.equal((migration.match(/raise exception 'Authentication required'/g) || []).length, 3);
});
test("one owner and skill has deterministic uniqueness", () => {
  assert.match(migration, /primary key \(user_id, skill_key\)/i);
  assert.match(migration, /pg_advisory_xact_lock[\s\S]*skill-path:/i);
});
test("deactivation is soft and idempotent", () => {
  assert.match(migration, /create or replace function public\.deactivate_skill_path/i);
  assert.match(migration, /elsif v_path\.path_active then[\s\S]*set path_active = false/i);
  assert.doesNotMatch(migration, /delete from public\.user_skill_paths/i);
});
test("deactivation preserves lifetime progression and history", () => {
  const deactivateBody = migration.match(/create or replace function public\.deactivate_skill_path[\s\S]*?comment on function public\.deactivate_skill_path/)?.[0] || "";
  assert.doesNotMatch(deactivateBody, /update public\.skill_progression|delete from public\.skill_progression|mission_history/i);
});
test("path mutations award no XP, mission, streak, achievement, or history effects", () => {
  const mutationBodies = migration.match(/create or replace function public\.activate_skill_path[\s\S]*?comment on function public\.deactivate_skill_path[\s\S]*?;/)?.[0] || "";
  assert.doesNotMatch(mutationBodies, /progression_state|skill_progression|daily_mission_state|mission_history|user_streak_state|user_achievements/i);
});
test("Sprint 19 choice persistence and generation remain untouched", () => {
  assert.match(migration18, /daily_mission_choice_state/);
  assert.doesNotMatch(migration, /daily_mission_choice_state|request_daily_mission|select_daily_mission_choice/i);
});
test("zero-XP active path remains compact and non-expandable", () => {
  const fitness = view().skills.find((skill) => skill.key === "fitness");
  assert.equal(fitness.developmentPathActive, true);
  assert.equal(fitness.totalXP, 0);
  assert.equal(fitness.expandable, false);
  assert.equal(fitness.stateLabel, "Not Started");
  assert.equal(fitness.pathStateLabel, "Developing");
});
test("zero-XP path creates no fake progression or history disclosure", () => {
  assert.match(dashboardSource, /document\.createElement\(skill\.expandable \? "details" : "article"\)/);
  assert.match(dashboardSource, /if \(!skill\.expandable\) \{[\s\S]*return;[\s\S]*const overview/);
});
test("positive-XP skill retains existing expandable progression", () => {
  const skill = view().skills.find((entry) => entry.key === "front_end_engineering");
  assert.equal(skill.expandable, true);
  assert.equal(skill.totalXP, 145);
  assert.equal(skill.recentGains.length, 1);
});
test("progression and path filters remain semantically distinct", () => {
  assert.deepEqual(view({ filter: "active" }).skills.map((skill) => skill.key), ["front_end_engineering"]);
  assert.deepEqual(view({ filter: "developing" }).skills.map((skill) => skill.key), ["fitness"]);
  assert.deepEqual(view({ filter: "not-started" }).skills.map((skill) => skill.key), ["fitness"]);
  assert.match(html, />With Progress<[^]*>Developing<[^]*>Not Started</);
});
test("repository restoration is zero-argument and mutations submit only canonical key", () => {
  assert.match(repositorySource, /database\.rpc\("get_skill_paths"\)/);
  assert.match(repositorySource, /database\.rpc\(rpcName, \{ p_skill_key: normalizedSkillKey \}\)/);
  assert.doesNotMatch(repositorySource, /activate_skill_path[\s\S]{0,300}p_user_id/);
});
test("repository rejects malformed path responses", async () => {
  const client = {
    rpc: async (name) => ({ data: name === "get_skill_paths" ? [{ key: "fitness", name: "Fitness", pathActive: "yes" }] : null, error: null }),
  };
  const repository = repositoryFactory.createUserRepository({
    authService: { getClient: () => client, getCurrentUser: async () => ({ id: "owner" }) },
  });
  await assert.rejects(repository.getSkillPaths(), (error) => error.code === "skill-path-response-invalid");
});
test("valid repository path responses are normalized and frozen", async () => {
  const now = "2026-08-13T15:00:00.000Z";
  const client = { rpc: async () => ({ data: [{ key: "fitness", name: "Fitness", pathActive: true, catalogActive: true, activatedAt: now, deactivatedAt: null, updatedAt: now }], error: null }) };
  const repository = repositoryFactory.createUserRepository({ authService: { getClient: () => client, getCurrentUser: async () => ({ id: "owner" }) } });
  const paths = await repository.getSkillPaths();
  assert.equal(paths[0].key, "fitness");
  assert.equal(Object.isFrozen(paths), true);
  assert.equal(Object.isFrozen(paths[0]), true);
});
test("Application Service restores and freezes Skill Path snapshots", () => {
  assert.match(serviceSource, /skillPaths: Object\.freeze\(\[\.\.\.skillPaths\]\)/);
  assert.match(serviceSource, /repository\.getSkillPaths\(\)/);
  assert.match(serviceSource, /restoreSkillPaths\(Array\.isArray\(loadedSkillPaths\)/);
});
test("server result reconciles before Skill Center redraw", () => {
  assert.match(serviceSource, /const path = await method\.call\(repository, skillKey\);[\s\S]*reconcileSkillPath\(path\)/);
  assert.match(dashboardSource, /applicationSnapshot = result\.snapshot;[\s\S]*renderSkillCenter\(applicationSnapshot\)/);
});
test("Skill Path UI uses Application Service and no direct Supabase", () => {
  assert.match(dashboardSource, /vaultApplication\.activateSkillPath\(skillKey\)/);
  assert.match(dashboardSource, /vaultApplication\.deactivateSkillPath\(skillKey\)/);
  assert.doesNotMatch(dashboardSource, /supabase\.from|database\.rpc/);
});
test("restoration gate and #skills route remain protected", () => {
  assert.match(html, /data-protected-loading[\s\S]*Restoring your Vault[\s\S]*data-protected-content hidden/);
  assert.match(dashboardSource, /window\.location\.hash === "#skills"/);
  assert.match(dashboardSource, /protectedContentGate\.reveal\(\)/);
});
test("path actions are accessible and pending-safe", () => {
  assert.match(dashboardSource, /setAttribute\("aria-label", `\$\{pathButton\.textContent\} for \$\{skill\.name\}`\)/);
  assert.match(dashboardSource, /button\.disabled = true;[\s\S]*setAttribute\("aria-busy", "true"\)/);
  assert.match(css, /\.skill-center__path-action:focus-visible/);
});
test("direct table writes are unavailable and RLS is enabled", () => {
  assert.match(migration, /alter table public\.user_skill_paths enable row level security/i);
  assert.match(migration, /revoke all on public\.user_skill_paths from public, anon, authenticated/i);
  assert.match(migration, /revoke insert, update, delete, truncate, references, trigger[\s\S]*from authenticated/i);
  assert.doesNotMatch(migration, /create policy/i);
});
test("SECURITY DEFINER functions have empty search paths and minimal grants", () => {
  assert.equal((migration.match(/security definer\nset search_path = ''/gi) || []).length, 4);
  assert.equal((migration.match(/grant execute on function public\.(?:get_skill_paths|activate_skill_path|deactivate_skill_path)/g) || []).length, 3);
  assert.doesNotMatch(migration, /grant execute[^;]+to anon|grant execute[^;]+to public/i);
});
test("existing hidden-achievement confidentiality remains unchanged", () => {
  assert.match(serviceSource, /name: "\?\?\?\?\?"[\s\S]*description: "\?\?\?\?\?"/);
  assert.doesNotMatch(migration, /achievement_catalog|user_achievements/i);
});
test("migrations 001 through 018 remain byte-for-byte unchanged", () => {
  const baseline = read("../migrations-pre-sprint20.sha256").trim().split("\n");
  assert.equal(baseline.length, 17);
  baseline.forEach((line) => {
    const [digest, relativePath] = line.trim().split(/\s+/);
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "..", relativePath))).digest("hex");
    assert.equal(actual, digest, relativePath);
  });
});
test("Migration 019 is the only Sprint 20 migration", () => {
  const sprint20 = fs.readdirSync(path.join(root, "supabase/migrations")).filter((name) => name.includes("sprint20"));
  assert.deepEqual(sprint20, ["202608070019_sprint20_skill_paths.sql"]);
});
test("JavaScript, HTML references, and secret scan pass", () => {
  for (const file of ["js/user-repository.js", "js/application-service.js", "js/dashboard.js"]) {
    assert.equal(spawnSync(process.execPath, ["--check", path.join(root, file)]).status, 0, file);
  }
  for (const match of html.matchAll(/(?:src|href)="((?:js|css)\/[^"#]+)"/g)) {
    assert.equal(fs.existsSync(path.join(root, match[1])), true, match[1]);
  }
  assert.doesNotMatch([migration, repositorySource, serviceSource, dashboardSource, html].join("\n"), /service_role|SUPABASE_SERVICE|postgres(?:ql)?:\/\//i);
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failures += 1; console.error(`✗ ${name}`); console.error(error); }
  }
  if (failures) process.exitCode = 1;
})();
