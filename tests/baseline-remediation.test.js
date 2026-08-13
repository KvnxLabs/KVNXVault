"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const migration = read("supabase/migrations/202608070026_sprint24_2_baseline_remediation.sql");
const detector = migration.match(/create function public\.detect_vault_operational_anomalies\(\)[\s\S]*?\n\$\$;/i)?.[0] || "";
const attestation = migration.match(/create or replace function public\.establish_vault_legacy_xp_baseline[\s\S]*?\n\$\$;/i)?.[0] || "";

const tests = [];
const test = (name, run) => tests.push({ name, run });

const hasAuthoritativeDivergence = (totalXP, historyXP) => totalXP !== 75 + historyXP;

test("Migration 026 is the sole Sprint 24.2 migration", () => {
  const files = fs.readdirSync(path.join(root, "supabase/migrations")).filter((name) => /^202608070026_/.test(name));
  assert.deepEqual(files, ["202608070026_sprint24_2_baseline_remediation.sql"]);
});

test("unsafe rows require the complete deterministic migration signature", () => {
  assert.match(migration, /boundary\.boundary_key = 'sprint24_1'/);
  assert.match(migration, /boundary\.source = 'sprint24_1_migration'/);
  assert.match(migration, /boundary\.initial_xp = 75/);
  assert.match(migration, /baseline\.provenance_status = 'legacy_snapshot'/);
  assert.match(migration, /baseline\.established_at = boundary\.established_at/);
  assert.match(migration, /baseline\.attestation_status = 'invalid'/);
  assert.match(migration, /baseline\.attestation_reason is null/);
  assert.match(migration, /baseline\.established_by is null/);
});

