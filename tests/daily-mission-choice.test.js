"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const vm = require("node:vm");
const repositoryFactory = require("../js/user-repository.js");
const applicationFactory = require("../js/application-service.js");
const coordinatorEngine = require("../js/mission-coordinator.js");
const lifecycleEngine = require("../js/mission-lifecycle.js");
const dashboard = require("../js/dashboard.js");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const migration = read("supabase/migrations/202608070018_sprint19_daily_mission_choice.sql");
const migration12 = read("supabase/migrations/202608070012_sprint11_1_developer_test_panel.sql");
const migration15 = read("supabase/migrations/202608070015_sprint14_authoritative_streaks.sql");
const migration17 = read("supabase/migrations/202608070017_sprint18_achievement_center.sql");
const repositorySource = read("js/user-repository.js");
const applicationSource = read("js/application-service.js");
const dashboardSource = read("js/dashboard.js");
const html = read("dashboard.html");
const css = read("css/dashboard.css");
const progressionContext = vm.createContext({ window: {} });
vm.runInContext(read("js/progression.js"), progressionContext);
const progressionEngine = progressionContext.window.KVNXProgression;

const choiceId = "11111111-1111-4111-8111-111111111111";
const choices = Object.freeze([
  Object.freeze({ choiceId, title: "Complete a Focused Coding Session", description: "Work without switching tasks until a clear checkpoint is reached.", estimatedDuration: "30 minutes", difficulty: "Balanced", xpReward: 25, primarySkill: "front_end_engineering", primarySkillName: "Front-End Engineering" }),
  Object.freeze({ choiceId: "22222222-2222-4222-8222-222222222222", title: "Refactor One Weak Point", description: "Improve code structure, naming, or maintainability.", estimatedDuration: "30 minutes", difficulty: "Balanced", xpReward: 25, primarySkill: "front_end_engineering", primarySkillName: "Front-End Engineering" }),
  Object.freeze({ choiceId: "33333333-3333-4333-8333-333333333333", title: "Strengthen an Edge Case", description: "Improve one test beyond the happy path.", estimatedDuration: "25 minutes", difficulty: "Balanced", xpReward: 25, primarySkill: "front_end_engineering", primarySkillName: "Front-End Engineering" }),
]);
const choiceResponse = Object.freeze({ accepted: true, reason: "choice-required", dailyKey: "2026-08-13", nextResetAt: "2026-08-14T04:00:00.000Z", choiceRequired: true, choices, dailyStatus: Object.freeze({ replacementsUsed: 0, replacementsRemaining: 1 }) });
const missionResponse = Object.freeze({
  accepted: true, reason: "selected", dailyKey: "2026-08-13", nextResetAt: "2026-08-14T04:00:00.000Z", choiceRequired: false, choices: Object.freeze([]),
  mission: Object.freeze({ definition: Object.freeze({ id: "programming-deep-work-server-uuid", templateKey: "programming-deep-work", focus: "Programming", title: choices[0].title, description: choices[0].description, estimatedDuration: "30 minutes", difficulty: "Balanced", xpReward: 25, primarySkill: "front_end_engineering" }), lifecycle: Object.freeze({ state: "ready", completionAwarded: false, terminalAt: null, terminalRecorded: false }) }),
  dailyStatus: Object.freeze({ replacementsUsed: 0, replacementsRemaining: 1 }),
});

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("server produces a bounded persisted mission choice set", () => assert.match(migration, /jsonb_array_length\(choices\) between 1 and 3/i));
test("target is three choices when enough candidates exist", () => assert.match(migration, /where selection_rank <= 3/i));
test("fewer valid candidates are returned without fabricated options", () => assert.match(migration, /select \* from ranked where selection_rank <= 3[\s\S]*jsonb_agg/i));
test("choice candidates require active catalog templates", () => assert.match(migration, /catalog\.focus_key = v_focus_key[\s\S]*catalog\.active = true/i));
test("choice generation uses saved onboarding focus", () => assert.match(migration, /p_onboarding\.primary_focus[\s\S]*vault_mission_focus_key\(v_focus\)/i));
test("choice skills come from active canonical skill catalog rows", () => assert.match(migration, /join public\.skill_catalog as skill[\s\S]*skill\.active = true/i));
test("every offered primary reward is fixed at 25 XP", () => assert.match(migration, /'xpReward', 25/i));
test("choice set stability is persisted by owner and logical day", () => assert.match(migration, /primary key \(user_id, daily_key\)/i));
test("navigation performs no choice regeneration RPC", () => assert.doesNotMatch(dashboardSource, /hashchange[\s\S]{0,180}requestDailyMission/i));
test("logout and login restore through the same daily authority", () => assert.match(applicationSource, /initialize[\s\S]*repository\.requestDailyMission\(\)/i));
test("simultaneous choice-set requests converge under the daily advisory lock", () => assert.match(migration, /pg_advisory_xact_lock[\s\S]*on conflict \(user_id, daily_key\) do nothing/i));
test("browser cannot request an arbitrary catalog template", () => assert.doesNotMatch(repositorySource, /selectDailyMissionChoice[\s\S]{0,500}templateKey/i));
test("another user's option cannot escape auth.uid ownership", () => assert.match(migration, /v_user_id uuid := auth\.uid\(\)/i));
test("stale daily choices are rejected against the current logical day", () => assert.match(migration, /current_vault_daily_key\(v_user_id, v_now\)[\s\S]*daily_key = v_daily_key/i));
test("selection validates exact offered membership", () => assert.match(migration, /jsonb_array_elements\(v_choice_state\.choices\)[\s\S]*choiceId' = p_choice_id::text/i));
test("selection creates exactly one authoritative daily mission row", () => assert.match(migration, /insert into public\.daily_mission_state/i));
test("selection cannot be changed after the mission locks", () => assert.match(migration, /'mission-already-selected'/i));
test("duplicate same-choice selection restores the existing mission", () => assert.match(migration, /selected_choice_id = p_choice_id[\s\S]*'existing-selection'/i));
test("conflicting selections return the winning mission without switching it", () => assert.match(migration, /vault_daily_mission_response\([\s\S]*false, 'mission-already-selected'/i));
test("mission instance UUID remains server-owned", () => assert.match(migration, /extensions\.gen_random_uuid\(\)/i));
test("selected title is restored from the server-owned offered snapshot", () => assert.match(migration, /'title', v_offered ->> 'title'/i));
test("selected description is restored from the server-owned offered snapshot", () => assert.match(migration, /'description', v_offered ->> 'description'/i));
test("selected skill is restored and validated server-side", () => assert.match(migration, /'primarySkill', v_skill_key/i));
test("selected reward is rebuilt as the fixed server value", () => assert.match(migration, /v_definition := jsonb_build_object\([\s\S]*'xpReward', 25/i));
test("selection contract accepts no user id", () => assert.doesNotMatch(migration.match(/create or replace function public\.select_daily_mission_choice[\s\S]*?returns jsonb/i)?.[0] || "", /p_user/i));
test("selection contract accepts no daily key", () => {
  const call = repositorySource.match(/database\.rpc\("select_daily_mission_choice", \{[\s\S]*?\}\)/i)?.[0] || "";
  assert.doesNotMatch(call, /p_daily|daily_key/i);
});
test("selection contract accepts no timezone", () => assert.doesNotMatch(repositorySource, /select_daily_mission_choice[\s\S]{0,180}timezone/i));
test("selection performs no overall XP award", () => assert.doesNotMatch(migration, /set total_xp\s*=\s*total_xp\s*\+/i));
test("selection performs no skill XP award", () => assert.doesNotMatch(migration, /set skill_xp|skill_xp_awarded/i));
test("selection does not invoke streak mutation", () => assert.doesNotMatch(migration, /apply_vault_streak|user_streak_state\s+set/i));
test("selection does not evaluate achievements", () => assert.doesNotMatch(migration, /evaluate_vault_achievements|insert into public\.user_achievements/i));
test("selection creates no mission history", () => {
  const selection = migration.match(/create or replace function public\.select_daily_mission_choice[\s\S]*?\$\$;/i)?.[0] || "";
  assert.doesNotMatch(selection, /insert into public\.mission_history/i);
});
test("existing daily mission bypasses choice creation", () => assert.match(migration, /if found then\s+return public\.vault_daily_mission_response\(v_state, true, 'existing'/i));
test("existing mission restoration is unchanged", () => assert.match(migration, /public\.vault_daily_mission_response\(v_state, true, 'existing', null\)/i));
test("existing replacement function remains untouched", () => assert.doesNotMatch(migration, /create or replace function public\.request_daily_mission_replacement/i));
test("one replacement remains authoritative", () => assert.match(migration12, /if v_state\.replacements_used >= 1 then/i));
test("Daily Complete remains based on terminal mission and replacement use", () => assert.match(dashboardSource, /state === "completed" && replacementsRemaining === 0/i));
test("Mission Center consumes the shared choice snapshot", () => assert.match(html, /data-daily-choice-list="missions"/i));
test("Dashboard consumes the shared choice snapshot", () => assert.match(html, /data-daily-choice-list="dashboard"/i));
test("choice rendering does not trigger a reroll", () => assert.doesNotMatch(dashboardSource.match(/const renderDailyMissionChoices[\s\S]*?\n  };/)?.[0] || "", /requestDailyMission|selectDailyMission\(/i));
test("protected restoration gate remains in front of product content", () => assert.match(html, /data-protected-loading[\s\S]*data-protected-content hidden/i));
test("developer clock feeds the normal Sprint 19 daily path", () => assert.match(migration12, /dev_effective_vault_now\(\)[\s\S]*request_daily_mission_at\(v_now\)/i));
test("production developer-clock gates remain disabled by default", () => assert.match(migration12, /enabled boolean not null default false[\s\S]*values \(true, false\)/i));
test("Vault History receives no choice events", () => {
  const selection = migration.match(/create or replace function public\.select_daily_mission_choice[\s\S]*?\$\$;/i)?.[0] || "";
  assert.doesNotMatch(selection, /mission_history|history_record|final_state/i);
});
test("Analytics receives no choice-derived activity", () => assert.doesNotMatch(migration, /get_vault_analytics|missionActivity|activeDays/i));
test("Skill Center receives no choice mutation authority", () => assert.doesNotMatch(migration, /update public\.skill_progression|insert into public\.skill_progression/i));
test("Achievement Center evaluation remains unchanged", () => assert.doesNotMatch(migration, /get_achievement_catalog|achievement_catalog/i));
test("Sprint 18 hidden achievement masking remains unchanged", () => assert.match(migration17, /case when catalog\.hidden and earned\.achievement_key is null then null/i));
test("accepted mission completion remains exactly +25 XP", () => assert.match(migration12, /if v_reward <> 25 then/i));
test("accepted mapped skill completion remains exactly +15 XP", () => assert.match(migration12, /v_skill_reward := 15/i));
test("streaks still advance only from completed authoritative history", () => assert.match(migration15, /after insert on public\.mission_history[\s\S]*capture_vault_streak_completion/i));
test("existing achievement evaluation remains completion-only", () => assert.match(migration12, /if v_xp_awarded > 0 then[\s\S]*evaluate_vault_achievements/i));
test("new choice persistence has RLS and direct-write denial", () => assert.match(migration, /alter table public\.daily_mission_choice_state enable row level security[\s\S]*revoke all on public\.daily_mission_choice_state from public, anon, authenticated/i));
test("frontend selection submits only one opaque choice id", () => assert.match(repositorySource, /database\.rpc\("select_daily_mission_choice", \{\s*p_choice_id: normalizedChoiceId,\s*\}\)/i));
test("frontend contains no service-role credential", () => assert.doesNotMatch([repositorySource, applicationSource, dashboardSource, html].join("\n"), /service_role\s*[:=]|SUPABASE_SERVICE_ROLE_KEY|postgres(?:ql)?:\/\//i));
test("migrations 001 through 017 remain immutable", () => {
  const baseline = read("../migrations-pre-sprint19.sha256").trim().split("\n");
  assert.equal(baseline.length, 16);
  baseline.forEach((line) => {
    const [digest, relativePath] = line.trim().split(/\s+/);
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "..", relativePath))).digest("hex");
    assert.equal(actual, digest, relativePath);
  });
});
test("Migration 018 is the only Sprint 19 migration", () => {
  const sprint19 = fs.readdirSync(path.join(root, "supabase/migrations")).filter((name) => name.includes("sprint19"));
  assert.deepEqual(sprint19, ["202608070018_sprint19_daily_mission_choice.sql"]);
});
test("JavaScript syntax passes", () => ["js/dashboard.js", "js/application-service.js", "js/user-repository.js"].forEach((file) => assert.equal(spawnSync(process.execPath, ["--check", path.join(root, file)]).status, 0, file)));
test("HTML local references resolve", () => {
  for (const match of html.matchAll(/(?:src|href)="((?:js|css)\/[^"#]+)"/g)) assert.equal(fs.existsSync(path.join(root, match[1])), true, match[1]);
});
test("secret scan passes for Sprint 19 sources", () => assert.doesNotMatch([migration, repositorySource, applicationSource, dashboardSource].join("\n"), /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|postgres(?:ql)?:\/\/[^\s]+:[^\s@]+@/i));
test("choice UX has semantic cards, descriptive buttons, and visible data", () => assert.match(dashboardSource, /document\.createElement\("article"\)[\s\S]*Choose .* as today’s mission/i));
test("choice UX supports responsive layouts and reduced motion", () => {
  assert.match(css, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/i);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.daily-choice__grid/i);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.daily-choice__option/i);
});

test("repository validates and deeply freezes authoritative choice responses", async () => {
  const calls = [];
  const client = { rpc: (name, payload) => { calls.push({ name, payload }); return Promise.resolve({ data: name === "request_daily_mission" ? choiceResponse : missionResponse, error: null }); } };
  const repository = repositoryFactory.createUserRepository({ authService: { getCurrentUser: async () => ({ id: "owner" }), getClient: () => client }, client });
  const restored = await repository.requestDailyMission();
  assert.equal(restored.choiceRequired, true);
  assert.equal(Object.isFrozen(restored.choices[0]), true);
  const selected = await repository.selectDailyMissionChoice(choiceId);
  assert.equal(selected.mission.definition.xpReward, 25);
  assert.deepEqual(calls[1], { name: "select_daily_mission_choice", payload: { p_choice_id: choiceId } });
});

test("Application Service restores choice-required without fabricating a mission", async () => {
  const repository = {
    loadProfile: async () => Object.freeze({ firstName: "Doug" }),
    loadOnboarding: async () => Object.freeze({ primaryFocus: "Programming", intensity: "Balanced", completed: true }),
    loadProgression: async () => Object.freeze({ totalXP: 75 }),
    loadMissionHistory: async () => Object.freeze([]),
    requestDailyMission: async () => choiceResponse,
    requestMissionAction: async () => { throw new Error("No mission exists yet"); },
    selectDailyMissionChoice: async () => missionResponse,
  };
  const service = applicationFactory.createApplicationService({ authService: { signOut: async () => {} }, repository, lifecycleEngine, coordinatorEngine, progressionEngine, transitionMode: "authoritative" });
  const initialized = await service.initialize();
  assert.equal(initialized.snapshot.coordinator, null);
  assert.equal(initialized.snapshot.dailyChoice.required, true);
  assert.equal(Object.isFrozen(initialized.snapshot.dailyChoice.options), true);
  const blocked = await service.complete();
  assert.equal(blocked.reason, "daily-choice-required");
  const selected = await service.selectDailyMission(choiceId);
  assert.equal(selected.snapshot.dailyChoice.required, false);
  assert.equal(selected.snapshot.coordinator.currentMission.definition.id, "programming-deep-work-server-uuid");
});

test("presentation helper projects choices without template or catalog metadata", () => {
  const view = dashboard.dailyMissionChoice.createViewModel({ dailyChoice: { required: true, options: choices } });
  assert.equal(view.required, true);
  assert.equal(view.options.length, 3);
  assert.equal("templateKey" in view.options[0], false);
  assert.equal(view.options[0].xpReward, 25);
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failures += 1; console.error(`✗ ${name}`); console.error(error); }
  }
  if (failures) process.exitCode = 1;
})();
