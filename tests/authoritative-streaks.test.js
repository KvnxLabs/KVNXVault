"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const repositoryFactory = require("../js/user-repository.js");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const hash = (relativePath) => crypto.createHash("sha256")
  .update(fs.readFileSync(path.join(root, relativePath))).digest("hex");
const migration = read("supabase/migrations/202608070015_sprint14_authoritative_streaks.sql");
const completionMigration = read("supabase/migrations/202608070012_sprint11_1_developer_test_panel.sql");
const catalogMigration = read("supabase/migrations/202608070011_sprint11_achievements.sql");
const repositorySource = read("js/user-repository.js");
const applicationSource = read("js/application-service.js");
const dashboardSource = read("js/dashboard.js");
const dashboardHTML = read("dashboard.html");
const devToolsLoaderSource = read("js/dev-tools-loader.js");
const applyFunction = migration.match(
  /create or replace function public\.apply_vault_streak_day[\s\S]*?\$\$;/i,
)?.[0] || "";
const triggerFunction = migration.match(
  /create or replace function public\.capture_vault_streak_completion[\s\S]*?\$\$;/i,
)?.[0] || "";
const streakRPC = migration.match(
  /create or replace function public\.get_vault_streak\(\)[\s\S]*?\$\$;/i,
)?.[0] || "";

const tests = [];
const test = (name, run) => tests.push({ name, run });

const createStreakRepository = (response) => {
  const calls = [];
  const client = {
    rpc: async (name, args) => {
      calls.push({ name, args, argumentCount: arguments.length });
      return { data: response, error: null };
    },
  };
  return {
    calls,
    repository: repositoryFactory.createUserRepository({
      authService: {
        getCurrentUser: async () => ({ id: "authenticated-account" }),
        getClient: () => client,
      },
    }),
  };
};

test("Sprint 14 creates exactly one authoritative streak row per user", () => {
  assert.match(migration, /create table public\.user_streak_state[\s\S]*user_id uuid primary key/i);
  assert.match(migration, /references auth\.users\(id\) on delete cascade/i);
});

test("streak state enforces nonnegative and internally consistent values", () => {
  assert.match(migration, /current_streak >= 0/i);
  assert.match(migration, /longest_streak >= current_streak/i);
  assert.match(migration, /user_streak_state_zero_consistent/i);
});

test("first completed logical day initializes current and longest streak to one", () => {
  assert.match(applyFunction, /values \(p_user_id, 1, 1, p_daily_key\)/i);
});

test("a second completion on the same logical day cannot increment the streak", () => {
  assert.match(applyFunction, /if p_daily_key <= v_state\.last_completed_daily_key then[\s\S]*v_next_current := v_state\.current_streak/i);
});

test("the immediately following logical day increments current streak once", () => {
  assert.match(applyFunction, /p_daily_key = v_state\.last_completed_daily_key \+ 1[\s\S]*v_state\.current_streak \+ 1/i);
});

test("a missed logical day resets current streak to one on the next completion", () => {
  assert.match(applyFunction, /else\s+v_next_current := 1/i);
});

test("longest streak remains preserved after a current-streak reset", () => {
  assert.match(applyFunction, /longest_streak = greatest\(longest_streak, v_next_current\)/i);
});

test("streak transitions serialize on the owner row", () => {
  assert.match(applyFunction, /from public\.user_streak_state[\s\S]*for update/i);
  assert.match(applyFunction, /on conflict \(user_id\) do nothing/i);
});

test("only authoritative completed history invokes streak evaluation", () => {
  assert.match(triggerFunction, /if new\.final_state <> 'completed' then\s+return new/i);
  assert.match(triggerFunction, /public\.apply_vault_streak_day\(new\.user_id, v_daily_key\)/i);
});

test("skipped and expired missions leave streak state unchanged", () => {
  assert.doesNotMatch(triggerFunction, /final_state\s+in\s+\([^)]*skipped|final_state\s+in\s+\([^)]*expired/i);
  assert.match(triggerFunction, /new\.final_state <> 'completed'/i);
});

test("rejected duplicate completion cannot reach the streak trigger", () => {
  assert.match(migration, /after insert on public\.mission_history/i);
  assert.match(completionMigration, /elsif v_previous_state = 'completed' then\s+v_reason := 'already-completed'/i);
  assert.match(completionMigration, /if v_accepted then[\s\S]*insert into public\.mission_history/i);
});

test("concurrent duplicate completion remains protected by the existing mission lock", () => {
  assert.match(completionMigration, /from public\.daily_mission_state[\s\S]*for update/i);
  assert.match(completionMigration, /insert into public\.mission_history/i);
  assert.match(migration, /create trigger mission_history_capture_streak[\s\S]*after insert/i);
});

test("same-day replacement completion remains one streak day", () => {
  assert.match(applyFunction, /p_daily_key <= v_state\.last_completed_daily_key/i);
  assert.match(completionMigration, /replacements_used/i);
});

test("third consecutive day activates the existing three-day achievement", () => {
  assert.match(migration, /select 'THREE_DAY_STREAK' where v_current_streak >= 3/i);
  assert.match(catalogMigration, /'THREE_DAY_STREAK', 'Three-Day Streak'/i);
});

