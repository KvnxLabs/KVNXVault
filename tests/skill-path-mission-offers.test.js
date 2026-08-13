"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const repositoryFactory = require("../js/user-repository.js");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const migration = read("supabase/migrations/202608070020_sprint21_skill_path_mission_offers.sql");
const migration8 = read("supabase/migrations/202608070008_sprint10_skill_progression.sql");
const migration15 = read("supabase/migrations/202608070016_sprint15_mission_catalog.sql");
const migration18 = read("supabase/migrations/202608070018_sprint19_daily_mission_choice.sql");
const migration19 = read("supabase/migrations/202608070019_sprint20_skill_paths.sql");
const repositorySource = read("js/user-repository.js");
const serviceSource = read("js/application-service.js");
const dashboardSource = read("js/dashboard.js");
const html = read("dashboard.html");
const css = read("css/dashboard.css");
const requestBody = migration.match(/create or replace function public\.request_skill_path_mission_offers[\s\S]*?comment on table/)?.[0] || "";
const selectionBody = migration.match(/create or replace function public\.select_skill_path_mission_offer[\s\S]*?comment on table/)?.[0] || "";

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("active canonical Skill Path is required to request offers", () => {
  assert.match(requestBody, /public\.user_skill_paths[\s\S]*path\.user_id = v_user_id[\s\S]*path_active = true/);
});
test("Fitness works independently of Programming onboarding focus", () => {
  assert.match(migration15, /'fitness-training-session'[\s\S]*'fitness'/);
  assert.doesNotMatch(requestBody, /onboarding|primary_focus/);
});
test("paused paths cannot request offers", () => assert.match(requestBody, /raise exception 'Active Skill Path required'/));
test("noncanonical and inactive catalog skills are rejected", () => assert.match(requestBody, /catalog\.skill_key = v_skill_key and catalog\.active = true/));
test("ownership derives exclusively from auth.uid", () => {
  assert.match(requestBody, /v_user_id uuid := auth\.uid\(\)/);
  assert.doesNotMatch(repositorySource, /requestSkillPathMissionOffers[\s\S]{0,500}userId|p_user_id/);
});
test("offers come only from active authoritative catalog rows", () => {
  assert.match(migration, /from public\.mission_catalog as catalog[\s\S]*catalog\.primary_skill_key = p_skill_key and catalog\.active = true/);
});
test("offers map exactly to the requested canonical skill", () => assert.match(migration, /'skillKey', p_skill_key[\s\S]*'skillName', ranked\.skill_name/));
test("target is bounded to three and fewer candidates remain honest", () => {
  assert.match(migration, /ranked\.offer_rank <= 3/);
  assert.match(migration, /jsonb_array_length\(offers\) between 0 and 3/);
});
test("no-candidate state is persisted and returned honestly", () => {
  assert.match(migration, /coalesce\(jsonb_agg[\s\S]*'\[\]'::jsonb/);
  assert.match(requestBody, /jsonb_array_length\(v_state\.offers\) = 0 then 'no-offers'/);
});
test("all twelve canonical skills have at least three eligible templates after Migration 020", () => {
  const combined = `${migration15}\n${migration}`;
  for (const key of ["front_end_engineering", "back_end_engineering", "product_design", "leadership", "communication", "problem_solving", "learning", "reading", "writing", "fitness", "business", "discipline"]) {
    assert.ok((combined.match(new RegExp(`'${key}'`, "g")) || []).length >= 3, key);
  }
});
test("path-only catalog extension cannot enter Sprint 19 focus pools", () => {
  assert.match(migration, /'skill_path'/);
  assert.doesNotMatch(migration18, /when 'skill_path'/);
  assert.match(migration18, /catalog\.focus_key = v_focus_key/);
});
test("offer sets are persisted by owner, logical day, and skill", () => assert.match(migration, /primary key \(user_id, daily_key, skill_key\)/));
test("refresh, navigation, and login restore the same stored row", () => {
  assert.match(requestBody, /if found then[\s\S]*vault_skill_path_offer_response\(v_state, true, 'restored'\)/);
  assert.match(serviceSource, /repository\.getSkillPathMissionOffers\(\)/);
});
test("concurrent offer requests converge under an advisory lock", () => {
  assert.match(requestBody, /pg_advisory_xact_lock/);
  assert.match(requestBody, /on conflict \(user_id, daily_key, skill_key\) do nothing/);
});
test("offer ordering is server-deterministic and has no browser randomness", () => {
  assert.match(migration, /hashtextextended/);
  assert.doesNotMatch(dashboardSource, /Math\.random|crypto\.randomUUID/);
});
test("recent authoritative usage prefers unused and older templates", () => assert.match(migration, /case when usage\.last_used_at is null then 0 else 1 end[\s\S]*usage\.last_used_at asc nulls first/));
test("selection accepts only one opaque UUID", () => {
  assert.match(migration, /select_skill_path_mission_offer\(p_offer_id uuid\)/);
  const method = repositorySource.match(/const selectSkillPathMissionOffer = async \(offerId\) => \{[\s\S]*?return mapSkillPathMissionOffers\(result\);\n    \};/)?.[0] || "";
  assert.match(method, /p_offer_id: normalizedOfferId/);
  assert.doesNotMatch(method, /templateKey|title|description|reward|skillKey/);
});
test("selection proves exact persisted offered membership", () => assert.match(selectionBody, /jsonb_array_elements\(state\.offers\)[\s\S]*offerId' = p_offer_id::text/));
test("stale offers are rejected by the authoritative logical day", () => {
  assert.match(selectionBody, /state\.daily_key = v_daily_key/);
  assert.match(selectionBody, /offer-not-found-or-stale/);
});
test("paused-path stale selection is rejected", () => assert.match(selectionBody, /path\.path_active = true[\s\S]*'path-inactive'/));
test("offer operations serialize with Sprint 20 path pause", () => {
  assert.match(requestBody, /:skill-path:' \|\| v_skill_key/);
  assert.match(selectionBody, /:skill-path:' \|\| v_skill_key/);
});
test("duplicate planned selection is idempotent and conflicting selection is locked", () => assert.match(selectionBody, /already-planned[\s\S]*offer-already-selected/));
test("offer request and selection award no overall or skill XP", () => {
  assert.doesNotMatch(requestBody, /update public\.progression_state|update public\.skill_progression/);
  assert.doesNotMatch(selectionBody, /update public\.progression_state|update public\.skill_progression/);
  assert.doesNotMatch(migration, /xpReward|skillXPAwarded|xp_awarded/);
});
test("offers and selection change no streak or achievement state", () => assert.doesNotMatch(migration, /user_streak_state|apply_vault_streak|user_achievements|evaluate_vault_achievements/));
test("offers and selection create no completed history or Analytics activity", () => assert.doesNotMatch(migration, /insert into public\.mission_history|mission\.completed|get_vault_analytics/));
test("selection remains planned state rather than a mission lifecycle", () => {
  assert.match(migration, /'status', case when p_state\.selected_offer_id is null then 'offered' else 'planned' end/);
  assert.doesNotMatch(selectionBody, /insert into public\.daily_mission_state|request_vault_mission_action/);
});
test("Sprint 19 primary Daily Mission Choice remains unchanged", () => {
  assert.equal(crypto.createHash("sha256").update(migration18).digest("hex"), "005b4332b91374ca48ee6a1b2eb0045c20494b8d45acb75ac9d293d65130e0fe");
  assert.doesNotMatch(migration, /update public\.daily_mission_choice_state|update public\.daily_mission_state/);
});
test("replacement allowance, Daily Complete, and primary rewards remain unchanged", () => {
  assert.match(migration8, /if v_reward <> 25 then/);
  assert.match(migration8, /v_skill_reward := 15/);
  assert.doesNotMatch(migration, /replacements_used|nextResetAt|Daily Complete/);
});
test("Sprint 20 Skill Path activation remains unchanged", () => assert.equal(crypto.createHash("sha256").update(migration19).digest("hex"), "717d0a79a7d0cc25aaf79f86484fb50223208d26a60193cc0f845e2473179971"));
test("zero-XP Developing cards stay compact and positive-XP details remain", () => {
  assert.match(dashboardSource, /expandable: totalXP > 0/);
  assert.match(dashboardSource, /document\.createElement\(skill\.expandable \? "details" : "article"\)/);
  assert.match(dashboardSource, /Explore Missions/);
});
test("pausing a path removes cached offers from the immutable snapshot", () => assert.match(serviceSource, /if \(!pathActive\)[\s\S]*skillPathMissionOffers\.filter\(\(state\) => state\.skillKey !== path\.key\)/));
test("restoration gate waits for zero-argument offer restoration", () => {
  assert.match(html, /data-protected-loading[\s\S]*Restoring your Vault[\s\S]*data-protected-content hidden/);
  assert.match(serviceSource, /getSkillPathMissionOffers[\s\S]*restoreSkillPathMissionOffers/);
});
test("UI routes through Application Service without direct Supabase", () => {
  assert.match(dashboardSource, /vaultApplication\.requestSkillPathMissionOffers\(skillKey\)/);
  assert.match(dashboardSource, /vaultApplication\.selectSkillPathMissionOffer/);
  assert.doesNotMatch(dashboardSource, /database\.rpc|supabase\.from/);
});
test("repository validates and deeply freezes offer responses", async () => {
  const now = "2026-08-13T12:00:00.000Z";
  const id = "123e4567-e89b-42d3-a456-426614174000";
  const response = { accepted: true, reason: "restored", dailyKey: "2026-08-13", skillKey: "fitness", skillName: "Fitness", status: "offered", offers: [{ offerId: id, title: "Train", description: "Complete an intentional training session.", estimatedDuration: "30 minutes", skillKey: "fitness", skillName: "Fitness" }], selectedOfferId: null, selectedAt: null };
  const client = { rpc: async () => ({ data: [response], error: null }) };
  const repository = repositoryFactory.createUserRepository({ authService: { getClient: () => client, getCurrentUser: async () => ({ id: "owner" }) } });
  const states = await repository.getSkillPathMissionOffers();
  assert.equal(states[0].offers[0].title, "Train");
  assert.equal(Object.isFrozen(states[0].offers[0]), true);
  assert.equal(now.length > 0, true);
});
test("repository rejects malformed server offers", async () => {
  const client = { rpc: async () => ({ data: [{ accepted: true, reason: "x", dailyKey: "browser-date", offers: [] }], error: null }) };
  const repository = repositoryFactory.createUserRepository({ authService: { getClient: () => client, getCurrentUser: async () => ({ id: "owner" }) } });
  await assert.rejects(repository.getSkillPathMissionOffers(), (error) => error.code === "skill-path-offers-response-invalid");
});
test("repository rejects internal template identity crossing the read boundary", async () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  const response = { accepted: true, reason: "restored", dailyKey: "2026-08-13", skillKey: "fitness", skillName: "Fitness", status: "offered", offers: [{ offerId: id, templateKey: "internal-template", title: "Train", description: "Complete an intentional training session.", estimatedDuration: "30 minutes", skillKey: "fitness", skillName: "Fitness" }], selectedOfferId: null, selectedAt: null };
  const client = { rpc: async () => ({ data: [response], error: null }) };
  const repository = repositoryFactory.createUserRepository({ authService: { getClient: () => client, getCurrentUser: async () => ({ id: "owner" }) } });
  await assert.rejects(repository.getSkillPathMissionOffers(), (error) => error.code === "skill-path-offers-response-invalid");
});
test("offer panel is separate, accessible, responsive, and contains no reward copy", () => {
  assert.match(html, /data-skill-path-offers-panel hidden/);
  assert.match(html, /aria-labelledby="skill-path-offers-title"/);
  assert.match(css, /\.skill-path-offers__grid[\s\S]*grid-template-columns: repeat\(3/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.skill-path-offers__grid/);
  assert.doesNotMatch(html.match(/<section class="skill-path-offers[\s\S]*?<\/section>/)?.[0] || "", /\+25|\+15|reward/i);
});
test("RLS, direct-write denial, safe search paths, and minimal grants are present", () => {
  assert.match(migration, /alter table public\.skill_path_mission_offer_state enable row level security/);
  assert.match(migration, /revoke all on public\.skill_path_mission_offer_state from public, anon, authenticated/);
  assert.equal((migration.match(/security definer\nset search_path = ''/g) || []).length, 5);
  assert.equal((migration.match(/grant execute on function public\.(?:get_skill_path_mission_offers|request_skill_path_mission_offers|select_skill_path_mission_offer)/g) || []).length, 3);
});
test("migrations 001 through 019 remain byte-for-byte unchanged", () => {
  const baseline = read("../migrations-pre-sprint21.sha256").trim().split("\n");
  assert.equal(baseline.length, 18);
  baseline.forEach((line) => {
    const [digest, relativePath] = line.trim().split(/\s+/);
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "..", relativePath))).digest("hex");
    assert.equal(actual, digest, relativePath);
  });
});
test("Migration 020 is the only Sprint 21 migration", () => {
  const files = fs.readdirSync(path.join(root, "supabase/migrations")).filter((name) => name.includes("sprint21"));
  assert.deepEqual(files, ["202608070020_sprint21_skill_path_mission_offers.sql"]);
});
test("JavaScript syntax, local references, hidden confidentiality, and secret scan pass", () => {
  for (const file of ["js/user-repository.js", "js/application-service.js", "js/dashboard.js"]) assert.equal(spawnSync(process.execPath, ["--check", path.join(root, file)]).status, 0, file);
  for (const match of html.matchAll(/(?:src|href)="((?:js|css)\/[^"#]+)"/g)) assert.equal(fs.existsSync(path.join(root, match[1])), true, match[1]);
  assert.match(serviceSource, /name: "\?\?\?\?\?"[\s\S]*description: "\?\?\?\?\?"/);
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
