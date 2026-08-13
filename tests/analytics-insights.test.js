"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const repositoryFactory = require("../js/user-repository.js");
const dashboard = require("../js/dashboard.js");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const hash = (relativePath) => crypto.createHash("sha256")
  .update(fs.readFileSync(path.join(root, relativePath))).digest("hex");
const migration = read("supabase/migrations/202608070014_sprint13_analytics_insights.sql");
const repositorySource = read("js/user-repository.js");
const applicationSource = read("js/application-service.js");
const dashboardSource = read("js/dashboard.js");
const dashboardHTML = read("dashboard.html");
const dashboardCSS = read("css/dashboard.css");
const rpc = migration.match(
  /create or replace function public\.get_vault_analytics\(p_period text\)[\s\S]*?\$\$;/i,
)?.[0] || "";

const analyticsResponse = Object.freeze({
  period: "7d",
  generatedAt: "2026-08-12T16:00:00.000Z",
  periodStart: "2026-08-06",
  summary: Object.freeze({
    missionsCompleted: 4,
    overallXPEarned: 100,
    skillXPEarned: 60,
    activeDays: 3,
    achievementsUnlocked: 2,
  }),
  mostDevelopedSkill: Object.freeze({
    key: "front_end_engineering", name: "Front-End Engineering", xpEarned: 30,
  }),
  missionActivity: Object.freeze([
    Object.freeze({ date: "2026-08-06", completedCount: 0 }),
    Object.freeze({ date: "2026-08-07", completedCount: 1 }),
    Object.freeze({ date: "2026-08-08", completedCount: 0 }),
    Object.freeze({ date: "2026-08-09", completedCount: 2 }),
    Object.freeze({ date: "2026-08-10", completedCount: 0 }),
    Object.freeze({ date: "2026-08-11", completedCount: 0 }),
    Object.freeze({ date: "2026-08-12", completedCount: 1 }),
  ]),
  xpActivity: Object.freeze([
    Object.freeze({ date: "2026-08-06", xpEarned: 0 }),
    Object.freeze({ date: "2026-08-07", xpEarned: 25 }),
    Object.freeze({ date: "2026-08-08", xpEarned: 0 }),
    Object.freeze({ date: "2026-08-09", xpEarned: 50 }),
    Object.freeze({ date: "2026-08-10", xpEarned: 0 }),
    Object.freeze({ date: "2026-08-11", xpEarned: 0 }),
    Object.freeze({ date: "2026-08-12", xpEarned: 25 }),
  ]),
  skillActivity: Object.freeze([
    Object.freeze({ key: "front_end_engineering", name: "Front-End Engineering", xpEarned: 30 }),
    Object.freeze({ key: "business", name: "Business", xpEarned: 15 }),
    Object.freeze({ key: "learning", name: "Learning", xpEarned: 15 }),
  ]),
});

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("analytics RPC accepts only one bounded period argument", () => {
  assert.match(migration, /get_vault_analytics\(p_period text\)/i);
  assert.doesNotMatch(rpc, /p_user_id|p_owner|p_account|p_start|p_end|p_xp/i);
});

test("analytics ownership derives from auth.uid()", () => {
  assert.match(rpc, /v_user_id uuid := auth\.uid\(\)/i);
  assert.match(rpc, /history\.user_id = v_user_id/i);
  assert.match(rpc, /earned\.user_id = v_user_id/i);
});

test("invalid analytics periods are rejected server-side", () => {
  assert.match(rpc, /v_period not in \('7d', '30d', 'all'\)/i);
  assert.match(rpc, /Unsupported analytics period[\s\S]*22023/i);
});

test("only authoritative completed history is aggregated", () => {
  assert.match(rpc, /from public\.mission_history as history/i);
  assert.match(rpc, /history\.final_state = 'completed'/i);
  assert.doesNotMatch(migration, /create table public\.(?:analytics|analytics_events)/i);
});

test("7-day period is the current UTC day plus six prior days", () => {
  assert.match(rpc, /when '7d' then v_today - 6/i);
  assert.match(rpc, /generate_series\(v_start_date, v_today, interval '1 day'\)/i);
});

test("30-day period is the current UTC day plus twenty-nine prior days", () => {
  assert.match(rpc, /when '30d' then v_today - 29/i);
});

test("all-time period includes all owner-completed history", () => {
  assert.match(rpc, /v_period = 'all'[\s\S]*history\.terminal_at >=/i);
  assert.match(rpc, /from daily_totals as totals[\s\S]*where v_period = 'all'/i);
});

