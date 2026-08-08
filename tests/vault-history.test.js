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
const migration = read("supabase/migrations/202608070013_sprint12_vault_history.sql");
const repositorySource = read("js/user-repository.js");
const applicationSource = read("js/application-service.js");
const dashboardSource = read("js/dashboard.js");
const dashboardHTML = read("dashboard.html");

const rpc = migration.match(
  /create or replace function public\.get_vault_history\(\)[\s\S]*?\$\$;/i,
)?.[0] || "";

const entries = Object.freeze([
  Object.freeze({
    historyId: "history-a", missionId: "mission-a", title: "Build a Login Form",
    category: "Programming", primarySkillKey: "front_end_engineering",
    primarySkill: "Front-End Engineering", overallXPEarned: 25, skillXPEarned: 15,
    status: "completed", completedAt: "2026-08-07T18:00:00.000Z",
    description: "Build and validate a secure login form.", originalMissionState: "active",
    achievements: Object.freeze([Object.freeze({
      key: "FIRST_MISSION", name: "First Mission", description: "Complete your first mission.",
      icon: "◆", unlockedAt: "2026-08-07T18:00:00.000Z",
    })]),
  }),
  Object.freeze({
    historyId: "history-b", missionId: "mission-b", title: "Review Product Goals",
    category: "Business", primarySkillKey: "business", primarySkill: "Business",
    overallXPEarned: 25, skillXPEarned: 15, status: "completed",
    completedAt: "2026-08-06T18:00:00.000Z", description: "Review this week's product goals.",
    originalMissionState: "ready", achievements: Object.freeze([]),
  }),
  Object.freeze({
    historyId: "history-c", missionId: "mission-c", title: "Read Architecture Notes",
    category: "Learning", primarySkillKey: "learning", primarySkill: "Learning",
    overallXPEarned: 25, skillXPEarned: 15, status: "completed",
    completedAt: "2026-08-03T18:00:00.000Z", description: "Read one architecture chapter.",
    originalMissionState: "active", achievements: Object.freeze([]),
  }),
]);

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("mission_history is extended rather than duplicated", () => {
  assert.match(migration, /alter table public\.mission_history[\s\S]*add column mission_description text[\s\S]*add column original_state text/i);
  assert.doesNotMatch(migration, /create table public\.(?:vault_history|history_archive)/i);
  assert.match(migration, /existing \(user_id, terminal_at desc\) index from migration 001/i);
});

test("archive details are captured from authoritative mission state", () => {
  const trigger = migration.match(/create or replace function public\.capture_vault_history_details\(\)[\s\S]*?\$\$;/i)?.[0] || "";
  assert.match(trigger, /from public\.daily_mission_state/i);
  assert.match(trigger, /state\.user_id = new\.user_id/i);
  assert.match(trigger, /state\.mission_definition ->> 'id' = new\.mission_id/i);
  assert.match(trigger, /mission_definition ->> 'description'/i);
  assert.match(trigger, /state\.lifecycle_state/i);
  assert.match(migration, /before insert on public\.mission_history/i);
});

test("restoration RPC is exact zero-argument, owner-derived, and completed-only", () => {
  assert.match(rpc, /get_vault_history\(\)/i);
  assert.match(rpc, /v_user_id uuid := auth\.uid\(\)/i);
  assert.match(rpc, /where history\.user_id = v_user_id/i);
  assert.match(rpc, /history\.final_state = 'completed'/i);
  assert.doesNotMatch(rpc, /p_user_id|p_owner|p_account/i);
});

test("RPC returns newest-first history with deterministic tie-breaking", () => {
  assert.match(rpc, /order by history\.terminal_at desc, history\.id desc/i);
  assert.match(migration, /returns table[\s\S]*"completedAt" timestamptz/i);
  assert.match(rpc, /left join public\.skill_catalog/i);
  assert.match(rpc, /earned\.unlocked_at = history\.terminal_at/i);
});

test("repository paginates the zero-argument RPC and freezes normalized rows", async () => {
  const calls = [];
  const client = {
    rpc: (name, args) => {
      calls.push({ name, args });
      return {
        range: (from, to) => {
          calls.push({ from, to });
          return Promise.resolve({ data: entries, error: null });
        },
      };
    },
  };
  const repository = repositoryFactory.createUserRepository({
    authService: { getCurrentUser: async () => ({ id: "account-a" }), getClient: () => client },
  });
  const page = await repository.getVaultHistory({ offset: 0, pageSize: 2 });
  assert.deepEqual(calls[0], { name: "get_vault_history", args: undefined });
  assert.deepEqual(calls[1], { from: 0, to: 2 });
  assert.equal(page.entries.length, 2);
  assert.equal(page.hasMore, true);
  assert.equal(page.nextOffset, 2);
  assert.equal(Object.isFrozen(page), true);
  assert.equal(Object.isFrozen(page.entries[0].achievements), true);
});

