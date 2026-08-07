"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const dashboard = require("../js/dashboard.js");

const root = path.join(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const hash = (relativePath) => crypto.createHash("sha256").update(read(relativePath)).digest("hex");

const createSnapshot = ({ state = "completed", replacementsRemaining = 0, currentXP = 125 } = {}) => ({
  coordinator: {
    currentMission: {
      definition: { id: "programming-focused-session-mission-b" },
      lifecycle: { state, isTerminal: ["completed", "skipped", "expired"].includes(state) },
    },
    dailyStatus: {
      replacementsUsed: replacementsRemaining === 0 ? 1 : 0,
      replacementsRemaining,
      canRequestReplacement: state === "completed" && replacementsRemaining > 0,
    },
  },
  progression: { currentXP },
});

const view = (snapshot) => dashboard.dailyComplete.createViewModel(snapshot);
const tests = [];
const test = (name, run) => tests.push({ name, run });

test("first completed mission with a replacement available is not Daily Complete", () => {
  assert.equal(view(createSnapshot({ replacementsRemaining: 1, currentXP: 100 })).visible, false);
});

test("completed replacement with no allowance remaining is Daily Complete", () => {
  assert.equal(view(createSnapshot()).visible, true);
});

test("Daily Complete displays authoritative progression XP", () => {
  const result = view(createSnapshot({ currentXP: 1375 }));
  assert.equal(result.currentXP, 1375);
  assert.equal(result.xpLabel, "1,375 XP");
  assert.doesNotMatch(read("dashboard.html"), />125 XP</);
});

test("Daily Complete survives refresh from the restored authoritative snapshot", () => {
  const restored = JSON.parse(JSON.stringify(createSnapshot()));
  assert.equal(view(restored).visible, true);
  assert.equal(view(restored).xpLabel, "125 XP");
});

test("Daily Complete survives logout and login restoration", () => {
  const afterLogin = createSnapshot({ state: "completed", replacementsRemaining: 0, currentXP: 125 });
  assert.deepEqual(view(afterLogin), view(createSnapshot()));
});

test("final completion exposes no further mission action", () => {
  const source = read("js/dashboard.js");
  assert.match(source, /if \(missionActions\) missionActions\.hidden = true/);
  assert.match(source, /if \(missionReplacement\) missionReplacement\.hidden = true/);
});

test("a new ready server mission removes the prior Daily Complete state", () => {
  assert.equal(view(createSnapshot({ state: "ready", replacementsRemaining: 1, currentXP: 125 })).visible, false);
});

test("reset messaging is display-only and cannot create or reset missions", () => {
  const source = read("js/dashboard.js");
  assert.equal(view(createSnapshot()).nextMissionLabel, "New mission available tomorrow");
  assert.doesNotMatch(source, /setInterval|resetMission|createMission|generateMission/);
});

test("Daily Complete has an accessible, non-chattering status and focus target", () => {
  const html = read("dashboard.html");
  assert.match(html, /data-daily-complete hidden role="status" aria-live="polite" aria-atomic="true" tabindex="-1"/);
  assert.match(html, /aria-labelledby="daily-complete-title"/);
  assert.match(read("js/dashboard.js"), /dailyComplete\.focus\(\{ preventScroll: true \}\)/);
});

test("Sprint 9 backend, authentication, repository, and migration contracts are unchanged", () => {
  const expected = {
    "js/application-service.js": "74775f043d084b6787be0dd69bf4be8378d49343f49dad52a2ea14de6f6791e2",
    "js/user-repository.js": "870f6eb0109bdca0a2d177b5f087720e3f92b72dee24c46792f43f79a38ca8ae",
    "js/auth-service.js": "3b0b2ac7b341528ac946000ea5eb8e72860b1f1ffefc0542f0f3eb48c3db95d5",
    "js/auth.js": "eb48bad77d1eebac721f273f5b8234ee748207a02a9a2008edfe2da55f1d333a",
    "js/protected-page.js": "9c7a92949b84d59aadf9647ef04c6c1d31688623a8f4ad7ed0bd0b68f399f71d",
    "js/route-guard.js": "17ca3c71023d603f951cb8b593d57e09a1e3dac3e802cda32a4344b0897d71ad",
    "supabase/migrations/202608070001_sprint7_foundation.sql": "a4eb8d416124c2a02fe6d2ecf76dd98bc716eb809ebfedd4876c7f1b357d08ed",
    "supabase/migrations/202608070002_sprint7_1_security_correction.sql": "6e93812ca8ea92bcb5822e38946a1b6af3cef30937c3721719bbaf69dc6baba6",
    "supabase/migrations/202608070003_sprint7_2_prototype_persistence.sql": "41db525a59383ea3c1ea72bc336473d9fede1673b9b18e96f2f3a0eadb50f820",
    "supabase/migrations/202608070004_sprint7_2_replacement_persistence.sql": "9b22782c4e32ceee82685591640f0f22b5f6ae1047d032884864c052e30fafe1",
    "supabase/migrations/202608070005_sprint8_server_authority.sql": "370fc5fa159a8462599641859091ad4bc8a382e27553356a888fa863026cae41",
    "supabase/migrations/202608070006_sprint9_daily_mission_authority.sql": "a8967a586e72bf6685dd0903e6e811c12fddf2edc5eb04c727af790ba3975d4d",
  };
  Object.entries(expected).forEach(([file, digest]) => assert.equal(hash(file), digest, file));
});

(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failures += 1; console.error(`✗ ${name}`); console.error(error); }
  }
  if (failures) process.exitCode = 1;
})();