test("completed missions are counted from filtered history", () => {
  assert.match(rpc, /count\(\*\)::integer as missions_completed/i);
  assert.match(rpc, /'missionsCompleted', summary\.missions_completed/i);
});

test("overall XP is summed from authoritative history awards", () => {
  assert.match(rpc, /sum\(history\.xp_awarded\)/i);
  assert.match(rpc, /'overallXPEarned', summary\.overall_xp_earned/i);
});

test("skill XP is summed from authoritative history attribution", () => {
  assert.match(rpc, /sum\(history\.skill_xp_awarded\)/i);
  assert.match(rpc, /'skillXPEarned', summary\.skill_xp_earned/i);
});

test("most-developed skill comes from the highest period skill XP", () => {
  assert.match(rpc, /'mostDevelopedSkill'[\s\S]*order by skill\.xp_earned desc/i);
  assert.match(rpc, /join public\.skill_catalog as catalog/i);
});

test("most-developed-skill ties use deterministic catalog ordering", () => {
  assert.match(rpc, /order by skill\.xp_earned desc, skill\.sort_order asc, skill\.skill_key asc/i);
});

test("active days count distinct authoritative UTC completion dates", () => {
  assert.match(rpc, /count\(distinct \(history\.terminal_at at time zone 'utc'\)::date\)::integer as active_days/i);
});

test("achievement insight counts persisted unlock rows only", () => {
  assert.match(rpc, /from public\.user_achievements as earned/i);
  assert.match(rpc, /'achievementsUnlocked'/i);
  assert.doesNotMatch(rpc, /evaluate_vault_achievements/i);
});

test("empty accounts return zero summaries and empty skill activity", () => {
  assert.match(rpc, /coalesce\(sum\(history\.xp_awarded\), 0\)/i);
  assert.match(rpc, /coalesce\(sum\(history\.skill_xp_awarded\), 0\)/i);
  assert.match(rpc, /'skillActivity', coalesce/i);
});

test("account isolation applies to every analytics source", () => {
  const ownerPredicates = rpc.match(/(?:history|earned)\.user_id = v_user_id/gi) || [];
  assert.equal(ownerPredicates.length >= 2, true);
  assert.doesNotMatch(rpc, /user_id\s*=\s*p_/i);
});

test("analytics RPC is stable, read-only, and explicitly secured", () => {
  assert.match(migration, /language plpgsql[\s\S]*stable[\s\S]*security definer[\s\S]*set search_path = ''/i);
  assert.match(migration, /revoke all on function public\.get_vault_analytics\(text\) from public, anon/i);
  assert.match(migration, /grant execute on function public\.get_vault_analytics\(text\) to authenticated/i);
});

test("analytics adds no browser write grants", () => {
  assert.doesNotMatch(migration, /grant\s+(?:insert|update|delete|all).*authenticated/i);
  assert.match(migration, /revoke insert, update, delete on public\.mission_history from authenticated/i);
  assert.match(migration, /revoke insert, update, delete on public\.user_achievements from authenticated/i);
});

test("repository sends only the selected period", async () => {
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push({ name, args }); return { data: analyticsResponse, error: null }; } };
  const repository = repositoryFactory.createUserRepository({
    authService: { getCurrentUser: async () => ({ id: "account-a" }), getClient: () => client },
  });
  const result = await repository.getVaultAnalytics("7d");
  assert.deepEqual(calls, [{ name: "get_vault_analytics", args: { p_period: "7d" } }]);
  assert.equal(result.period, "7d");
});

test("browser cannot submit another user identity", () => {
  const method = repositorySource.match(/const getVaultAnalytics = async[\s\S]*?\n    };/i)?.[0] || "";
  assert.doesNotMatch(method, /userId|user_id|p_user|owner|account/i);
  assert.match(method, /p_period: normalizedPeriod/i);
});

test("repository rejects unsupported periods before the RPC", async () => {
  let called = false;
  const client = { rpc: async () => { called = true; return { data: null, error: null }; } };
  const repository = repositoryFactory.createUserRepository({
    authService: { getCurrentUser: async () => ({ id: "account-a" }), getClient: () => client },
  });
  await assert.rejects(() => repository.getVaultAnalytics("custom"), TypeError);
  assert.equal(called, false);
});

