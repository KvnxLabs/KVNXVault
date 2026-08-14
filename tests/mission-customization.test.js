"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const repositoryFactory = require("../js/user-repository.js");
const dashboard = require("../js/dashboard.js");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const migration = read("supabase/migrations/202608070028_sprint26_mission_customization.sql");
const migration18 = read("supabase/migrations/202608070018_sprint19_daily_mission_choice.sql");
const migration22 = read("supabase/migrations/202608070022_sprint22_side_mission_lifecycle.sql");
const repositorySource = read("js/user-repository.js");
const serviceSource = read("js/application-service.js");
const dashboardSource = read("js/dashboard.js");
const html = read("dashboard.html");
const css = read("css/dashboard.css");
const setter = migration.match(/create or replace function public\.set_mission_customization[\s\S]*?\n\$\$;/i)?.[0] || "";
const daily = migration.match(/create or replace function public\.request_daily_mission_at_sprint9[\s\S]*?\n\$\$;/i)?.[0] || "";
const tests = [];
const test = (name, run) => tests.push({ name, run });

const customizationResponse = Object.freeze({
  accepted: true,
  preferredFocusKey: "fitness",
  preferredFocusName: "Fitness",
  effectiveFocusKey: "fitness",
  onboardingFocusKey: "programming",
  onboardingFocusName: "Programming",
  effectiveTiming: "next-uncreated-daily-choice",
  options: Object.freeze([
    Object.freeze({ key: "programming", name: "Programming" }),
    Object.freeze({ key: "fitness", name: "Fitness" }),
  ]),
});