test("application restores immutable history and supports bounded additional pages", () => {
  assert.match(applicationSource, /history: Object\.freeze\(\[\.\.\.vaultHistory\]\)/i);
  assert.match(applicationSource, /status === "completed"[\s\S]*vaultHistory = \[frozen, \.\.\.vaultHistory\]/i);
  assert.match(applicationSource, /historyPagination: Object\.freeze/i);
  assert.match(applicationSource, /repository\.getVaultHistory\(\)/i);
  assert.match(applicationSource, /loadMoreVaultHistory[\s\S]*offset: historyNextOffset[\s\S]*pageSize: historyPageSize/i);
  assert.match(applicationSource, /known = new Set[\s\S]*historyId/i);
});

test("grouping produces Today, Yesterday, and earlier buckets without duplicating rows", () => {
  const view = dashboard.vaultHistory.createViewModel(entries, {}, new Date("2026-08-07T20:00:00.000Z"));
  assert.deepEqual(view.groups.map((group) => group.label), ["Today", "Yesterday", "Earlier This Week"]);
  assert.equal(view.groups.reduce((count, group) => count + group.entries.length, 0), entries.length);
  assert.equal(Object.isFrozen(view.groups), true);
});

test("search matches title, category, and skill", () => {
  assert.equal(dashboard.vaultHistory.createViewModel(entries, { search: "login" }).entries.length, 1);
  assert.equal(dashboard.vaultHistory.createViewModel(entries, { search: "business" }).entries.length, 1);
  assert.equal(dashboard.vaultHistory.createViewModel(entries, { search: "front-end" }).entries.length, 1);
});

test("achievement, skill, category, newest, and oldest filters are presentation-only", () => {
  assert.equal(dashboard.vaultHistory.createViewModel(entries, { achievements: "earned" }).entries.length, 1);
  assert.equal(dashboard.vaultHistory.createViewModel(entries, { skill: "business" }).entries.length, 1);
  assert.equal(dashboard.vaultHistory.createViewModel(entries, { category: "Learning" }).entries.length, 1);
  assert.equal(dashboard.vaultHistory.createViewModel(entries, { sort: "oldest" }).entries[0].missionId, "mission-c");
  assert.equal(dashboard.vaultHistory.createViewModel(entries, { sort: "newest" }).entries[0].missionId, "mission-a");
  assert.doesNotMatch(dashboardSource, /update\s+mission_history|insert\s+into\s+mission_history/i);
});

test("Vault page renders only authoritative rows with accessible expansion", () => {
  assert.match(dashboardHTML, /href="#vault" data-view-link="vault"/i);
  assert.match(dashboardHTML, /data-vault-history/i);
  assert.match(dashboardSource, /summary\.setAttribute\("aria-expanded", "false"\)/i);
  assert.match(dashboardSource, /summary\.setAttribute\("aria-controls", detailId\)/i);
  assert.match(dashboardSource, /details\.hidden = expanded/i);
  assert.match(dashboardSource, /entry\.description/i);
  assert.match(dashboardSource, /entry\.achievements/i);
});

test("refresh and logout-login restoration reuse the same server archive contract", () => {
  assert.match(applicationSource, /const initialize = async \(\) =>[\s\S]*repository\.getVaultHistory\(\)/i);
  assert.match(dashboardSource, /vaultApplication\.signOut\(\)/i);
  assert.doesNotMatch(repositorySource, /localStorage|sessionStorage/i);
});

test("RLS, grants, read-only browser access, and cross-user isolation remain explicit", () => {
  assert.match(migration, /alter table public\.mission_history enable row level security/i);
  assert.match(migration, /revoke insert, update, delete on public\.mission_history from authenticated/i);
  assert.match(migration, /revoke all on function public\.get_vault_history\(\) from public, anon/i);
  assert.match(migration, /grant execute on function public\.get_vault_history\(\) to authenticated/i);
  assert.match(rpc, /history\.user_id = v_user_id/i);
  assert.doesNotMatch(repositorySource, /getVaultHistory\s*=.*userId|p_user_id/i);
});

test("installed migrations 001-009, 011, and 012 remain byte-for-byte unchanged", () => {
  const expected = Object.fromEntries(read("../migrations-pre-sprint12.sha256").trim().split("\n").map((line) => {
    const [digest, file] = line.trim().split(/\s+/, 2);
    return [file.replace(/^app\//, ""), digest];
  }));
  Object.entries(expected).forEach(([file, digest]) => assert.equal(hash(file), digest, file));
});

test("Vault history introduces no credentials or frontend authority", () => {
  const boundary = [repositorySource, applicationSource, dashboardSource].join("\n");
  const historyMethod = repositorySource.match(/const getVaultHistory = async[\s\S]*?\n    };/i)?.[0] || "";
  assert.doesNotMatch(boundary, /service_role|postgres(?:ql)?:\/\//i);
  assert.doesNotMatch(historyMethod, /\.insert\(|\.update\(|\.upsert\(|\.delete\(|request_vault_mission_action/i);
  assert.match(repositorySource, /database\.rpc\("get_vault_history"\)/i);
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failures += 1; console.error(`✗ ${name}`); console.error(error); }
  }
  if (failures) process.exitCode = 1;
})();
