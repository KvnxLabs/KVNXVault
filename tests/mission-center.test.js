"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const dashboard = require("../js/dashboard.js");
const repositoryFactory = require("../js/user-repository.js");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const html = read("dashboard.html");
const dashboardSource = read("js/dashboard.js");
const serviceSource = read("js/application-service.js");
const repositorySource = read("js/user-repository.js");
const css = read("css/dashboard.css");
const migration8 = read("supabase/migrations/202608070008_sprint10_skill_progression.sql");
const migration12 = read("supabase/migrations/202608070012_sprint11_1_developer_test_panel.sql");
const migration15 = read("supabase/migrations/202608070015_sprint14_authoritative_streaks.sql");
const migration16 = read("supabase/migrations/202608070016_sprint15_mission_catalog.sql");

const history = Array.from({ length: 7 }, (_, index) => Object.freeze({
  historyId: `history-${index}`,
  missionId: `mission-${index}`,
  title: `Verified Mission ${index + 1}`,
  category: "Programming",
  primarySkillKey: "front_end_engineering",
  primarySkill: "Front-End Engineering",
  overallXPEarned: 25,
  skillXPEarned: 15,
  status: "completed",
  completedAt: `2026-08-${String(12 - index).padStart(2, "0")}T14:00:00.000Z`,
  achievements: Object.freeze([]),
}));

const snapshotFor = (state = "ready", overrides = {}) => {
  const terminal = ["completed", "skipped", "expired"].includes(state);
  const replacementsRemaining = overrides.replacementsRemaining ?? 1;
  return Object.freeze({
    progression: Object.freeze({ currentXP: 325 }),
    skills: Object.freeze([]),
    skillCatalog: Object.freeze([
      Object.freeze({ key: "front_end_engineering", name: "Front-End Engineering", sortOrder: 10 }),
    ]),
    streak: Object.freeze({ currentStreak: 3, longestStreak: 7, lastCompletedDailyKey: "2026-08-12" }),
    history: Object.freeze(history),
    nextResetAt: "2026-08-13T04:00:00.000Z",
    coordinator: Object.freeze({
      currentMission: Object.freeze({
        definition: Object.freeze({
          id: "server-mission-uuid",
          title: "Refine One Weak Point",
          description: "Review a recent implementation and improve one weak point.",
          estimatedDuration: "30 minutes",
          difficulty: "Balanced",
          xpReward: 25,
          primarySkill: "front_end_engineering",
        }),
        lifecycle: Object.freeze({
          state,
          canStart: state === "ready",
          canComplete: state === "ready" || state === "active",
          canSkip: state === "ready" || state === "active",
          isTerminal: terminal,
        }),
      }),
      dailyStatus: Object.freeze({
        replacementsRemaining,
        replacementsUsed: replacementsRemaining > 0 ? 0 : 1,
        canRequestReplacement: terminal && replacementsRemaining > 0,
      }),
    }),
    ...overrides.snapshot,
  });
};

const tests = [];
const test = (name, run) => tests.push({ name, run });

test("Missions navigation opens the in-shell hash route", () => {
  assert.match(html, /href="#missions"\s+data-view-link="missions"/);
  assert.match(dashboardSource, /window\.location\.hash === "#missions"/);
});

test("Mission Center renders only the authoritative current definition", () => {
  const view = dashboard.missionCenter.createViewModel(snapshotFor());
  assert.equal(view.title, "Refine One Weak Point");
  assert.equal(view.id, "server-mission-uuid");
});

test("title, description, duration, difficulty, and reward survive projection", () => {
  const view = dashboard.missionCenter.createViewModel(snapshotFor());
  assert.equal(view.description, "Review a recent implementation and improve one weak point.");
  assert.equal(view.duration, "30 minutes");
  assert.equal(view.difficulty, "Balanced");
  assert.equal(view.xpReward, 25);
});

test("canonical mapped skill resolves through the server-managed skill catalog", () => {
  const view = dashboard.missionCenter.createViewModel(snapshotFor());
  assert.equal(view.skillKey, "front_end_engineering");
  assert.equal(view.skillName, "Front-End Engineering");
  assert.match(repositorySource, /from\("skill_catalog"\)[\s\S]*\.eq\("active", true\)/);
});

for (const [state, label] of Object.entries({
  ready: "Ready", active: "Active", completed: "Completed", skipped: "Skipped", expired: "Expired",
})) {
  test(`authoritative lifecycle ${state.toUpperCase()} renders explicitly`, () => {
    const view = dashboard.missionCenter.createViewModel(snapshotFor(state));
    assert.equal(view.state, state);
    assert.equal(view.stateLabel, label);
  });
}

test("Start delegates to the existing Application Service action", () => {
  assert.match(dashboardSource, /missionCenterStart\?\.addEventListener\("click", \(\) => startMissionButton\?\.click\(\)\)/);
  assert.match(dashboardSource, /vaultApplication\.start\(\)/);
});