test("repository normalizes and deeply freezes analytics", async () => {
  const client = { rpc: async () => ({ data: analyticsResponse, error: null }) };
  const repository = repositoryFactory.createUserRepository({
    authService: { getCurrentUser: async () => ({ id: "account-a" }), getClient: () => client },
  });
  const result = await repository.getVaultAnalytics("7d");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.summary), true);
  assert.equal(Object.isFrozen(result.skillActivity[0]), true);
});

test("malformed analytics responses fail safely", async () => {
  const client = { rpc: async () => ({ data: { period: "7d" }, error: null }) };
  const repository = repositoryFactory.createUserRepository({
    authService: { getCurrentUser: async () => ({ id: "account-a" }), getClient: () => client },
  });
  await assert.rejects(() => repository.getVaultAnalytics("7d"), (error) => (
    error.code === "vault-analytics-response-invalid"
  ));
});

test("application service owns analytics restoration", () => {
  assert.match(applicationSource, /const loadAnalytics = async \(period = "7d"\)/i);
  assert.match(applicationSource, /repository\.getVaultAnalytics\(normalizedPeriod\)/i);
  assert.match(applicationSource, /analytics = restored/i);
  assert.doesNotMatch(dashboardSource, /\.rpc\(|supabase\.from|database\.from/i);
});

test("duplicate concurrent period requests share one application request", () => {
  assert.match(applicationSource, /analyticsRequests\.has\(normalizedPeriod\)[\s\S]*analyticsRequests\.get\(normalizedPeriod\)/i);
  assert.match(applicationSource, /analyticsRequests\.set\(normalizedPeriod, request\)/i);
});

test("immutable application snapshots include analytics", () => {
  assert.match(applicationSource, /const getPublicSnapshot = \(\) => Object\.freeze\(\{[\s\S]*analytics,/i);
  assert.match(repositorySource, /return deepFreeze\(\{[\s\S]*missionActivity[\s\S]*skillActivity/i);
});

test("Analytics navigation opens inside the existing dashboard shell", () => {
  assert.match(dashboardHTML, /href="#analytics" data-view-link="analytics"/i);
  assert.match(dashboardHTML, /data-analytics-view[\s\S]*aria-labelledby="analytics-title"/i);
  assert.match(dashboardSource, /window\.location\.hash === "#analytics"/i);
});

test("period controls are keyboard-native and expose pressed state", () => {
  assert.match(dashboardHTML, /data-analytics-period="7d" aria-pressed="true"/i);
  assert.match(dashboardHTML, /data-analytics-period="30d" aria-pressed="false"/i);
  assert.match(dashboardHTML, /data-analytics-period="all" aria-pressed="false"/i);
  assert.match(dashboardSource, /button\.addEventListener\("click"/i);
});

test("Analytics has a restrained accessible loading state", () => {
  assert.match(dashboardHTML, /data-analytics-loading role="status"/i);
  assert.match(dashboardSource, /analyticsLoading\.hidden = false/i);
  assert.doesNotMatch(dashboardHTML, /data-analytics-missions>\d+/i);
});

test("Analytics errors are recoverable without destroying the dashboard", () => {
  assert.match(dashboardHTML, /data-analytics-error role="alert"[\s\S]*data-analytics-retry/i);
  assert.match(dashboardSource, /analyticsRetry\?\.addEventListener\("click", \(\) => loadAnalytics/i);
  assert.doesNotMatch(dashboardSource, /analytics[\s\S]{0,120}persistenceBlocked\s*=\s*true/i);
});

test("zero history renders the intentional empty state", () => {
  const empty = dashboard.analytics.createViewModel({
    period: "7d", generatedAt: analyticsResponse.generatedAt,
    summary: { missionsCompleted: 0, overallXPEarned: 0, skillXPEarned: 0, activeDays: 0, achievementsUnlocked: 0 },
    mostDevelopedSkill: null, missionActivity: [], xpActivity: [], skillActivity: [],
  });
  assert.equal(empty.empty, true);
  assert.match(dashboardHTML, /No progress recorded yet[\s\S]*Complete your first mission/i);
});

test("zero-activity chart values remain explicit and understandable", () => {
  const view = dashboard.analytics.createViewModel(analyticsResponse);
  assert.equal(view.missionActivity[0].value, 0);
  assert.equal(view.missionActivity[0].height, 2);
  assert.match(view.missionChartLabel, /4 completed missions.*3 active days/i);
});

test("charts provide screen-reader text equivalents", () => {
  assert.match(dashboardHTML, /data-analytics-mission-chart role="img" aria-label/i);
  assert.match(dashboardHTML, /<caption>Completed missions by date<\/caption>/i);
  assert.match(dashboardHTML, /<caption>XP earned by date<\/caption>/i);
  assert.match(dashboardSource, /container\.setAttribute\("aria-label", chartLabel\)/i);
});

test("skill bars are explicitly period-relative analytics", () => {
  const view = dashboard.analytics.createViewModel(analyticsResponse);
  assert.deepEqual(view.skillActivity.map((skill) => skill.contribution), [100, 50, 50]);
  assert.match(dashboardHTML, /XP earned during period/i);
  assert.doesNotMatch(dashboardHTML, /analytics[\s\S]{0,300}toward Level/i);
});

test("active days are never presented as streaks", () => {
  assert.match(dashboardHTML, /Active days are not a current or longest streak/i);
  assert.match(dashboardSource, /analyticsActiveValue\.textContent = viewModel\.activeDaysLabel/i);
  assert.doesNotMatch(dashboardSource, /currentStreak\s*=\s*viewModel\.activeDays|longestStreak\s*=\s*viewModel\.activeDays/i);
  assert.doesNotMatch(migration, /THREE_DAY_STREAK|SEVEN_DAY_STREAK/i);
});

test("responsive analytics structure and reduced motion are preserved", () => {
  assert.match(dashboardCSS, /@media \(max-width: 860px\)[\s\S]*\.analytics-panel--wide/i);
  assert.match(dashboardCSS, /@media \(max-width: 620px\)[\s\S]*\.analytics-metrics/i);
  assert.match(dashboardCSS, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.analytics-state__mark/i);
});

test("canonical overall and skill XP rewards remain unchanged", () => {
  const skillMigration = read("supabase/migrations/202608070008_sprint10_skill_progression.sql");
  assert.match(skillMigration, /v_skill_reward := 15/i);
  assert.match(skillMigration, /v_reward <> 25/i);
  assert.doesNotMatch(migration, /update public\.progression_state|update public\.skill_progression/i);
});

test("replacement, Daily Complete, and countdown behavior remain untouched", () => {
  assert.doesNotMatch(migration, /request_daily_mission_replacement|request_daily_mission\(|nextResetAt/i);
  assert.match(dashboardSource, /renderDailyComplete/i);
  assert.match(dashboardSource, /KVNXReplacementRequestController\.create/i);
});

test("achievements and Vault History remain server-authoritative and unchanged", () => {
  assert.doesNotMatch(migration, /evaluate_vault_achievements|create or replace function public\.get_vault_history/i);
  assert.match(repositorySource, /database\.rpc\("get_user_achievements"\)/i);
  assert.match(repositorySource, /database\.rpc\("get_vault_history"\)/i);
});

test("installed migrations 001-013 remain byte-for-byte unchanged", () => {
  const expected = Object.fromEntries(read("../migrations-pre-sprint13.sha256").trim().split("\n").map((line) => {
    const [digest, file] = line.trim().split(/\s+/, 2);
    return [file.replace(/^app\//, ""), digest];
  }));
  assert.equal(Object.keys(expected).length, 12);
  assert.equal(Object.keys(expected).some((file) => file.includes("014_")), false);
  Object.entries(expected).forEach(([file, digest]) => assert.equal(hash(file), digest, file));
});

test("the pre-Sprint-12 packaging fingerprint remains valid", () => {
  const expected = Object.fromEntries(read("../migrations-pre-sprint12.sha256").trim().split("\n").map((line) => {
    const [digest, file] = line.trim().split(/\s+/, 2);
    return [file.replace(/^app\//, ""), digest];
  }));
  assert.equal(Object.keys(expected).length, 11);
  Object.entries(expected).forEach(([file, digest]) => assert.equal(hash(file), digest, file));
});

test("Sprint 13 contains no frontend secret or service-role credential", () => {
  const boundary = [repositorySource, applicationSource, dashboardSource, dashboardHTML].join("\n");
  assert.doesNotMatch(boundary, /service_role|postgres(?:ql)?:\/\//i);
  assert.doesNotMatch(boundary, /supabaseServiceKey|databasePassword|jwtSecret/i);
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failures += 1; console.error(`✗ ${name}`); console.error(error); }
  }
  if (failures) process.exitCode = 1;
})();