test("seven consecutive days activate the existing seven-day achievement", () => {
  assert.match(migration, /select 'SEVEN_DAY_STREAK' where v_current_streak >= 7/i);
  assert.match(catalogMigration, /'SEVEN_DAY_STREAK', 'Seven-Day Streak'/i);
});

test("Sprint 14 does not duplicate achievement catalog definitions", () => {
  assert.doesNotMatch(migration, /insert into public\.achievement_catalog/i);
});

test("streak achievement unlocks remain duplicate-safe and multi-result capable", () => {
  assert.match(migration, /on conflict \(user_id, achievement_key\) do nothing/i);
  assert.match(migration, /jsonb_agg\(jsonb_build_object[\s\S]*v_new_achievements/i);
});

test("historical reconciliation counts each completed logical day once", () => {
  assert.match(migration, /select distinct\s+history\.user_id,\s+parsed\.daily_key/i);
  assert.match(migration, /where history\.final_state = 'completed'/i);
});

test("historical reconciliation accepts only defensively parsed ISO daily keys", () => {
  assert.match(migration, /parse_vault_daily_key\(history\.daily_session_id\)/i);
  assert.match(migration, /p_value !~ '\^\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}\$'/i);
  assert.match(migration, /exception when datetime_field_overflow or invalid_datetime_format/i);
});

test("historical reconstruction derives both current and longest streak groups", () => {
  assert.match(migration, /daily_key - row_number\(\) over/i);
  assert.match(migration, /max\(groups\.streak_length\)::integer as longest_streak/i);
  assert.match(migration, /current_group\.last_day = summary\.last_completed_daily_key/i);
});

test("historical reconciliation never rewrites mission timestamps or records", () => {
  assert.doesNotMatch(migration, /update public\.mission_history|delete from public\.mission_history/i);
});

test("the restoration RPC is exactly zero argument and authenticated", () => {
  assert.match(migration, /function public\.get_vault_streak\(\)/i);
  assert.doesNotMatch(streakRPC, /p_user|p_date|p_daily|p_time|p_streak/i);
  assert.match(streakRPC, /v_user_id uuid := auth\.uid\(\)/i);
  assert.match(streakRPC, /Authentication required[\s\S]*42501/i);
});

test("the restoration RPC returns only authoritative streak fields", () => {
  assert.match(streakRPC, /'currentStreak'[\s\S]*'longestStreak'[\s\S]*'lastCompletedDailyKey'/i);
  assert.doesNotMatch(streakRPC, /timezone|mission_count|browser/i);
});

test("RLS allows authenticated users to read only their own streak", () => {
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /for select to authenticated[\s\S]*auth\.uid\(\)\) = user_id/i);
});

test("direct browser streak writes and internal mutation execution are denied", () => {
  assert.match(migration, /revoke insert, update, delete on public\.user_streak_state from authenticated/i);
  assert.match(migration, /revoke all on function public\.apply_vault_streak_day\(uuid, date\)[\s\S]*authenticated/i);
  assert.match(migration, /revoke all on function public\.capture_vault_streak_completion\(\)[\s\S]*authenticated/i);
});

test("all Sprint 14 authority functions pin an empty search path", () => {
  const definitions = migration.match(/create or replace function public\.[\s\S]*?\$\$;/gi) || [];
  assert.equal(definitions.length >= 6, true);
  definitions.forEach((definition) => assert.match(definition, /security definer[\s\S]*set search_path = ''/i));
});

test("repository calls the streak RPC without browser arguments", async () => {
  const calls = [];
  const client = {
    rpc: async (...args) => {
      calls.push(args);
      return { data: { currentStreak: 3, longestStreak: 7, lastCompletedDailyKey: "2026-08-12" }, error: null };
    },
  };
  const repository = repositoryFactory.createUserRepository({
    authService: { getCurrentUser: async () => ({ id: "owner" }), getClient: () => client },
  });
  await repository.getVaultStreak();
  assert.deepEqual(calls, [["get_vault_streak"]]);
});

test("repository normalizes and freezes authoritative streak values", async () => {
  const { repository } = createStreakRepository({
    currentStreak: "3", longestStreak: 7, lastCompletedDailyKey: "2026-08-12",
  });
  const streak = await repository.getVaultStreak();
  assert.deepEqual(streak, { currentStreak: 3, longestStreak: 7, lastCompletedDailyKey: "2026-08-12" });
  assert.equal(Object.isFrozen(streak), true);
});

test("repository rejects malformed and impossible server streak data", async () => {
  for (const response of [
    { currentStreak: 2, longestStreak: 1, lastCompletedDailyKey: "2026-08-12" },
    { currentStreak: 1.5, longestStreak: 2, lastCompletedDailyKey: "2026-08-12" },
    { currentStreak: 1, longestStreak: 2, lastCompletedDailyKey: "2026-02-30" },
    { currentStreak: 0, longestStreak: 4, lastCompletedDailyKey: null },
  ]) {
    const { repository } = createStreakRepository(response);
    await assert.rejects(() => repository.getVaultStreak(), (error) => (
      error.code === "vault-streak-response-invalid"
    ));
  }
});