test("Complete delegates to the existing Application Service action", () => {
  assert.match(dashboardSource, /missionCenterComplete\?\.addEventListener\("click", completeFirstMission\)/);
  assert.match(dashboardSource, /vaultApplication\.complete\(\)/);
});

test("Skip delegates to the existing Application Service action", () => {
  assert.match(dashboardSource, /missionCenterSkip\?\.addEventListener\("click", \(\) => skipMissionButton\?\.click\(\)\)/);
  assert.match(dashboardSource, /vaultApplication\.skip\(\)/);
});

test("Replacement delegates to the existing authoritative replacement path", () => {
  assert.match(dashboardSource, /request: \(\) => vaultApplication\.requestReplacement\(\)/);
  assert.match(dashboardSource, /missionCenterRequest\?\.addEventListener\("click", runReplacement\)/);
});

test("the one-replacement database limit is unchanged", () => {
  assert.match(migration12, /if v_state\.replacements_used >= 1 then/i);
  assert.doesNotMatch(dashboardSource, /replacementsRemaining\s*[+]=|replacementsUsed\s*[+]=/);
});

test("Daily Complete requires authoritative completed plus no replacement", () => {
  assert.equal(dashboard.missionCenter.createViewModel(snapshotFor("completed", { replacementsRemaining: 0 })).dailyComplete, true);
  assert.equal(dashboard.missionCenter.createViewModel(snapshotFor("completed", { replacementsRemaining: 1 })).dailyComplete, false);
});

