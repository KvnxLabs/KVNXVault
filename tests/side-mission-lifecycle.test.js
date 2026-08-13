"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const repositoryFactory = require("../js/user-repository.js");
const dashboardExperiences = require("../js/dashboard.js");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const migration = read("supabase/migrations/202608070022_sprint22_side_mission_lifecycle.sql");
const migration8 = read("supabase/migrations/202608070008_sprint10_skill_progression.sql");
const migration12 = read("supabase/migrations/202608070012_sprint11_1_developer_test_panel.sql");
const migration18 = read("supabase/migrations/202608070018_sprint19_daily_mission_choice.sql");
const migration20 = read("supabase/migrations/202608070020_sprint21_skill_path_mission_offers.sql");
const migration21 = read("supabase/migrations/202608070021_sprint21_1_effective_clock_compatibility.sql");
const repositorySource = read("js/user-repository.js");
const serviceSource = read("js/application-service.js");
const dashboardSource = read("js/dashboard.js");
const html = read("dashboard.html");
const css = read("css/dashboard.css");
const promotion = migration.match(/create or replace function public\.promote_skill_path_offer_to_side_mission[\s\S]*?grant execute on function public\.promote_skill_path_offer_to_side_mission[\s\S]*?to authenticated;/)?.[0] || "";
const start = migration.match(/create or replace function public\.start_side_mission[\s\S]*?grant execute on function public\.start_side_mission\(\) to authenticated;/)?.[0] || "";
const complete = migration.match(/create or replace function public\.complete_side_mission[\s\S]*?grant execute on function public\.complete_side_mission\(\) to authenticated;/)?.[0] || "";

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("planned Sprint 21 practice can be promoted through opaque offer membership", () => {
  assert.match(promotion, /p_offer_id uuid/);
  assert.match(promotion, /state\.selected_offer_id = p_offer_id/);
  assert.match(promotion, /jsonb_array_elements\(state\.offers\)[\s\S]*offerId' = p_offer_id::text/);
});
test("promotion derives owner and logical day without browser identity or time", () => {
  assert.match(promotion, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(promotion, /current_vault_daily_key\(v_user_id, v_now\)/);
  assert.doesNotMatch(promotion.match(/\(([^)]*)\)\nreturns jsonb/)?.[1] || "", /user|day|date|time|zone|skill|reward|title/i);
});
test("promotion requires an active canonical path and active catalog template", () => {
  assert.match(promotion, /path\.path_active = true/);
  assert.match(promotion, /skill\.active = true/);
  assert.match(promotion, /catalog\.active = true/);
});
test("one server UUID and immutable canonical definition are created", () => {
  assert.match(migration, /mission_id uuid not null default extensions\.gen_random_uuid\(\)/);
  assert.match(promotion, /jsonb_build_object\([\s\S]*'overallXPReward', 10,[\s\S]*'skillXPReward', 10/);
  assert.doesNotMatch(repositorySource.match(/const promoteSideMission[\s\S]*?\n    };/)?.[0] || "", /missionId|title|description|skillKey|reward|dailyKey/);
});
test("account-wide slot is uniquely keyed by owner and logical day", () => {
  assert.match(migration, /primary key \(user_id, daily_key\)/);
  assert.match(promotion, /:side-mission-slot/);
});
test("duplicate promotion is idempotent and conflicting promotion is rejected", () => {
  assert.match(promotion, /already-promoted/);
  assert.match(promotion, /daily-slot-unavailable/);
});
test("start is zero-argument and changes lifecycle only", () => {
  assert.match(start, /start_side_mission\(\)/);
  assert.match(start, /set lifecycle_state = 'active', started_at = v_now/);
  assert.doesNotMatch(start, /progression_state|skill_progression|mission_history|user_streak_state|user_achievements/);
});
test("start is safely idempotent", () => assert.match(start, /'already-active'/));
test("completion requires current ACTIVE state", () => {
  assert.match(complete, /v_state\.lifecycle_state <> 'active'/);
  assert.match(complete, /'side-mission-not-active'/);
});
test("completion awards exactly +10 overall XP", () => {
  assert.match(complete, /v_total_xp := v_total_xp \+ 10/);
  assert.match(complete, /update public\.progression_state/);
});
test("completion awards exactly +10 canonical skill XP", () => {
  assert.match(complete, /v_skill_total := v_skill_total \+ 10/);
  assert.match(complete, /update public\.skill_progression/);
});
test("completion validates immutable +10 and +10 server reward fields", () => {
  assert.match(complete, /overallXPReward'\)::integer <> 10/);
  assert.match(complete, /skillXPReward'\)::integer <> 10/);
  assert.match(complete, /primarySkill' <> v_state\.skill_key/);
});
test("completion, reward flag, timestamp, and one history row share one transaction", () => {
  assert.match(complete, /set lifecycle_state = 'completed', reward_awarded = true, completed_at = v_now/);
  assert.match(complete, /insert into public\.mission_history/);
  assert.match(complete, /v_history_record := jsonb_build_object/);
});
test("duplicate and concurrent completion cannot double award", () => {
  assert.match(complete, /for update/);
  assert.match(complete, /pg_advisory_xact_lock/);
  assert.match(complete, /'already-completed'/);
});
test("different paths race on one account-wide lock and slot", () => {
  assert.match(promotion, /v_user_id::text \|\| ':' \|\| v_daily_key::text \|\| ':side-mission-slot'/);
  assert.match(complete, /v_user_id::text \|\| ':' \|\| v_daily_key::text \|\| ':side-mission-slot'/);
});
test("logout, refresh, tabs, devices, and retries restore the persisted slot", () => {
  assert.match(migration, /create or replace function public\.get_side_mission\(\)/);
  assert.match(serviceSource, /repository\.getSideMission\(\)/);
  assert.match(repositorySource, /database\.rpc\("get_side_mission"\)/);
});
test("previous-day incomplete Side Missions expire without reward", () => {
  assert.match(migration, /daily_key < p_daily_key[\s\S]*lifecycle_state in \('ready', 'active'\)/);
  assert.match(migration, /set lifecycle_state = 'expired'/);
});
test("new authoritative logical day restores one new capacity", () => {
  assert.match(migration, /'slotAvailable', true[\s\S]*'rewardedRemaining', 1/);
  assert.match(migration, /current_vault_daily_key\(v_user_id, v_now\)/);
});
test("pausing after promotion does not delete or block the committed Side Mission", () => {
  assert.doesNotMatch(start, /user_skill_paths|path_active/);
  assert.doesNotMatch(complete, /user_skill_paths|path_active/);
  assert.doesNotMatch(migration, /delete from public\.side_mission_state/);
});
test("paused path prevents new promotion", () => assert.match(promotion, /path\.path_active = true/));
test("Side completion does not advance Daily Mission streak", () => {
  assert.match(migration, /new\.mission_type <> 'daily'/);
  assert.doesNotMatch(complete, /apply_vault_streak_day|user_streak_state/);
});
test("Side lifecycle cannot satisfy Daily Complete or consume replacement", () => {
  assert.doesNotMatch([promotion, start, complete].join("\n"), /daily_mission_state|replacements_used|nextResetAt/);
});
test("Side lifecycle cannot change Sprint 19 Daily Mission Choice", () => {
  assert.doesNotMatch([promotion, start, complete].join("\n"), /daily_mission_choice_state|select_daily_mission_choice/);
  assert.equal(crypto.createHash("sha256").update(migration18).digest("hex"), "005b4332b91374ca48ee6a1b2eb0045c20494b8d45acb75ac9d293d65130e0fe");
});
test("primary Daily Mission +25 and +15 economy is unchanged", () => {
  assert.match(migration8, /if v_reward <> 25 then/);
  assert.match(migration8, /v_skill_reward := 15/);
});
test("Daily mission-count achievements exclude Side Mission history", () => {
  assert.match(migration, /FIRST_MISSION[\s\S]*mission_type = 'daily'/);
  assert.match(complete, /evaluate_vault_achievements\([\s\S]*v_total_xp, false, v_now/);
});
test("progression achievements can unlock only through authoritative totals", () => {
  assert.match(migration, /'100_XP' where p_total_xp >= 100/);
  assert.match(migration, /'FIRST_SKILL' where exists/);
  assert.doesNotMatch(dashboardSource, /unlockAchievement|setAchievementProgress/);
});
test("Vault History distinguishes Side and Daily without rewriting legacy rows", () => {
  assert.match(migration, /add column mission_type text not null default 'daily'/);
  assert.match(migration, /'missionType', 'side'/);
  assert.match(dashboardSource, /entry\.missionType === "side" \? "Side Mission" : "Daily Mission"/);
});
test("Analytics counts Side Missions explicitly and preserves total verified progression", () => {
  assert.match(migration, /'sideMissionsCompleted'/);
  assert.match(migration, /history\.mission_type = 'side'/);
  assert.match(html, /data-analytics-side-missions/);
});
test("Skill Center and Mission Center expose the same authoritative Side Mission", () => {
  assert.match(html, /data-skill-side-mission/);
  assert.match(html, /data-mission-center-side/);
  assert.match(dashboardSource, /KVNXSideMissionExperience\.createViewModel\(snapshot\)/);
});
test("zero-XP path remains compact until positive authoritative progression arrives", () => {
  assert.match(dashboardSource, /expandable: totalXP > 0/);
  assert.match(serviceSource, /reconcileUpdatedSkill\(result\?\.updatedSkill\)/);
});
test("Side actions route UI through Application Service and Repository", () => {
  assert.match(dashboardSource, /vaultApplication\.promoteSideMission/);
  assert.match(dashboardSource, /vaultApplication\.startSideMission/);
  assert.match(dashboardSource, /vaultApplication\.completeSideMission/);
  assert.doesNotMatch(dashboardSource, /database\.rpc|supabase\.from/);
});
test("repository mutation inputs are minimal and zero-argument where possible", () => {
  assert.match(repositorySource, /promote_skill_path_offer_to_side_mission[\s\S]*p_offer_id: normalizedOfferId/);
  assert.match(repositorySource, /database\.rpc\("start_side_mission"\)/);
  assert.match(repositorySource, /database\.rpc\("complete_side_mission"\)/);
});
test("repository validates and deeply freezes a full Side Mission response", async () => {
  const response = {
    accepted: true, reason: "restored", dailyKey: "2026-08-13",
    capacity: { limit: 1, slotAvailable: false, rewardedUsed: 0, rewardedRemaining: 1 },
    sideMission: {
      id: "123e4567-e89b-42d3-a456-426614174000",
      sourceOfferId: "123e4567-e89b-42d3-a456-426614174001",
      definition: { title: "Restore Mobility", description: "Complete a deliberate mobility session.", estimatedDuration: "20 minutes", primarySkill: "fitness", skillName: "Fitness", overallXPReward: 10, skillXPReward: 10 },
      lifecycle: { state: "ready", startedAt: null, completedAt: null, rewardAwarded: false },
    },
    overallProgression: null, updatedSkill: null, newAchievements: [], historyRecord: null,
  };
  const client = { rpc: async () => ({ data: response, error: null }) };
  const repository = repositoryFactory.createUserRepository({ authService: { getClient: () => client, getCurrentUser: async () => ({ id: "owner" }) } });
  const result = await repository.getSideMission();
  assert.equal(result.sideMission.definition.overallXPReward, 10);
  assert.equal(Object.isFrozen(result.sideMission.definition), true);
  assert.equal(Object.isFrozen(result.capacity), true);
});
test("repository rejects reward-tampered Side Mission responses", async () => {
  const response = { accepted: true, reason: "restored", dailyKey: "2026-08-13", capacity: { limit: 1, slotAvailable: false, rewardedUsed: 0, rewardedRemaining: 1 }, sideMission: { id: "123e4567-e89b-42d3-a456-426614174000", sourceOfferId: "123e4567-e89b-42d3-a456-426614174001", definition: { title: "X", description: "Y", estimatedDuration: "10 minutes", primarySkill: "fitness", skillName: "Fitness", overallXPReward: 999, skillXPReward: 10 }, lifecycle: { state: "ready", startedAt: null, completedAt: null, rewardAwarded: false } }, overallProgression: null, updatedSkill: null, newAchievements: [], historyRecord: null };
  const client = { rpc: async () => ({ data: response, error: null }) };
  const repository = repositoryFactory.createUserRepository({ authService: { getClient: () => client, getCurrentUser: async () => ({ id: "owner" }) } });
  await assert.rejects(repository.getSideMission(), (error) => error.code === "side-mission-response-invalid");
});
test("repository rejects unexpected internal template identity", async () => {
  const response = { accepted: true, reason: "restored", dailyKey: "2026-08-13", capacity: { limit: 1, slotAvailable: false, rewardedUsed: 0, rewardedRemaining: 1 }, sideMission: { id: "123e4567-e89b-42d3-a456-426614174000", sourceOfferId: "123e4567-e89b-42d3-a456-426614174001", templateKey: "internal", definition: { title: "X", description: "Y", estimatedDuration: "10 minutes", primarySkill: "fitness", skillName: "Fitness", overallXPReward: 10, skillXPReward: 10 }, lifecycle: { state: "ready", startedAt: null, completedAt: null, rewardAwarded: false } }, overallProgression: null, updatedSkill: null, newAchievements: [], historyRecord: null };
  const client = { rpc: async () => ({ data: response, error: null }) };
  const repository = repositoryFactory.createUserRepository({ authService: { getClient: () => client, getCurrentUser: async () => ({ id: "owner" }) } });
  await assert.rejects(repository.getSideMission(), (error) => error.code === "side-mission-response-invalid");
});
test("immutable Application Service snapshots contain Side Mission and capacity", () => {
  assert.match(serviceSource, /sideMission,/);
  assert.match(serviceSource, /sideMissionCapacity,/);
  assert.match(serviceSource, /Object\.freeze\(\{[\s\S]*slotAvailable: true/);
});
test("Side Mission view model uses only restored state and exact reward contract", () => {
  const model = dashboardExperiences.sideMission.createViewModel({ sideMission: { id: "m", sourceOfferId: "o", definition: { title: "Restore Mobility", description: "Practice", estimatedDuration: "20 minutes", primarySkill: "fitness", skillName: "Fitness", overallXPReward: 10, skillXPReward: 10 }, lifecycle: { state: "active", rewardAwarded: false } } });
  assert.equal(model.stateLabel, "In Progress");
  assert.equal(model.canComplete, true);
  assert.equal(model.overallXPReward, 10);
  assert.equal(Object.isFrozen(model), true);
});
test("restoration gate waits for Side Mission restoration", () => {
  assert.match(html, /data-protected-loading[\s\S]*Restoring your Vault[\s\S]*data-protected-content hidden/);
  assert.match(serviceSource, /repository\.getSideMission\(\)[\s\S]*restoreSideMission\(loadedSideMission\)/);
});
test("responsive and accessible controls remain explicit", () => {
  assert.match(html, /Start Side Mission/);
  assert.match(html, /Complete Side Mission/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*side-mission-panel__details/);
  assert.match(css, /min-height: 44px/);
});
test("RLS and direct table writes are denied", () => {
  assert.match(migration, /alter table public\.side_mission_state enable row level security/);
  assert.match(migration, /revoke all on public\.side_mission_state from public, anon, authenticated/);
});
test("all public mutation RPCs are SECURITY DEFINER with empty search path", () => {
  for (const body of [promotion, start, complete]) {
    assert.match(body, /security definer/);
    assert.match(body, /set search_path = ''/);
  }
});
test("anon and public execute remain denied while authenticated gets narrow RPCs", () => {
  assert.match(migration, /revoke all on function public\.complete_side_mission\(\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.complete_side_mission\(\) to authenticated/);
});
test("production effective-clock compatibility and staging simulation remain intact", () => {
  assert.match(migration, /public\.dev_effective_vault_now\(\)/);
  assert.equal(crypto.createHash("sha256").update(migration21).digest("hex"), "15f51e1181e7f4489419d5823cc5e0c28325fb01748a4aa314bd6bac5e023062");
  assert.match(migration12, /dev_effective_vault_now/);
  assert.doesNotMatch(migration, /dev_environment_config|dev_test_accounts|dev_test_state/);
});
test("Sprint 21 offer persistence remains unchanged", () => assert.equal(crypto.createHash("sha256").update(migration20).digest("hex"), "9418ce464d8a5e6538e22c3a35177175eda2a4259ae38b144ae691a5cff32935"));
test("migrations 001 through 021 remain byte-for-byte unchanged", () => {
  const baseline = read("../migrations-pre-sprint22.sha256").trim().split("\n");
  assert.equal(baseline.length, 20);
  baseline.forEach((line) => {
    const [digest, relativePath] = line.trim().split(/\s+/);
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "..", relativePath))).digest("hex");
    assert.equal(actual, digest, relativePath);
  });
});
test("Migration 022 is the only Sprint 22 migration", () => {
  const files = fs.readdirSync(path.join(root, "supabase/migrations")).filter((name) => name.includes("sprint22"));
  assert.deepEqual(files, ["202608070022_sprint22_side_mission_lifecycle.sql"]);
});
test("JavaScript syntax, references, secrets, and service-role scans pass", () => {
  for (const file of ["js/user-repository.js", "js/application-service.js", "js/dashboard.js"]) assert.equal(spawnSync(process.execPath, ["--check", path.join(root, file)]).status, 0, file);
  for (const match of html.matchAll(/(?:src|href)="((?:js|css)\/[^"#]+)"/g)) assert.equal(fs.existsSync(path.join(root, match[1])), true, match[1]);
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
