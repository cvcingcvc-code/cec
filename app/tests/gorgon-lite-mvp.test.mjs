// Gorgon Lite MVP — Phase 1 unit regression tests.
//
// Verifies:
//   1. Navigation mode resolution & rollback (?nav=classic, localStorage, default lite)
//   2. WorkBuddy controlled read-only operation model & Chinese result presenter
//   3. End-to-end closed loop data integrity (create task -> run -> save result & review note
//      -> link project & PC agent run -> reload persistence without losing historical records)

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

function makeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
  };
}
globalThis.localStorage = makeStorage();

const Nav = await import("../src/workbench/navigation.js");
const WB = await import("../src/store/workbench-store.js");
const Store = await import("../src/store/store.js");
const {
  executorLabel, getAvailability, getInputMode, buildTaskInput, WORKBUDDY_OPERATIONS,
} = await import("../src/screens/agent-screen-model.js");
const { presentAgentResult } = await import("../src/screens/agent-result-presenter.js");
const { importRunsMirror, readAgentRunsMirror } = await import("../src/lib/agent-runs-mirror.js");

beforeEach(() => { localStorage.clear(); });

test("Lite nav mode defaults to 'lite' and supports URL + storage rollback to 'classic'", () => {
  const st = makeStorage();
  assert.equal(Nav.getNavMode("", st), "lite");
  assert.equal(Nav.getNavMode("?nav=classic", st), "classic");
  assert.equal(Nav.getNavMode("?nav=full", st), "classic");
  assert.equal(st.getItem(Nav.NAV_MODE_KEY), null, "URL preview must not mutate storage");

  Nav.setNavMode("classic", st);
  assert.equal(Nav.getNavMode("", st), "classic");
  assert.equal(Nav.getNavMode("?nav=lite", st), "lite", "explicit URL query overrides saved mode");

  Nav.setNavMode("lite", st);
  assert.equal(Nav.getNavMode("", st), "lite");
});

test("WorkBuddy read-only executor uses controlled operation selector and rejects unsupported ops", () => {
  const wbExec = {
    id: "workbuddy.submitTask",
    agent: "workbuddy",
    availability: "AVAILABLE",
    input: { operation: "string" },
    description: "WorkBuddy 只读查询",
  };
  assert.equal(executorLabel(wbExec), "查询 WorkBuddy 只读信息");
  const avail = getAvailability(wbExec);
  assert.equal(avail.canSubmit, true);
  assert.match(avail.detail, /只读/);
  assert.equal(getInputMode(wbExec), "wb_operation");

  for (const op of WORKBUDDY_OPERATIONS) {
    assert.deepEqual(buildTaskInput(wbExec, { wbOperation: op.value }), { operation: op.value });
  }
  assert.throws(() => buildTaskInput(wbExec, { wbOperation: "send_message" }), /只读查询项/);
});

test("WorkBuddy result presenter renders Chinese fields without leaking unknown properties", () => {
  const run = {
    executor: "workbuddy.submitTask",
    status: "completed",
    result: {
      summary: "WorkBuddy 已登录 1 个账号",
      output: {
        httpStatus: 200,
        accounts: [{ nickname: "测试用户", type: "personal", secretToken: "DO_NOT_LEAK" }],
      },
    },
  };
  const view = presentAgentResult(run);
  assert.equal(view.heading, "WorkBuddy 只读查询结果");
  assert.ok(view.lines.some((l) => l.label === "登录账号" && l.value.includes("测试用户")));
  assert.equal(JSON.stringify(view).includes("DO_NOT_LEAK"), false);
});

test("Core Gorgon Lite closed loop preserves tasks, notes, projects, legacy weekend and PC mirror", async () => {
  // Seed pre-existing historical user data across modules (must never be wiped)
  Store.setWeekendItems({ "act-1": { id: "act-1", title: "历史周末活动" } });
  const proj = WB.createProject({ title: "个人效率迭代", goal: "持续复盘" });
  WB.upsertPlace({ name: "历史走访点", address: "上海市徐汇区" });
  WB.addUserActivity({ title: "历史自建活动", date: "2026-11-20" });

  // 1. User creates & auto-executes a task via One-Shot
  const out = await WB.submitOneShotGoal("帮我整理一份交付前核对清单");
  assert.equal(out.ok, true);
  assert.equal(out.task.status, "completed");
  assert.ok(out.task.result, "deterministic extract skill produces real result");

  // 2. User links project, sets schedule & reminder, attaches PC agent run, and writes review note
  const taskId = out.task.id;
  WB.linkTaskToProject(taskId, proj.id);
  WB.setTaskSchedule(taskId, { scheduledDate: "2026-11-18" });
  WB.setTaskReminder(taskId, { remindAt: "2026-11-18T18:00:00.000Z" });
  importRunsMirror(JSON.stringify({
    runs: [{
      runId: "run_lite_1",
      executor: "repo.status",
      status: "completed",
      summary: "干净工作树",
      output: "## refactor/gorgon-lite-mvp\n",
      createdAt: "2026-11-18T06:00:00.000Z",
    }],
  }));
  WB.linkTaskToAgentRun(taskId, "run_lite_1", { executor: "repo.status", summary: "干净工作树" });
  WB.addNote({ kind: "text", text: "复盘：清单核对完毕，漏项已补齐。", taskId, projectId: proj.id });

  // 3. Verify all data survives round-trip & remains consistent across repositories
  const savedTask = WB.getTask(taskId);
  assert.equal(savedTask.projectId, proj.id);
  assert.equal(savedTask.scheduledDate, "2026-11-18");
  assert.equal(savedTask.remindAt, "2026-11-18T18:00:00.000Z");
  assert.deepEqual(savedTask.agentRunIds, ["run_lite_1"]);
  assert.equal(readAgentRunsMirror(savedTask.agentRunIds).length, 1);
  assert.equal(WB.getNotes({ taskId }).length, 1);
  assert.match(WB.getNotes({ taskId })[0].text, /复盘/);

  // Historical data across hidden/secondary modules remains 100% intact
  assert.equal(Object.keys(Store.getWeekendItems()).length, 1);
  assert.equal(WB.getPlaces().length, 1);
  assert.equal(WB.getUserActivities().length, 1);
});