test("Migration 028 is uniquely and correctly named", () => {
  const files = fs.readdirSync(path.join(root, "supabase/migrations")).filter((name) => /^202608070028_/.test(name));
  assert.deepEqual(files, ["202608070028_sprint26_mission_customization.sql"]);
});
test("preference persistence is separate from onboarding, progression, and Skill Paths", () => {
  assert.match(migration, /create table public\.user_mission_preferences/);
  assert.doesNotMatch(setter, /update public\.(?:onboarding_profiles|progression_state|skill_progression|user_skill_paths)/i);
});
test("focus preference uses the exact closed catalog focus allowlist", () => {
  for (const key of ["career", "business", "programming", "fitness", "health", "learning", "creativity", "finance", "relationships", "mindset", "general"]) {
    assert.match(migration, new RegExp(`'${key}'`));
  }
});
test("server rejects a focus without active authoritative templates and canonical skills", () => {
  assert.match(setter, /mission_catalog[\s\S]*skill_catalog[\s\S]*catalog\.active = true/i);
});
test("unknown and malformed browser focus values are rejected before RPC", async () => {
  const repository = repositoryFactory.createUserRepository({
    authService: { getCurrentUser: async () => ({ id: "owner" }), getClient: () => ({}) },
    client: {},
  });
  await assert.rejects(repository.setMissionCustomization("not-a-focus"), TypeError);
  await assert.rejects(repository.setMissionCustomization({ title: "Invented" }), TypeError);
});
test("browser submits only the canonical focus key", () => {
  assert.match(repositorySource, /database\.rpc\("set_mission_customization", \{ p_focus_key: normalizedFocusKey \}\)/);
  assert.doesNotMatch(repositorySource.match(/const setMissionCustomization[\s\S]*?\n    };/)?.[0] || "", /xp|reward|title|description|user.?id|daily|timezone/i);
});
test("setter derives ownership exclusively from auth.uid", () => {
  assert.match(setter, /v_user_id uuid := auth\.uid\(\)/);
  assert.doesNotMatch(setter.match(/set_mission_customization\(([^)]*)\)/)?.[1] || "", /user|owner/i);
});
test("preference mutation uses one owner lock and idempotent upsert", () => {
  assert.match(setter, /pg_advisory_xact_lock/);
  assert.match(setter, /on conflict \(user_id\) do update/);
});
test("saving preference creates no mission, choice set, history, or lifecycle transition", () => {
  assert.doesNotMatch(setter, /daily_mission_state|daily_mission_choice_state|side_mission_state|mission_history|lifecycle_state/i);
});
test("saving preference awards no XP, Skill XP, streak, or achievement", () => {
  assert.doesNotMatch(setter, /progression_state|skill_progression|user_streak_state|user_achievements|xp_awarded/i);
});
test("existing authoritative mission returns before customization can generate choices", () => {
  assert.ok(daily.indexOf("if found then\n    return public.vault_daily_mission_response") < daily.indexOf("v_focus_key := public.vault_effective_mission_focus_key"));
});
test("existing persisted choice returns before customization can generate choices", () => {
  assert.ok(daily.indexOf("vault_daily_mission_choice_response(v_choice_state") < daily.indexOf("v_focus_key := public.vault_effective_mission_focus_key"));
});
test("future choice generation uses the saved effective focus", () => {
  assert.match(migration, /vault_effective_mission_focus_key[\s\S]*where catalog\.focus_key = v_focus_key/i);
});
test("retired preference falls back safely to onboarding focus", () => {
  assert.match(migration, /return public\.vault_mission_focus_key\(p_primary_focus\)/);
});
test("customization preserves persisted choice stability and anti-repetition", () => {
  assert.match(migration, /daily_mission_choice_state[\s\S]*on conflict \(user_id, daily_key\) do nothing/i);
  assert.match(migration, /template_usage[\s\S]*usage\.last_used_at asc nulls first/i);
});
test("Daily reward remains fixed at +25 overall and +15 mapped skill XP", () => {
  assert.match(migration, /'xpReward', 25/);
  assert.match(migration18, /'xpReward', 25/);
  assert.match(read("supabase/migrations/202608070012_sprint11_1_developer_test_panel.sql"), /v_skill_reward := 15/);
});
test("Side Mission reward remains fixed at +10 overall and +10 mapped skill XP", () => {
  assert.match(migration22, /v_total_xp := v_total_xp \+ 10/);
  assert.match(migration22, /v_skill_total := v_skill_total \+ 10/);
  assert.doesNotMatch(migration, /side_mission_state|skill_path_mission_offer_state/i);
});
test("customization cannot bypass Daily replacement or Side capacity", () => {
  assert.doesNotMatch(migration, /request_daily_mission_replacement|replacements_used\s*=|rewarded_remaining|side_mission_capacity/i);
});
test("read RPC exposes focus metadata without mission templates", () => {
  const getter = migration.match(/create or replace function public\.get_mission_customization[\s\S]*?\n\$\$;/i)?.[0] || "";
  assert.match(getter, /preferredFocusKey/);
  assert.doesNotMatch(getter, /templateKey|title|description|xpReward|selection_weight/i);
});
test("repository validates, normalizes, and deeply freezes restoration", async () => {
  const client = { rpc: async () => ({ data: customizationResponse, error: null }) };
  const repository = repositoryFactory.createUserRepository({ authService: { getCurrentUser: async () => ({ id: "owner" }), getClient: () => client }, client });
  const restored = await repository.getMissionCustomization();
  assert.equal(restored.preferredFocusKey, "fitness");
  assert.equal(Object.isFrozen(restored), true);
  assert.equal(Object.isFrozen(restored.options[0]), true);
});
test("repository rejects malformed authoritative customization responses", async () => {
  const client = { rpc: async () => ({ data: { ...customizationResponse, options: [{ key: "fake", name: "Fake" }] }, error: null }) };
  const repository = repositoryFactory.createUserRepository({ authService: { getCurrentUser: async () => ({ id: "owner" }), getClient: () => client }, client });
  await assert.rejects(repository.getMissionCustomization(), (error) => error.code === "mission-customization-response-invalid");
});
test("setter response must reconcile the requested authoritative focus", async () => {
  const calls = [];
  const client = { rpc: async (name, payload) => { calls.push({ name, payload }); return { data: customizationResponse, error: null }; } };
  const repository = repositoryFactory.createUserRepository({ authService: { getCurrentUser: async () => ({ id: "owner" }), getClient: () => client }, client });
  const result = await repository.setMissionCustomization("FITNESS");
  assert.equal(result.preferredFocusKey, "fitness");
  assert.deepEqual(calls[0], { name: "set_mission_customization", payload: { p_focus_key: "fitness" } });
});
test("Application Service restores preference without making it mission authority", () => {
  assert.match(serviceSource, /repository\.getMissionCustomization\(\)\.catch\(\(\) => null\)/);
  assert.match(serviceSource, /missionCustomization,/);
  assert.doesNotMatch(serviceSource.match(/const saveMissionCustomization[\s\S]*?\n    };/)?.[0] || "", /requestDailyMission|selectDailyMission|requestReplacement|routeAction/i);
});
test("Application Service snapshots freeze customization options", () => {
  assert.match(serviceSource, /missionCustomization = Object\.freeze\(\{[\s\S]*options: Object\.freeze/);
});
test("customization load failure is isolated from Daily Mission restoration", () => {
  assert.match(serviceSource, /getMissionCustomization\(\)\.catch\(\(\) => null\)/);
  assert.match(html, /Customization is temporarily unavailable[\s\S]*current Daily and Side Missions remain available/i);
});
test("Mission Center hosts the secondary customization control", () => {
  assert.ok(html.indexOf("data-missions-view") < html.indexOf("data-mission-customization"));
  assert.ok(html.indexOf("data-mission-customization") < html.indexOf("data-mission-center-content"));
  assert.doesNotMatch(html.match(/data-dashboard-home[\s\S]*?data-missions-view/)?.[0] || "", /data-mission-customization/);
});
test("effective-timing copy matches the future-only contract", () => {
  assert.match(html, /Today’s mission and existing choices will not change/);
  assert.match(html, /next Daily Mission choice set the Vault has not created yet/);
});
test("customization control is accessible and keyboard-native", () => {
  assert.match(html, /<form[^>]+data-mission-customization-form/);
  assert.match(html, /<label for="mission-customization-focus">Preferred focus<\/label>/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(css, /mission-customization select:focus-visible/);
});
test("responsive customization layout avoids horizontal overflow", () => {
  assert.match(css, /@media \(max-width: 480px\)[\s\S]*\.mission-customization__controls \{\s*grid-template-columns: 1fr/);
  assert.doesNotMatch(css, /\.mission-customization[^}]*min-width:\s*[4-9]\d{2}px/i);
});
test("save UI reconciles only from the Application Service result", () => {
  assert.match(dashboardSource, /await vaultApplication\.saveMissionCustomization[\s\S]*applicationSnapshot = result\.snapshot[\s\S]*renderMissionCustomization\(applicationSnapshot/);
  assert.doesNotMatch(dashboardSource, /supabase\.from|database\.rpc/i);
});
test("save failure preserves missions and reports no false success", () => {
  assert.match(dashboardSource, /could not save that preference\. Your missions remain unchanged/);
  assert.match(dashboardSource, /if \(!result\?\.accepted\) throw/);
});
test("restoration gate hides customization until authoritative initialization", () => {
  assert.match(html, /data-protected-loading[\s\S]*data-protected-content hidden/);
  assert.ok(dashboardSource.indexOf("renderMissionCustomization(applicationSnapshot)") < dashboardSource.indexOf("protectedContentGate.reveal()"));
});
test("Quick Actions remain navigation-only and unchanged by customization", () => {
  const quick = dashboardSource.match(/const renderQuickActions = \(snapshot\) => \{[\s\S]*?\n  };/)?.[0] || "";
  assert.doesNotMatch(quick, /missionCustomization|saveMissionCustomization/);
});
test("Sprint 24 operational APIs are not exposed by customization UI", () => {
  assert.doesNotMatch([html, dashboardSource, repositorySource].join("\n"), /run_vault_operational_monitoring|get_vault_operational_health|establish_vault_legacy_xp_baseline/i);
});
test("RLS and direct-write revocation protect preference persistence", () => {
  assert.match(migration, /alter table public\.user_mission_preferences enable row level security/);
  assert.match(migration, /revoke all on public\.user_mission_preferences from public, anon, authenticated/);
  assert.doesNotMatch(migration, /create policy/i);
});
test("SECURITY DEFINER functions use fixed search paths and minimal grants", () => {
  const definitions = [...migration.matchAll(/create or replace function public\.([a-z0-9_]+)[\s\S]*?\n\$\$;/gi)];
  assert.equal(definitions.length, 6);
  definitions.forEach((definition) => {
    assert.match(definition[0], /security definer/);
    assert.match(definition[0], /set search_path = ''/);
  });
  assert.equal((migration.match(/grant execute on function public\.(?:get_mission_customization\(\)|set_mission_customization\(text\)) to authenticated/g) || []).length, 2);
});
test("anonymous and public callers receive no customization execution grant", () => {
  assert.doesNotMatch(migration, /grant execute[^;]+to (?:anon|public)/i);
});
test("no frontend service-role secret or arbitrary account authority is introduced", () => {
  assert.doesNotMatch([repositorySource, serviceSource, dashboardSource, html].join("\n"), /service_role|SUPABASE_SERVICE|postgres(?:ql)?:\/\//i);
  assert.doesNotMatch(repositorySource.match(/setMissionCustomization[\s\S]{0,800}/)?.[0] || "", /p_user_id|user_id:/i);
});
test("Migration 028 function definitions are fully terminated", () => {
  assert.equal((migration.match(/create or replace function public\./g) || []).length, 6);
  assert.equal((migration.match(/\$\$;/g) || []).length, 6);
  assert.equal((migration.match(/\bas \$\$/g) || []).length, 6);
});
test("migrations 001 through 027 remain byte-for-byte unchanged", () => {
  const baseline = read("../migrations-pre-sprint26.sha256").trim().split("\n");
  assert.equal(baseline.length, 26);
  baseline.forEach((line) => {
    const [digest, relativePath] = line.trim().split(/\s+/);
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "..", relativePath))).digest("hex");
    assert.equal(actual, digest, relativePath);
  });
});
test("JavaScript syntax and HTML local references remain valid", () => {
  for (const file of ["js/user-repository.js", "js/application-service.js", "js/dashboard.js"]) {
    assert.equal(spawnSync(process.execPath, ["--check", path.join(root, file)]).status, 0, file);
  }
  for (const match of html.matchAll(/(?:src|href)="((?:js|css)\/[^"#]+)"/g)) {
    assert.equal(fs.existsSync(path.join(root, match[1])), true, match[1]);
  }
});
test("presentation view model is immutable and exposes no mission definition", () => {
  const view = dashboard.missionCustomization.createViewModel({ missionCustomization: { available: true, ...customizationResponse } });
  assert.equal(view.selectedKey, "fitness");
  assert.equal(Object.isFrozen(view), true);
  assert.equal(Object.isFrozen(view.options[0]), true);
  assert.equal("mission" in view, false);
});
test("retired saved focus renders the server-effective fallback instead of a fake option", () => {
  const view = dashboard.missionCustomization.createViewModel({
    missionCustomization: {
      available: true,
      preferredFocusKey: "fitness",
      effectiveFocusKey: "programming",
      options: [{ key: "programming", name: "Programming" }],
    },
  });
  assert.equal(view.available, true);
  assert.equal(view.selectedKey, "programming");
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failures += 1; console.error(`✗ ${name}`); console.error(error); }
  }
  if (failures) process.exitCode = 1;
})();
