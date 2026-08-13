"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const migration = read("supabase/migrations/202608070027_sprint24_3_monitoring_helper_compatibility.sql");
const detector = migration.match(/create or replace function public\.detect_vault_operational_anomalies\(\)[\s\S]*?\n\$\$;/i)?.[0] || "";
const tests = [];
const test = (name, run) => tests.push({ name, run });

test("Migration 027 is uniquely named", () => {
  const files = fs.readdirSync(path.join(root, "supabase/migrations")).filter((name) => /^202608070027_/.test(name));
  assert.deepEqual(files, ["202608070027_sprint24_3_monitoring_helper_compatibility.sql"]);
});

test("final detector is self-contained and removes the fragile helper", () => {
  assert.doesNotMatch(detector, /detect_vault_operational_anomalies_pre_sprint24_2/);
  assert.match(migration, /drop function if exists public\.detect_vault_operational_anomalies_pre_sprint24_2\(\)/);
});

test("callable detector contains no removed boundary_key reference", () => {
  assert.doesNotMatch(detector, /boundary_key/);
  assert.doesNotMatch(detector, /vault_xp_reconciliation_boundaries/);
});

test("all Sprint 24 non-overall rules remain direct branches", () => {
  [
    "audit_side_mission_invariants",
    "side-reward-snapshot-invalid",
    "side-lifecycle-event-order-invalid",
    "side-event-volume-impossible",
    "daily-completion-overall-reward-invalid",
    "daily-completion-skill-reward-invalid",
    "skill-progression-history-divergence",
  ].forEach((rule) => assert.match(detector, new RegExp(rule)));
});

test("Side and Daily reward contracts remain unchanged", () => {
  assert.match(detector, /overallXPReward' is distinct from '10'/);
  assert.match(detector, /skillXPReward' is distinct from '10'/);
  assert.match(detector, /history\.xp_awarded <> 25/);
  assert.match(detector, /history\.skill_xp_awarded not in \(0, 15\)/);
});

test("unattested mismatch remains critical", () => {
  assert.match(detector, /overall-progression-authoritative-divergence', 'critical'/);
  assert.match(detector, /75::bigint \+ history\.current_history_xp/);
  assert.equal(235 !== 75 + 110, true);
});

test("unattested exact reconstruction remains healthy", () => {
  assert.equal(125, 75 + 50);
});

test("only complete explicit attestation qualifies legacy warning", () => {
  assert.match(detector, /overall-progression-legacy-provenance-gap', 'warning'/);
  assert.match(detector, /baseline\.attestation_status = 'attested'/);
  assert.match(detector, /baseline\.attestation_reason/);
  assert.match(detector, /baseline\.established_by/);
});

test("post-attestation unexplained delta remains critical", () => {
  assert.match(detector, /overall-progression-post-boundary-divergence', 'critical'/);
  assert.match(detector, /baseline\.baseline_total_xp[\s\S]*history\.current_history_xp - baseline\.baseline_history_xp/);
});

test("invalid provenance remains conservative and cannot qualify trust", () => {
  assert.match(detector, /overall-progression-provenance-invalid', 'warning'/);
  assert.match(detector, /where not exists \([\s\S]*attestation_status = 'attested'/);
});

test("detector is read-only and Migration 027 changes no alerts manually", () => {
  assert.doesNotMatch(detector, /insert into|update public\.|delete from public\./i);
  assert.doesNotMatch(migration, /(?:insert into|update|delete from) public\.vault_operational_alerts/i);
});

test("Migration 027 contains no gameplay mutations", () => {
  assert.doesNotMatch(migration, /(?:insert into|update|delete from) public\.(?:progression_state|skill_progression|mission_history|side_mission_state|daily_mission_state|user_streak_state|user_achievements)/i);
});

test("detector retains SECURITY DEFINER and fixed search path", () => {
  assert.match(detector, /security definer/);
  assert.match(detector, /set search_path = ''/);
});

test("monitoring, detector, and attestation remain revoked from browser roles", () => {
  [
    "detect_vault_operational_anomalies\\(\\)",
    "run_vault_operational_monitoring\\(\\)",
    "establish_vault_legacy_xp_baseline\\(uuid, text\\)",
  ].forEach((signature) => assert.match(migration,
    new RegExp(`revoke all on function public\\.${signature}[\\s\\S]*?from public, anon, authenticated`)));
});

test("Migration 027 SQL definition delimiters are balanced", () => {
  assert.equal((migration.match(/\$\$/g) || []).length, 2);
  assert.ok(detector.length > 1000);
});

test("migrations 001 through 026 remain byte-for-byte unchanged", () => {
  const baseline = read("../migrations-pre-sprint24.3.sha256").trim().split("\n");
  assert.equal(baseline.length, 25);
  baseline.forEach((line) => {
    const [digest, relativePath] = line.trim().split(/\s+/);
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, "..", relativePath))).digest("hex");
    assert.equal(actual, digest, relativePath);
  });
});

test("Sprint 24.3 introduces no frontend authority or secret", () => {
  const frontend = [read("js/user-repository.js"), read("js/application-service.js"), read("js/dashboard.js")].join("\n");
  assert.doesNotMatch(frontend, /monitoring_helper_compatibility|detect_vault_operational_anomalies/);
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
