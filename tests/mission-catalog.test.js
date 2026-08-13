"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const applicationFactory = require("../js/application-service.js");
const coordinatorEngine = require("../js/mission-coordinator.js");
const lifecycleEngine = require("../js/mission-lifecycle.js");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const hash = (relativePath) => crypto.createHash("sha256")
  .update(fs.readFileSync(path.join(root, relativePath))).digest("hex");

const migration = read("supabase/migrations/202608070016_sprint15_mission_catalog.sql");
const dailyMigration = read("supabase/migrations/202608070009_sprint10_1_uuid_function_hotfix.sql");
const stagingMigration = read("supabase/migrations/202608070012_sprint11_1_developer_test_panel.sql");
const historyMigration = read("supabase/migrations/202608070013_sprint12_vault_history.sql");
const analyticsMigration = read("supabase/migrations/202608070014_sprint13_analytics_insights.sql");
const streakMigration = read("supabase/migrations/202608070015_sprint14_authoritative_streaks.sql");
const repositorySource = read("js/user-repository.js");
const applicationSource = read("js/application-service.js");
const dashboardSource = read("js/dashboard.js");
const dashboardHTML = read("dashboard.html");

const builder = migration.match(
  /create or replace function public\.build_vault_daily_mission[\s\S]*?\$\$;/i,
)?.[0] || "";
const historyTrigger = migration.match(
  /create or replace function public\.capture_vault_history_details[\s\S]*?\$\$;/i,
)?.[0] || "";
const templatePattern = /^  \('([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)', (\d+)\)[,;]$/gm;
const templates = [...migration.matchAll(templatePattern)].map((match) => ({
  templateKey: match[1], focusKey: match[2], title: match[3], description: match[4],
  skillKey: match[5], minutes: Number(match[6]),
}));

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("authoritative mission catalog exists and is server managed", () => {
  assert.match(migration, /create table public\.mission_catalog/i);
  assert.match(migration, /template_key text primary key/i);
  assert.match(migration, /active boolean not null default true/i);
  assert.match(migration, /revoke all on public\.mission_catalog from public, anon, authenticated/i);
});

test("catalog contains sixty-six active-by-default templates", () => {
  assert.equal(templates.length, 66);
  assert.equal(new Set(templates.map((template) => template.templateKey)).size, 66);
});

test("each canonical focus and custom fallback has six templates", () => {
  const counts = templates.reduce((result, template) => {
    result[template.focusKey] = (result[template.focusKey] || 0) + 1;
    return result;
  }, {});
  assert.deepEqual(counts, {
    career: 6, business: 6, programming: 6, fitness: 6, health: 6,
    learning: 6, creativity: 6, finance: 6, relationships: 6,
    mindset: 6, general: 6,
  });
});

test("catalog uses only existing canonical skill keys", () => {
  const canonicalSkills = new Set([
    "front_end_engineering", "back_end_engineering", "product_design", "leadership",
    "communication", "problem_solving", "learning", "reading", "writing", "fitness",
    "business", "discipline",
  ]);
  templates.forEach((template) => assert.equal(canonicalSkills.has(template.skillKey), true));
  assert.match(migration, /references public\.skill_catalog\(skill_key\)/i);
});

test("focus-to-skill mappings preserve the existing product model", () => {
  const expected = {
    career: "leadership", business: "business", programming: "front_end_engineering",
    fitness: "fitness", health: "fitness", learning: "learning",
    creativity: "product_design", finance: "business", relationships: "communication",
    mindset: "discipline", general: "problem_solving",
  };
  for (const [focus, skill] of Object.entries(expected)) {
    assert.deepEqual(new Set(templates.filter((item) => item.focusKey === focus)
      .map((item) => item.skillKey)), new Set([skill]));
  }
});

test("template copy is actionable and bounded", () => {
  templates.forEach((template) => {
    assert.equal(template.title.length >= 3 && template.title.length <= 120, true);
    assert.equal(template.description.length >= 10 && template.description.length <= 300, true);
    assert.equal(template.minutes >= 5 && template.minutes <= 240, true);
  });
});

