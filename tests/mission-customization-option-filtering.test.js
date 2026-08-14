"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const migration = read("supabase/migrations/202608070029_sprint26_1_customization_option_filtering.sql");
const migration28 = read("supabase/migrations/202608070028_sprint26_mission_customization.sql");
const migration12 = read("supabase/migrations/202608070012_sprint11_1_developer_test_panel.sql");
const migration20 = read("supabase/migrations/202608070020_sprint21_skill_path_mission_offers.sql");
const migration22 = read("supabase/migrations/202608070022_sprint22_side_mission_lifecycle.sql");
const getter = migration.match(/create or replace function public\.get_mission_customization\(\)[\s\S]*?\n\$\$;/i)?.[0] || "";
const setter = migration.match(/create or replace function public\.set_mission_customization\(p_focus_key text\)[\s\S]*?\n\$\$;/i)?.[0] || "";
const allowed = migration.match(/create or replace function public\.vault_mission_customization_focus_allowed[\s\S]*?\n\$\$;/i)?.[0] || "";
const tests = [];
const test = (name, run) => tests.push({ name, run });
const hash = (file) => crypto.createHash("sha256").update(read(file)).digest("hex");
const canonical = [
  "career", "business", "programming", "fitness", "health", "learning",
  "creativity", "finance", "relationships", "mindset", "general",
];