test("accepted mission responses preserve and freeze the server streak snapshot", () => {
  assert.match(repositorySource, /streak: result\.streak \? mapVaultStreak\(result\.streak\) : null/i);
  assert.match(repositorySource, /return deepFreeze\(mapped\)/i);
});

test("application initialization restores streak for refresh and later login", () => {
  assert.match(applicationSource, /repository\.getVaultStreak\(\)/i);
  assert.match(applicationSource, /loadedStreak = streakResult/i);
  assert.match(applicationSource, /if \(loadedStreak\) streak = loadedStreak/i);
  assert.match(applicationSource, /streak,\s+analytics,/i);
});

test("accepted completion reconciles streak into the immutable application snapshot", () => {
  assert.match(applicationSource, /if \(result\.streak\) streak = result\.streak/i);
  assert.match(applicationSource, /const getPublicSnapshot = \(\) => Object\.freeze\(/i);
});

test("the browser submits no streak, date, daily key, or timezone to streak authority", () => {
  const method = repositorySource.match(/const getVaultStreak = async[\s\S]*?\n    };/i)?.[0] || "";
  assert.doesNotMatch(method, /userId|user_id|currentStreak|longestStreak|dailyKey|date|timezone|p_/i);
  assert.match(method, /database\.rpc\("get_vault_streak"\)/i);
});

test("dashboard provides intentional zero state and singular-plural grammar", () => {
  assert.match(dashboardHTML, /No active streak yet/i);
  assert.match(dashboardHTML, /Complete today's mission to begin building consistency/i);
  assert.match(dashboardSource, /value === 1 \? "day" : "days"/i);
});

test("dashboard only formats the authoritative application streak snapshot", () => {
  assert.match(dashboardSource, /renderStreak\(applicationSnapshot\.streak\)/i);
  assert.match(dashboardSource, /renderStreak\(applicationResult\.snapshot\.streak\)/i);
  assert.doesNotMatch(dashboardSource, /currentStreak\s*\+\+|currentStreak\s*\+=|longestStreak\s*=\s*Math\.max/i);
});

test("Analytics displays global authoritative streak without redefining Active Days", () => {
  assert.match(dashboardHTML, /data-analytics-current-streak[\s\S]*data-analytics-longest-streak/i);
  assert.match(dashboardHTML, /Active days are not a current or longest streak/i);
  assert.match(dashboardSource, /const authoritativeStreak = applicationSnapshot\.streak/i);
  assert.match(dashboardSource, /analyticsActiveValue\.textContent = viewModel\.activeDaysLabel/i);
});

test("the staging simulated clock remains the source behind completion", () => {
  assert.match(completionMigration, /v_now timestamptz := public\.dev_effective_vault_now\(\)/i);
  assert.match(migration, /request_vault_mission_action_sprint13\(p_mission_id, p_action\)/i);
  assert.match(migration, /new\.daily_session_id/i);
});

test("production developer-clock restrictions remain byte-for-byte preserved", () => {
  const preSprint13 = read("../migrations-pre-sprint13.sha256");
  const line = preSprint13.split("\n").find((entry) => entry.includes("202608070012_"));
  assert.ok(line);
  assert.equal(hash("supabase/migrations/202608070012_sprint11_1_developer_test_panel.sql"), line.split(/\s+/)[0]);
  assert.match(completionMigration, /enabled boolean not null default false/i);
  assert.match(completionMigration, /dev_tools_authorized\(v_user_id\)/i);
  assert.match(devToolsLoaderSource, /kvnxlabs\.com[\s\S]*kvnx-vault\.vercel\.app/i);
});

test("canonical completion rewards remain exactly +25 overall and +15 skill XP", () => {
  assert.match(completionMigration, /if v_reward <> 25 then/i);
  assert.match(completionMigration, /v_skill_reward := 15/i);
  assert.doesNotMatch(migration, /v_reward\s*:=|v_skill_reward\s*:=|update public\.progression_state|update public\.skill_progression/i);
});

test("Daily Complete, replacement limit, and Vault History remain on existing paths", () => {
  assert.match(dashboardSource, /renderDailyComplete/i);
  assert.match(dashboardSource, /KVNXReplacementRequestController\.create/i);
  assert.match(repositorySource, /database\.rpc\("get_vault_history"\)/i);
  assert.doesNotMatch(migration, /create or replace function public\.get_vault_history/i);
});

test("Sprint 14 adds no frontend service credential or secret", () => {
  const boundary = [repositorySource, applicationSource, dashboardSource, dashboardHTML].join("\n");
  assert.doesNotMatch(boundary, /service_role|postgres(?:ql)?:\/\//i);
  assert.doesNotMatch(boundary, /supabaseServiceKey|databasePassword|jwtSecret/i);
});

test("installed migrations 001 through 014 remain byte-for-byte unchanged", () => {
  const lines = read("../migrations-pre-sprint14.sha256").trim().split("\n");
  assert.equal(lines.length, 13);
  assert.equal(lines.some((line) => line.includes("015_")), false);
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