test("generation derives focus only from the saved onboarding row", () => {
  assert.match(builder, /p_onboarding public\.onboarding_profiles/i);
  assert.match(builder, /p_onboarding\.primary_focus/i);
  assert.match(builder, /vault_mission_focus_key\(v_focus\)/i);
  assert.doesNotMatch(builder, /p_focus|p_template|p_skill|p_reward/i);
});

test("custom onboarding focus uses general templates without losing display focus", () => {
  assert.match(migration, /else 'general'/i);
  assert.match(builder, /'focus', coalesce\(v_focus, 'Personal Growth'\)/i);
});

test("selection accepts no browser mission content", () => {
  assert.match(builder, /auth\.uid\(\)/i);
  assert.doesNotMatch(builder, /p_title|p_description|p_minutes|p_daily_key|p_user_id/i);
  assert.doesNotMatch(repositorySource, /mission_catalog|templateKey\s*:/i);
});

test("server selects the mapped skill from the catalog", () => {
  assert.match(builder, /'primarySkill', v_template\.primary_skill_key/i);
  assert.match(builder, /join public\.skill_catalog as skill[\s\S]*skill\.active = true/i);
});

test("server fixes every generated reward at twenty-five XP", () => {
  assert.match(builder, /'xpReward', 25/i);
  assert.doesNotMatch(builder, /p_xp|p_reward|xpReward'\s*,\s*p_/i);
});

test("server generates the mission instance identity", () => {
  assert.match(builder, /p_instance_id uuid/i);
  assert.match(builder, /v_template\.template_key \|\| '-' \|\| p_instance_id::text/i);
  assert.match(dailyMigration, /extensions\.gen_random_uuid\(\)/i);
});

test("same logical day returns its existing authoritative mission", () => {
  assert.match(dailyMigration, /where user_id = v_user_id and daily_key = v_daily_key[\s\S]*for update/i);
  assert.match(dailyMigration, /if found then[\s\S]*'existing'/i);
});

test("refresh and logout-login restore instead of rerolling", () => {
  assert.match(applicationSource, /const dailyResult = await repository\.requestDailyMission\(\)/i);
  assert.match(dailyMigration, /if found then[\s\S]*vault_daily_mission_response\(v_state, true, 'existing'/i);
});

test("concurrent daily requests converge on one saved mission", () => {
  assert.match(dailyMigration, /pg_advisory_xact_lock/i);
  assert.match(dailyMigration, /on conflict \(user_id, daily_key\) do nothing/i);
  assert.match(dailyMigration, /for update/i);
});

test("new logical days invoke the current catalog builder", () => {
  assert.match(dailyMigration, /v_definition := public\.build_vault_daily_mission/i);
  assert.match(builder, /current_vault_daily_key\(v_user_id, v_now\)/i);
});

test("recent authoritative assignments and completions drive anti-repetition", () => {
  assert.match(builder, /from public\.daily_mission_state as state/i);
  assert.match(builder, /from public\.mission_history as history/i);
  assert.match(builder, /order by usage\.last_used_at desc[\s\S]*limit 5/i);
});

test("unused templates are preferred before recently used templates", () => {
  assert.match(builder, /when candidate\.last_used_at is null then 0[\s\S]*else 1/i);
  assert.match(builder, /candidate\.last_used_at asc nulls first/i);
});

test("deterministic ordering uses owner, logical day, and template key", () => {
  assert.match(builder, /hashtextextended\([\s\S]*v_user_id::text[\s\S]*v_daily_key::text[\s\S]*candidate\.template_key/i);
});

test("single-candidate fallback remains valid", () => {
  assert.match(builder, /candidate\.candidate_count > 1/i);
  assert.match(builder, /limit 1/i);
  assert.match(builder, /if not found then[\s\S]*No active authoritative mission template/i);
});

test("replacement avoids the current template whenever alternatives exist", () => {
  assert.match(builder, /candidate\.template_key = v_current_template_key[\s\S]*candidate\.candidate_count > 1 then 2/i);
  assert.match(stagingMigration, /request_daily_mission_replacement_sprint9[\s\S]*build_vault_daily_mission/i);
});

test("replacement remains zero-argument and limited to one", () => {
  assert.match(stagingMigration, /function public\.request_daily_mission_replacement\(\)/i);
  assert.match(stagingMigration, /if v_state\.replacements_used >= 1 then/i);
  assert.match(stagingMigration, /replacements_used = 1/i);
});

test("replacement itself awards no XP or streak progress", () => {
  const replacement = stagingMigration.match(
    /create or replace function public\.request_daily_mission_replacement_sprint9\(\)[\s\S]*?\$\$;/i,
  )?.[0] || "";
  assert.doesNotMatch(replacement, /update public\.progression_state|update public\.skill_progression|apply_vault_streak_day|evaluate_vault_achievements/i);
});

test("completion rewards remain exactly twenty-five overall and fifteen skill XP", () => {
  assert.match(stagingMigration, /if v_reward <> 25 then/i);
  assert.match(stagingMigration, /v_skill_reward := 15/i);
  assert.doesNotMatch(migration, /update public\.progression_state|update public\.skill_progression/i);
});

test("same-day replacement completion remains one streak day", () => {
  assert.match(streakMigration, /if p_daily_key <= v_state\.last_completed_daily_key then[\s\S]*v_next_current := v_state\.current_streak/i);
  assert.match(streakMigration, /new\.final_state <> 'completed'/i);
});

test("achievement evaluation remains on the existing completion path", () => {
  assert.match(stagingMigration, /public\.evaluate_vault_achievements\(/i);
  assert.doesNotMatch(migration, /insert into public\.achievement_catalog|create table public\.user_achievements/i);
});

test("history captures a snapshot and optional authoritative template identity", () => {
  assert.match(migration, /add column template_key text references public\.mission_catalog/i);
  assert.match(historyTrigger, /mission_definition ->> 'description'/i);
  assert.match(historyTrigger, /mission_definition ->> 'templateKey'/i);
  assert.match(historyTrigger, /mission_definition ->> 'id' = new\.mission_id/i);
});

test("older history stays valid without an invented template identity", () => {
  assert.doesNotMatch(migration, /alter column template_key set not null/i);
  assert.match(migration, /history\.mission_id = state\.mission_definition ->> 'id'/i);
  assert.doesNotMatch(migration, /delete from public\.mission_history/i);
});

test("Vault History remains a snapshot projection independent of catalog edits", () => {
  assert.match(historyMigration, /history\.title[\s\S]*history\.focus[\s\S]*history\.mission_description/i);
  assert.doesNotMatch(historyMigration, /mission_catalog/i);
});

test("Analytics remains derived from immutable completed history", () => {
  assert.match(analyticsMigration, /from public\.mission_history as history/i);
  assert.match(analyticsMigration, /history\.final_state = 'completed'/i);
  assert.doesNotMatch(migration, /create or replace function public\.get_vault_analytics/i);
});

test("streak and Active Days definitions are not changed", () => {
  assert.doesNotMatch(migration, /create or replace function public\.apply_vault_streak_day|create or replace function public\.get_vault_analytics/i);
  assert.match(streakMigration, /after insert on public\.mission_history/i);
  assert.match(analyticsMigration, /count\(distinct \(history\.terminal_at at time zone 'utc'\)::date\)/i);
});

test("staging clock reaches the normal Sprint 15 selector", () => {
  assert.match(stagingMigration, /v_now timestamptz := public\.dev_effective_vault_now\(\)/i);
  assert.match(stagingMigration, /return public\.request_daily_mission_at\(v_now\)/i);
  assert.match(dailyMigration, /public\.build_vault_daily_mission/i);
  assert.match(builder, /public\.dev_effective_vault_now\(\)/i);
});

test("developer environment and account gates remain unchanged", () => {
  assert.match(stagingMigration, /enabled boolean not null default false/i);
  assert.match(stagingMigration, /public\.dev_tools_authorized\(v_user_id\)/i);
  assert.match(stagingMigration, /from public\.dev_test_accounts/i);
});

test("catalog and authoritative rows reject direct browser writes", () => {
  assert.match(migration, /alter table public\.mission_catalog enable row level security/i);
  assert.match(migration, /revoke all on public\.mission_catalog from public, anon, authenticated/i);
  assert.match(migration, /revoke insert, update, delete on public\.daily_mission_state from authenticated/i);
  assert.match(migration, /revoke insert, update, delete on public\.mission_history from authenticated/i);
});

test("Sprint 15 functions use SECURITY DEFINER and an empty search path", () => {
  const functions = migration.match(/create or replace function public\.[\s\S]*?\$\$;/gi) || [];
  assert.equal(functions.length, 3);
  functions.forEach((definition) => {
    assert.match(definition, /security definer/i);
    assert.match(definition, /set search_path = ''/i);
  });
});

test("production dashboard loads no browser mission generator", () => {
  assert.doesNotMatch(dashboardHTML, /mission-generator\.js/i);
  assert.doesNotMatch(dashboardSource, /KVNXMissionEngine|generateMission/i);
  assert.match(applicationSource, /Mission generation is server-authoritative/i);
});

test("authoritative application initialization works without a mission engine", async () => {
  const mission = Object.freeze({
    id: "programming-deep-work-00000000-0000-4000-8000-000000000001",
    templateKey: "programming-deep-work", focus: "Programming",
    title: "Complete a Focused Coding Session", description: "Reach one checkpoint.",
    estimatedDuration: "30 minutes", difficulty: "Balanced", xpReward: 25,
    primarySkill: "front_end_engineering",
  });
  const repository = {
    requestMissionAction: async () => null,
    requestDailyMission: async () => ({
      accepted: true, dailyKey: "2026-08-13", nextResetAt: "2026-08-14T04:00:00.000Z",
      mission: { definition: mission, lifecycle: { state: "ready", completionAwarded: false } },
      dailyStatus: { replacementsUsed: 0, replacementsRemaining: 1 },
    }),
    loadProfile: async () => ({ firstName: "Doug" }),
    loadOnboarding: async () => ({ primaryFocus: "Programming", completed: true }),
    loadProgression: async () => ({ totalXP: 100 }),
    getVaultHistory: async () => ({ entries: [], hasMore: false, nextOffset: 0, pageSize: 20 }),
    getSkillProgression: async () => [],
    getAchievementCatalog: async () => [],
    getUserAchievements: async () => [],
    getVaultStreak: async () => ({ currentStreak: 1, longestStreak: 1, lastCompletedDailyKey: "2026-08-12" }),
  };
  const service = applicationFactory.createApplicationService({
    authService: {}, repository, lifecycleEngine, coordinatorEngine,
    progressionEngine: {
      createProgression: (totalXP) => ({ totalXP }),
      getSnapshot: (state) => ({ currentXP: state.totalXP }),
    },
    transitionMode: "authoritative",
  });
  const result = await service.initialize();
  assert.equal(result.snapshot.coordinator.currentMission.definition.templateKey, "programming-deep-work");
});

test("frontend exposes no catalog mutation or mission-selection RPC", () => {
  const boundary = [repositorySource, applicationSource, dashboardSource, dashboardHTML].join("\n");
  assert.doesNotMatch(boundary, /from\("mission_catalog"\)|mission_catalog|selectMissionTemplate|chooseMissionTemplate/i);
  assert.match(repositorySource, /database\.rpc\("request_daily_mission"\)/i);
});

test("Sprint 15 introduces no service credential or secret", () => {
  const boundary = [migration, repositorySource, applicationSource, dashboardSource, dashboardHTML].join("\n");
  assert.doesNotMatch(boundary, /service_role|postgres(?:ql)?:\/\//i);
  assert.doesNotMatch(boundary, /supabaseServiceKey|databasePassword|jwtSecret/i);
});

test("installed migrations 001 through 015 remain byte-for-byte unchanged", () => {
  const lines = read("../migrations-pre-sprint15.sha256").trim().split("\n");
  assert.equal(lines.length, 14);
  assert.equal(lines.some((line) => line.includes("016_")), false);
  lines.forEach((line) => {
    const [digest, file] = line.trim().split(/\s+/, 2);
    assert.equal(hash(file.replace(/^app\//, "")), digest, file);
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