test("nextResetAt is passed to the existing display-only countdown", () => {
  const view = dashboard.missionCenter.createViewModel(snapshotFor());
  assert.equal(view.nextResetAt, "2026-08-13T04:00:00.000Z");
  assert.match(dashboardSource, /createCountdown\(\{\s*nextResetAt: viewModel\.nextResetAt/);
});

test("Recent Missions consumes authoritative application history", () => {
  const view = dashboard.missionCenter.createViewModel(snapshotFor());
  assert.equal(view.recentMissions[0].missionId, "mission-0");
  assert.equal(view.recentMissions[0].overallXPEarned, 25);
});

test("Recent Missions is bounded to five records", () => {
  assert.equal(dashboard.missionCenter.createViewModel(snapshotFor()).recentMissions.length, 5);
  assert.match(dashboardSource, /\.slice\(0, 5\)/);
});

test("View Full Vault and recent entries navigate to the existing Vault route", () => {
  assert.match(html, /View Full Vault[\s\S]*href="#vault"|href="#vault"[^>]*>View Full Vault/);
  assert.match(dashboardSource, /link\.href = "#vault"/);
});

test("navigation is presentation-only and cannot reroll a mission", () => {
  const navigation = dashboardSource.match(/const renderApplicationView = \(\) => \{[\s\S]*?\n  \};/)?.[0] || "";
  assert.doesNotMatch(navigation, /requestDailyMission|requestReplacement|requestMissionAction/);
});

test("refresh restoration uses the Application Service snapshot", () => {
  assert.match(dashboardSource, /applicationSnapshot = initialization\.snapshot/);
  assert.match(dashboardSource, /renderMissionCenter\(applicationSnapshot\)/);
});

test("logout and login restoration still use the authoritative daily RPC", () => {
  assert.match(serviceSource, /const dailyResult = await repository\.requestDailyMission\(\)/);
  assert.match(dashboardSource, /await vaultApplication\.signOut\(\)/);
});

for (const field of ["currentXP", "skillProgression", "streak", "newAchievements"]) {
  test(`opening Mission Center does not mutate ${field}`, () => {
    const navigation = dashboardSource.match(/const renderApplicationView = \(\) => \{[\s\S]*?\n  \};/)?.[0] || "";
    assert.doesNotMatch(navigation, new RegExp(`${field}\\s*=`));
  });
}

test("completion rewards remain exactly +25 overall and +15 mapped skill XP", () => {
  assert.match(migration16, /'xpReward', 25/);
  assert.match(migration12, /v_skill_reward := 15/);
});

test("same-day replacement completion remains one streak day", () => {
  assert.match(migration15, /if p_daily_key <= v_state\.last_completed_daily_key then[\s\S]*v_next_current := v_state\.current_streak/i);
});

test("server-returned achievement notifications remain on completion", () => {
  assert.match(dashboardSource, /showAchievementUnlocks\(applicationResult\.newAchievements\)/);
});

test("Mission Center does not expose the mission catalog", () => {
  assert.doesNotMatch(html, /templateKey|template_key|selection_weight|mission_catalog/);
});

test("frontend contains no mission selector or client randomizer", () => {
  assert.doesNotMatch([html, dashboardSource].join("\n"), /build_vault_daily_mission|select_vault_mission_template|Math\.random/);
});

test("dashboard rendering contains no direct Supabase table or RPC calls", () => {
  assert.doesNotMatch(dashboardSource, /supabase|\.from\(|\.rpc\(/i);
});

test("loading, error, and empty states never fabricate mission content", () => {
  assert.match(html, /data-mission-center-loading/);
  assert.match(html, /data-mission-center-error/);
  assert.match(html, /data-mission-center-empty/);
  assert.match(html, /No fallback mission has been created/);
});

test("Mission Center actions and statuses are accessible without color", () => {
  assert.match(html, /aria-label="Start today’s mission"/);
  assert.match(html, /aria-label="Complete today’s mission"/);
  assert.match(html, /aria-label="Skip today’s mission"/);
  assert.match(html, /data-mission-center-status[^>]*>Ready</);
  assert.match(html, /aria-live="off"/);
});

test("Mission Center stacks responsively and respects reduced motion", () => {
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.mission-center__details/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /min-width:\s*(?:7\d{2,}|[1-9]\d{3,})px/);
});

test("migrations 001 through 016 match the immutable Sprint 16 baseline", () => {
  const baseline = read("../migrations-pre-sprint16.sha256").trim().split("\n");
  assert.equal(baseline.length, 15);
  baseline.forEach((line) => {
    const [digest, relativePath] = line.trim().split(/\s+/);
    const actual = crypto.createHash("sha256")
      .update(fs.readFileSync(path.join(root, "..", relativePath)))
      .digest("hex");
    assert.equal(actual, digest, relativePath);
  });
});

test("historical migration baselines remain present and unchanged in meaning", () => {
  for (const name of ["migrations-pre-sprint12.sha256", "migrations-pre-sprint13.sha256", "migrations-pre-sprint14.sha256", "migrations-pre-sprint15.sha256"]) {
    assert.equal(fs.existsSync(path.join(root, "..", name)), true, name);
  }
});

test("Sprint 16 requires no migration 017", () => {
  assert.equal(fs.existsSync(path.join(root, "supabase/migrations/202608070017_sprint16_mission_center.sql")), false);
});

test("skill catalog presentation read remains read-only under existing RLS", () => {
  assert.match(migration8, /grant select on public\.skill_catalog to authenticated/i);
  assert.match(migration8, /revoke all on public\.skill_catalog from authenticated/i);
  assert.doesNotMatch(repositorySource.match(/const getSkillCatalog[\s\S]*?\n    \};/)?.[0] || "", /insert|upsert|update|delete/i);
});

test("repository normalizes and freezes the canonical skill catalog", async () => {
  const rows = [{ skill_key: "front_end_engineering", display_name: "Front-End Engineering", sort_order: 10 }];
  const builder = {
    select() { return this; },
    eq() { return this; },
    order() { return this; },
    then(resolve) { resolve({ data: rows, error: null }); },
  };
  const repository = repositoryFactory.createUserRepository({
    authService: {
      getCurrentUser: async () => ({ id: "owner" }),
      getClient: () => ({ from: () => builder }),
    },
  });
  const catalog = await repository.getSkillCatalog();
  assert.deepEqual(catalog, [{ key: "front_end_engineering", name: "Front-End Engineering", sortOrder: 10 }]);
  assert.equal(Object.isFrozen(catalog), true);
  assert.equal(Object.isFrozen(catalog[0]), true);
});

test("repository rejects malformed canonical skill catalog data", async () => {
  const builder = {
    select() { return this; },
    eq() { return this; },
    order() { return this; },
    then(resolve) { resolve({ data: [{ skill_key: "", display_name: "", sort_order: "bad" }], error: null }); },
  };
  const repository = repositoryFactory.createUserRepository({
    authService: {
      getCurrentUser: async () => ({ id: "owner" }),
      getClient: () => ({ from: () => builder }),
    },
  });
  await assert.rejects(() => repository.getSkillCatalog(), (error) => error.code === "skill-catalog-response-invalid");
});

test("staging clock remains gated and feeds the normal mission path", () => {
  assert.match(migration12, /dev_require_tools/i);
  assert.match(migration12, /dev_effective_vault_now/i);
  assert.doesNotMatch(dashboardSource, /advance_vault|developer_clock|simulated/i);
});

test("JavaScript syntax remains valid", () => {
  for (const file of ["js/dashboard.js", "js/application-service.js", "js/user-repository.js"]) {
    const result = spawnSync(process.execPath, ["--check", path.join(root, file)], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
});

test("Sprint 16 introduces no service credential or database secret", () => {
  const boundary = [html, dashboardSource, serviceSource, repositorySource, css].join("\n");
  assert.doesNotMatch(boundary, /service_role|postgres(?:ql)?:\/\/|SUPABASE_SERVICE|database[_-]?password/i);
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try {
      await run();
      console.log(`✓ ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`✗ ${name}`);
      console.error(error);
    }
  }
  if (failures) process.exitCode = 1;
})();