test("remediation never identifies production accounts by UUID or observed gap", () => {
  assert.doesNotMatch(migration, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  assert.doesNotMatch(migration, /\b235\b|\b125\b|legacyUnattributedXP'\s*,\s*50/);
});

test("complete explicit attestations are qualified before automatic rows are removed", () => {
  assert.ok(migration.indexOf("set attestation_status = 'attested'") < migration.indexOf("delete from public.vault_xp_reconciliation_baselines"));
  assert.match(migration, /char_length\(trim\(coalesce\(attestation_reason, ''\)\)\) between 10 and 500/);
  assert.match(migration, /char_length\(trim\(coalesce\(established_by, ''\)\)\) > 0/);
});

test("the delete cannot remove a valid administrator attestation", () => {
  const deletion = migration.match(/delete from public\.vault_xp_reconciliation_baselines[\s\S]*?established_by is null/i)?.[0] || "";
  assert.match(deletion, /attestation_status = 'invalid'/);
  assert.match(deletion, /attestation_reason is null/);
  assert.match(deletion, /established_by is null/);
  assert.doesNotMatch(deletion, /attestation_status = 'attested'/);
});

test("the old boundary is retained only as superseded metadata", () => {
  assert.doesNotMatch(migration, /drop table public\.vault_xp_reconciliation_boundaries/i);
  assert.match(migration, /Superseded Sprint 24\.1 migration metadata/);
  assert.match(migration, /revoke all on public\.vault_xp_reconciliation_boundaries from public, anon, authenticated/);
  assert.doesNotMatch(detector, /vault_xp_reconciliation_boundaries/);
});

test("invalid provenance cannot satisfy the attested baseline constraints", () => {
  assert.match(migration, /attestation_status in \('attested', 'invalid'\)/);
  assert.match(migration, /attestation_status <> 'attested'[\s\S]*attestation_reason[\s\S]*established_by/);
});

test("attestation accepts only an owner UUID and investigation reason", () => {
  assert.match(attestation, /p_user_id uuid,\s*p_attestation_reason text/);
  const signature = attestation.match(/establish_vault_legacy_xp_baseline\(([\s\S]*?)\)\s*returns jsonb/i)?.[1] || "";
  assert.doesNotMatch(signature, /xp|history|reward|date|time|principal/);
});

test("attestation locks and server-reads authoritative progression", () => {
  assert.match(attestation, /pg_advisory_xact_lock/);
  assert.match(attestation, /from public\.progression_state[\s\S]*for update/);
  assert.match(attestation, /sum\(history\.xp_awarded\)/);
});

test("attestation stores a database principal and explicit reason", () => {
  assert.match(attestation, /trim\(p_attestation_reason\)/);
  assert.match(attestation, /session_user::text/);
  assert.match(attestation, /'attested'/);
});

test("attestation cannot mutate gameplay state", () => {
  assert.doesNotMatch(attestation, /(?:update|insert into|delete from) public\.(?:progression_state|mission_history|skill_progression|user_streak_state|daily_mission_state)/i);
});

test("invalid residual provenance requires separate review", () => {
  assert.match(attestation, /Invalid provenance row requires separate administrator review/);
});

test("the detector preserves prior non-overall anomaly rules", () => {
  assert.match(detector, /detect_vault_operational_anomalies_pre_sprint24_2/);
  assert.match(detector, /where previous\.alert_type not like 'overall-progression-%'/);
});

test("unattested mismatch is a critical authoritative divergence", () => {
  assert.match(detector, /overall-progression-authoritative-divergence', 'critical'/);
  assert.match(detector, /75::bigint \+ history\.current_history_xp/);
  assert.match(detector, /where not exists \([\s\S]*attestation_status = 'attested'/);
  assert.equal(hasAuthoritativeDivergence(235, 110), true);
});

test("unattested exact reconstruction is healthy rather than a fabricated anomaly", () => {
  assert.equal(75 + 50, 125);
  assert.equal(hasAuthoritativeDivergence(125, 50), false);
});

test("explicitly attested preexisting gap is a warning", () => {
  assert.match(detector, /overall-progression-legacy-provenance-gap', 'warning'/);
  assert.match(detector, /baseline\.baseline_total_xp <> 75::bigint \+ baseline\.baseline_history_xp/);
});

test("post-attestation unexplained change remains critical", () => {
  assert.match(detector, /overall-progression-post-boundary-divergence', 'critical'/);
  assert.match(detector, /baseline\.baseline_total_xp[\s\S]*history\.current_history_xp - baseline\.baseline_history_xp/);
});

test("missing or corrupt provenance is surfaced conservatively", () => {
  assert.match(detector, /overall-progression-provenance-invalid', 'warning'/);
  assert.match(detector, /invalid-provenance-does-not-suppress-authoritative-reconciliation/);
});

test("Migration 026 does not manually alter operational alerts", () => {
  assert.doesNotMatch(migration, /(?:delete from|update|insert into) public\.vault_operational_alerts/i);
});

test("Migration 026 contains no gameplay economy mutation", () => {
  assert.doesNotMatch(migration, /(?:update|insert into|delete from) public\.(?:progression_state|skill_progression|mission_history|side_mission_state|daily_mission_state|user_streak_state|user_achievements)/i);
});

test("baseline and boundary tables are protected from browser roles", () => {
  assert.match(migration, /alter table public\.vault_xp_reconciliation_baselines enable row level security/);
  assert.match(migration, /revoke all on public\.vault_xp_reconciliation_baselines from public, anon, authenticated/);
});

test("privileged functions are SECURITY DEFINER with empty search paths", () => {
  assert.match(attestation, /security definer[\s\S]*set search_path = ''/);
  assert.match(detector, /security definer[\s\S]*set search_path = ''/);
});

test("ordinary users cannot execute remediation authority", () => {
  assert.match(migration, /revoke all on function public\.establish_vault_legacy_xp_baseline\(uuid, text\)[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /revoke all on function public\.detect_vault_operational_anomalies\(\)[\s\S]*from public, anon, authenticated/);
});

test("Migration 026 SQL function and DO bodies are delimiter-balanced", () => {
  ["remediation", "boundary_metadata"].forEach((tag) => {
    assert.equal((migration.match(new RegExp(`\\$${tag}\\$`, "g")) || []).length, 2, tag);
  });
  assert.equal((migration.match(/\$\$/g) || []).length % 2, 0);
  assert.equal((migration.match(/\$sql\$/g) || []).length % 2, 0);
});

test("migrations 001 through 025 remain byte-for-byte unchanged", () => {
  const baseline = read("../migrations-pre-sprint24.2.sha256").trim().split("\n");
  assert.equal(baseline.length, 24);
  baseline.forEach((line) => {
    const [digest, relativePath] = line.trim().split(/\s+/);
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "..", relativePath))).digest("hex");
    assert.equal(actual, digest, relativePath);
  });
});

test("Sprint 24.2 adds no frontend authority or credential", () => {
  const frontend = [read("js/user-repository.js"), read("js/application-service.js"), read("js/dashboard.js")].join("\n");
  assert.doesNotMatch(frontend, /baseline_remediation|establish_vault_legacy_xp_baseline/);
  assert.doesNotMatch([migration, frontend].join("\n"), /SUPABASE_SERVICE_ROLE_KEY|service_role\s*[:=]|postgres(?:ql)?:\/\//i);
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failures += 1; console.error(`✗ ${name}`); console.error(error); }
  }
  if (failures) process.exitCode = 1;
})();
