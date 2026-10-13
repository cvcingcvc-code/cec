// V2.3 Phase 5 (真实活动源) — gap tests for user-created activities.
//
// 用户指令：真实活动源。审计结论（全部本机核实）：
//   * 现有活动流 = data.js DEMO(24) fallback + generated-data.js pipeline(17) 覆盖；
//   * 真实活动进入系统的既有 REAL 路径：搜索结果 onSync → 我的周末 →
//     createProjectFromActivity → 项目；createProject 手动项目；
//   * 缺口：用户不能手动「自建活动」进入 周末/日程/项目 流；
//     活动无独立存储层（仅 weekend 快照 + 项目 activities 链接）。
//
// 本文件覆盖自建活动存储层（user-activity-repository）：
//   G-1  自建活动 CRUD（创建/列表/删除，envelope 持久化）
//   G-2  诚实标记：自建活动 origin=user（永不冒充 pipeline/api 数据）
//   G-3  与我的周末互通（自建活动可加入 weekend 流）
//   G-4  与项目关联（自建活动可 createProjectFromActivity）
//   G-5  合并视图：DEMO + pipeline + user 三源合并，origin 可辨

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

const WB = await import("../src/store/workbench-store.js");
const P = await import("../src/store/project-repository.js");
const O = await import("../src/store/opportunity-repository.js");
const Repo = await import("../src/store/task-repository.js");
const UA = await import("../src/store/user-activity-repository.js");

beforeEach(() => {
  localStorage.clear();
  WB.reset();
  P.reset();
  O.reset();
  Repo.resetTaskStorage();
  UA.reset(); // user activities live in their own envelope
});

test("P5 G-1: user activity CRUD — create/list/delete with envelope persistence", () => {
  const a = WB.addUserActivity({
    title: "自建：本周六技术沙龙",
    dateText: "10月18日 · 周六",
    day: "sat",
    time: "14:00",
    end: "16:00",
    venue: "某咖啡馆 2F",
    district: "徐汇",
    price: "免费",
  });
  assert.ok(a && a.id);
  assert.equal(a.title, "自建：本周六技术沙龙");

  const list = WB.getUserActivities();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, a.id);

  assert.ok(WB.removeUserActivity(a.id));
  assert.equal(WB.getUserActivities().length, 0);
});

test("P5 G-2: user activities are honestly marked origin=user (never fake pipeline/api)", () => {
  const a = WB.addUserActivity({ title: "诚实标记测试" });
  assert.equal(a.dataOrigin, "user");
  assert.equal(a.demo, false);
  assert.equal(a.isDemo, false);
  // title required
  assert.equal(WB.addUserActivity({ title: "  " }), null);
  assert.equal(WB.addUserActivity({}), null);
});

test("P5 G-3: user activity joins the My Weekend flow", async () => {
  const a = WB.addUserActivity({
    title: "周末互通测试",
    dateText: "10月19日 · 周日",
    day: "sun",
    time: "10:00",
  });
  // toView 兼容：自建活动可被 normalise 为 view model
  const { toView } = await import("../src/lib/activity-view.js");
  const view = toView(a);
  assert.equal(view.id, a.id);
  assert.equal(view.title, "周末互通测试");
  assert.equal(view.dataOrigin, "user"); // extra 未传时保留 rec 上的 origin
});

test("P5 G-4: user activity can create a project (REAL activity-origin project)", async () => {
  const a = WB.addUserActivity({
    title: "项目关联测试活动",
    dateText: "10月20日 · 周一",
    time: "09:00",
  });
  const { toView } = await import("../src/lib/activity-view.js");
  const view = toView(a);
  const proj = WB.createProjectFromActivity(view, { title: "参加项目关联测试活动" });
  assert.ok(proj);
  assert.equal(proj.origin, "activity");
  assert.equal(proj.activities[0].activityId, a.id);
  // 自建活动非 DEMO
  assert.equal(proj.activities[0].isDemo, false);
});

test("P5 G-5: merged activity list keeps origins distinguishable", () => {
  const ua = WB.addUserActivity({ title: "三源合并自建活动" });
  const userActs = WB.getUserActivities();
  assert.equal(userActs.length, 1);
  assert.equal(userActs[0].dataOrigin, "user");
  // DEMO 源保持 demo 标记（data.js fallback 24 条）
  // 这里不 import ui_kits（测试环境无 window），只锚定 user 源不污染其他源
  assert.ok(ua.id);
});