test("Migration 029 is uniquely and correctly named", () => {
  const files = fs.readdirSync(path.join(root, "supabase/migrations")).filter((name) => /^202608070029_/.test(name));
  assert.deepEqual(files, ["202608070029_sprint26_1_customization_option_filtering.sql"]);
});
test("Sprint 21 is the authoritative source of the active skill_path focus", () => {
  assert.match(migration20, /'general', 'skill_path'/);
  assert.match(migration20, /'path-backend-api-contract', 'skill_path'/);
});
test("Migration 028 getter reproduced the unfiltered active-focus defect", () => {
  const oldGetter = migration28.match(/create or replace function public\.get_mission_customization\(\)[\s\S]*?\n\$\$;/i)?.[0] || "";
  assert.match(oldGetter, /where catalog\.active = true\s*group by catalog\.focus_key/i);
  assert.doesNotMatch(oldGetter, /vault_mission_customization_focus_allowed/);
});
test("one internal predicate centralizes the exact closed contract", () => {
  canonical.forEach((key) => assert.match(allowed, new RegExp(`'${key}'`)));
  assert.equal((allowed.match(/'([a-z_]+)'/g) || []).length, canonical.length);
});
test("skill_path is not a customization value", () => assert.doesNotMatch(allowed, /'skill_path'/));
test("unknown future catalog focus keys cannot become customization values", () => {
  assert.match(allowed, /p_focus_key in \(/);
  assert.match(allowed, /coalesce\([\s\S]*false\)/);
});
test("getter filters every active catalog group through the closed predicate", () => {
  assert.match(getter, /vault_mission_customization_focus_allowed\(catalog\.focus_key\)/);
});
test("getter excludes every option without a canonical non-null label", () => {
  assert.match(getter, /vault_mission_focus_label\(catalog\.focus_key\) is not null/);
  assert.match(getter, /'name', available\.focus_label/);
});
test("setter consumes the same centralized contract", () => {
  assert.match(setter, /not public\.vault_mission_customization_focus_allowed\(v_focus_key\)/);
  assert.doesNotMatch(setter, /v_focus_key not in \(/);
});
test("setter rejects skill_path before any persistence", () => {
  assert.ok(setter.indexOf("vault_mission_customization_focus_allowed") < setter.indexOf("insert into public.user_mission_preferences"));
  assert.doesNotMatch(allowed, /skill_path/);
});
test("valid preference save and restore remain idempotent", () => {
  assert.match(setter, /on conflict \(user_id\) do update/);
  assert.match(setter, /return public\.get_mission_customization\(\)/);
});
test("effective focus also uses the centralized allowlist", () => {
  const effective = migration.match(/create or replace function public\.vault_effective_mission_focus_key[\s\S]*?\n\$\$;/i)?.[0] || "";
  assert.match(effective, /vault_mission_customization_focus_allowed\(v_preferred_focus_key\)/);
  assert.match(effective, /return public\.vault_mission_focus_key\(p_primary_focus\)/);
});
test("retired canonical focuses remain omitted without deleting saved preference", () => {
  assert.match(getter, /catalog\.active = true/);
  assert.match(getter, /skill\.active = true/);
  assert.doesNotMatch(migration, /delete from public\.user_mission_preferences/i);
});
test("current Daily Mission and persisted choice state are untouched", () => {
  assert.doesNotMatch(migration, /(?:insert into|update|delete from) public\.(?:daily_mission_state|daily_mission_choice_state)/i);
});
test("saving preference performs no choice generation or reroll", () => {
  assert.doesNotMatch(setter, /build_vault_daily_mission_choices|request_daily_mission|daily_mission_choice_state/i);
});
test("migration performs no gameplay mutation", () => {
  assert.doesNotMatch(migration, /(?:insert into|update|delete from) public\.(?:progression_state|skill_progression|mission_history|daily_mission_state|daily_mission_choice_state|side_mission_state|skill_path_mission_offer_state|user_streak_state|user_achievements)/i);
});
test("existing valid preference rows remain intact", () => {
  assert.doesNotMatch(migration, /alter column preferred_focus_key|update public\.user_mission_preferences|delete from public\.user_mission_preferences/i);
});
test("Daily reward remains exactly +25 overall and +15 mapped skill XP", () => {
  assert.match(migration12, /if v_reward <> 25 then/);
  assert.match(migration12, /v_skill_reward := 15/);
  assert.doesNotMatch(migration, /xpReward|skill_xp_awarded|total_xp/i);
});
test("Side reward remains exactly +10 overall and +10 mapped skill XP", () => {
  assert.match(migration22, /v_total_xp := v_total_xp \+ 10/);
  assert.match(migration22, /v_skill_total := v_skill_total \+ 10/);
});
test("Side Mission and Skill Path catalog behavior is not redefined", () => {
  assert.doesNotMatch(migration, /create or replace function public\.(?:build_skill_path_mission_offers|request_skill_path_mission_offers|select_skill_path_mission_offer|promote_skill_path_offer_to_side_mission|complete_side_mission)/i);
  assert.doesNotMatch(migration, /update public\.mission_catalog|delete from public\.mission_catalog/i);
});
test("RLS and no-policy table isolation are preserved", () => {
  assert.match(migration, /alter table public\.user_mission_preferences enable row level security/);
  assert.match(migration, /revoke all on public\.user_mission_preferences from public, anon, authenticated/);
  assert.doesNotMatch(migration, /create policy/i);
});
test("only getter and setter are executable by authenticated users", () => {
  const grants = [...migration.matchAll(/grant execute on function public\.([a-z0-9_]+\([^;]*?\)) to authenticated/gi)].map((match) => match[1]);
  assert.deepEqual(grants, ["get_mission_customization()", "set_mission_customization(text)"]);
});
test("anon and public cannot execute customization functions", () => {
  assert.doesNotMatch(migration, /grant execute[^;]+to (?:anon|public)/i);
  for (const signature of [
    "vault_mission_customization_focus_allowed\\(text\\)",
    "vault_effective_mission_focus_key\\(uuid, text\\)",
    "get_mission_customization\\(\\)",
    "set_mission_customization\\(text\\)",
  ]) assert.match(migration, new RegExp(`revoke all on function public\\.${signature}[\\s\\S]*?from public, anon, authenticated`));
});
test("every privileged function uses SECURITY DEFINER and empty search path", () => {
  const definitions = [...migration.matchAll(/create or replace function public\.([a-z0-9_]+)[\s\S]*?\n\$\$;/gi)];
  assert.equal(definitions.length, 4);
  definitions.forEach((definition) => {
    assert.match(definition[0], /security definer/);
    assert.match(definition[0], /set search_path = ''/);
  });
});
test("setter accepts no user identity, reward, mission, or time argument", () => {
  assert.equal(setter.match(/set_mission_customization\(([^)]*)\)/i)?.[1], "p_focus_key text");
  assert.match(setter, /v_user_id uuid := auth\.uid\(\)/);
});
test("frontend strict contract remains unchanged", () => {
  assert.equal(hash("js/user-repository.js"), "920453f0339e5f8f196c3dca4aeba476ef32e313634ab93ebeaa3f4bcbaa96e7");
  assert.equal(hash("js/application-service.js"), "6fabdcb94545c643a6a310463a80881987f6f9c7ad9f093763774f0034d90131");
  assert.equal(hash("js/dashboard.js"), "124c11577987ee4f5569a4643607e2877c5d6ec1109332ef3da9568635da3210");
});
test("Migration 028 remains byte-for-byte unchanged", () => {
  assert.equal(crypto.createHash("sha256").update(migration28).digest("hex"), "06aa906946db961669aad2aa32fa89850b11498b392f50de7a3d04f8cbf2bf3c");
});
test("migrations 001 through 028 remain byte-for-byte unchanged", () => {
  const baseline = read("../migrations-pre-sprint26.1.sha256").trim().split("\n");
  assert.equal(baseline.length, 27);
  baseline.forEach((line) => {
    const [digest, relativePath] = line.trim().split(/\s+/);
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "..", relativePath))).digest("hex");
    assert.equal(actual, digest, relativePath);
  });
});
test("Migration 029 SQL function definitions are terminated", () => {
  assert.equal((migration.match(/create or replace function public\./g) || []).length, 4);
  assert.equal((migration.match(/\bas \$\$/g) || []).length, 4);
  assert.equal((migration.match(/\$\$;/g) || []).length, 4);
});
test("no frontend secret or privileged monitoring exposure was introduced", () => {
  const frontend = [read("dashboard.html"), read("js/dashboard.js"), read("js/application-service.js"), read("js/user-repository.js")].join("\n");
  assert.doesNotMatch(frontend, /SUPABASE_SERVICE_ROLE_KEY|service_role\s*[:=]|postgres(?:ql)?:\/\//i);
  assert.doesNotMatch(frontend, /run_vault_operational_monitoring|get_vault_operational_health|establish_vault_legacy_xp_baseline/i);
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failures += 1; console.error(`✗ ${name}`); console.error(error); }
  }
  if (failures) process.exitCode = 1;
})();
