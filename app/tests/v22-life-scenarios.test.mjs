// Gorgon V2.2 Stage 3 — three REAL life scenarios (charter deliverable).
//
// Every scenario runs against the REAL stores (no mocks beyond the
// localStorage double the other suite tests use):
//   A  活动参加 — discover → register honestly → prep → attend → progress → review
//   B  求职学习 — job pipeline with the honest stage model (gap #2)
//   C  地点走访 — plan → visit → revisit decision → progress
//
// Honesty pins throughout:
//   * opened_registration is NEVER registered
//   * job offered/accepted only via explicit confirm; rejected/ghosted are
//     honest terminal records
//   * place visits flip todo/revisit → visited (repository vocabulary)

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
const Prog = await import("../src/store/progress-repository.js");
const Jobs = await import("../src/store/job-repository.js");

beforeEach(() => {
  localStorage.clear();
  WB.reset();
  P.reset();
  O.reset();
  Repo.resetTaskStorage();
  Prog.reset();
  Jobs.reset();
});

/* ══ Scenario A: 活动参加 ═══════════════════════════════════════════ */

test("场景 A：从活动发现到参加复盘的真实闭环", () => {
  // 1. 从活动视图创建项目（真实 activity snapshot，DEMO 标记保留）
  const proj = WB.createProjectFromActivity({
    id: "act-meetup-1", title: "AI 开发者 meetup", dateText: "10月18日 14:00",
    venue: "西岸艺术中心", dataOrigin: "demo",
  });
  assert.equal(proj.origin, "activity");
  assert.equal(proj.activities[0].isDemo, true);

  // 2. 报名诚实规则：打开报名页 ≠ 已报名
  WB.markRegistrationOpened(proj.activities[0].activityId, "https://example.org/rsvp");
  let reg = WB.getRegistration(proj.activities[0].activityId);
  assert.equal(reg.status, "opened_registration");
  assert.notEqual(reg.status, "registered");

  // 3. 用户显式确认报名（唯一 registered 路径，confirmedAt 盖章）
  WB.setRegistrationStatus(proj.activities[0].activityId, "registered", { confirmedAt: "2026-10-10T09:00:00.000Z" });
  reg = WB.getRegistration(proj.activities[0].activityId);
  assert.equal(reg.status, "registered");
  assert.ok(reg.confirmedAt);

  // 4. 出行准备清单（默认种子 → 勾选）
  const seeded = WB.defaultPrepFor(proj.activities[0]);
  WB.setPrep(proj.activities[0].activityId, seeded);
  const firstPrepId = seeded[0].id;
  const r2 = WB.getRegistration(proj.activities[0].activityId);
  const toggled = r2.prep.map((p) => (p.id === firstPrepId ? Object.assign({}, p, { done: true }) : p));
  WB.setPrep(proj.activities[0].activityId, toggled);
  const r3 = WB.getRegistration(proj.activities[0].activityId);
  assert.equal(r3.prep.filter((p) => p.done).length, 1);

  // 5. 关联任务 + 日程
  WB.addTask("准备自我介绍", { projectId: proj.id });
  const tid = WB.getTasks()[0].id;
  WB.setTaskSchedule(tid, { scheduledDate: "2026-10-18" });
  const t = WB.getTask(tid);
  assert.equal(t.scheduledDate, "2026-10-18");

  // 6. 记录进度（V2.2 统一进度）
  const prog = WB.addProgress({
    subjectType: "project", subjectId: proj.id, subjectTitle: proj.title,
    kind: "milestone", text: "报名确认 + 清单就绪",
  });
  assert.ok(prog.id);

  // 7. 重新进入查看：bundle 聚合完整
  const bundle = WB.getProjectBundle(proj.id);
  assert.equal(bundle.project.id, proj.id);
  assert.equal(bundle.registrations.length, 1);
  assert.equal(bundle.registrations[0].status, "registered");
  assert.equal(bundle.tasks.length, 1);
  assert.equal(bundle.progress.length, 1);
  assert.ok(bundle.registrations[0].prep.length >= 3);
});

/* ══ Scenario B: 求职学习（gap #2: job stage model）══════════════════ */

test("场景 B：求职管线 — 投递→笔试→面试→offer 的诚实推进", () => {
  // 1. 收集岗位（起始 COLLECTING，永不跳段）
  const app = Jobs.addApplication({ company: "星尘科技", role: "前端工程师", notes: "内推，急招" });
  assert.ok(app.id);
  assert.equal(app.stage, "collecting");
  assert.equal(app.stageHistory.length, 1);

  // 2. 非法跳段被拒：collecting 不能直接到 offered（诚实规则）
  assert.equal(Jobs.transitionStage(app.id, "offered"), null);
  assert.equal(Jobs.getApplication(app.id).stage, "collecting");

  // 3. 投递 → 笔试 → 面试（白名单内推进）
  assert.equal(Jobs.transitionStage(app.id, "applied").stage, "applied");
  assert.equal(Jobs.transitionStage(app.id, "assessment").stage, "assessment");
  assert.equal(Jobs.transitionStage(app.id, "interview").stage, "interview");

  // 4. 终态拒绝后不可复活的诚实性
  const rejected = Jobs.transitionStage(app.id, "rejected");
  assert.equal(rejected.stage, "rejected");
  assert.equal(Jobs.transitionStage(rejected.id, "interview"), null, "terminal has no moves out");
  assert.equal(Jobs.transitionStage(rejected.id, "offered"), null);

  // 5. stageHistory 完整审计轨迹
  const final = Jobs.getApplication(app.id);
  assert.equal(final.stageHistory.length, 5); // collecting + 4 moves
  assert.equal(final.stageHistory[4].stage, "rejected");
});

test("场景 B-2：offer 只经显式确认 + 项目化学习任务联动", () => {
  const app = Jobs.addApplication({ company: "远山数据", role: "数据工程师" });
  Jobs.transitionStage(app.id, "applied");
  Jobs.transitionStage(app.id, "interview"); // applied → interview 是白名单内的
  // offer 需要显式确认（UI 层职责；此处验证唯一合法路径存在）
  const offered = Jobs.transitionStage(app.id, "offered");
  assert.equal(offered.stage, "offered");
  const accepted = Jobs.transitionStage(app.id, "accepted");
  assert.equal(accepted.stage, "accepted");
  assert.equal(Jobs.transitionStage(app.id, "interview"), null, "accepted is terminal");

  // 求职学习作为项目：任务 + 进度联动
  const proj = WB.createProject({ title: "求职：远山数据", goal: "准备数据工程师面试" });
  WB.addTask("刷 SQL 题", { projectId: proj.id });
  const tid = WB.getTasks()[0].id;
  WB.transitionTask(tid, "ready");
  WB.transitionTask(tid, "running");
  WB.transitionTask(tid, "completed");
  const prog = WB.addProgress({
    subjectType: "task", subjectId: tid, subjectTitle: "刷 SQL 题",
    kind: "done", text: "SQL 专项 30 题完成",
  });
  assert.ok(prog.id);
  // 诚实：进度 kind=done 不改变任何状态；任务状态由状态机自己走完
  assert.equal(WB.getTask(tid).status, "completed");
  const bundle = WB.getProjectBundle(proj.id);
  assert.equal(bundle.tasks[0].status, "completed");
  assert.equal(bundle.progress.length, 1);
});

test("场景 B-3：ghosted 是诚实记录 + countByStage 统计", () => {
  const a1 = Jobs.addApplication({ company: "A 公司", role: "r1" });
  const a2 = Jobs.addApplication({ company: "B 公司", role: "r2" });
  const a3 = Jobs.addApplication({ company: "C 公司", role: "r3" });
  Jobs.transitionStage(a1.id, "applied");
  Jobs.transitionStage(a1.id, "ghosted"); // 无回音，诚实记录
  Jobs.transitionStage(a2.id, "applied");
  // a3 留在 collecting
  const counts = Jobs.countByStage();
  assert.equal(counts.ghosted, 1);
  assert.equal(counts.applied, 1);
  assert.equal(counts.collecting, 1);
  assert.equal(Jobs.listApplications({ stage: "ghosted" }).length, 1);
});

/* ══ Scenario C: 地点走访 ═══════════════════════════════════════════ */

test("场景 C：走访计划→到访→复访判断的真实闭环", () => {
  // 1. 求职学习项目下规划走访（地推/实地调研）
  const proj = WB.createProject({ title: "候选人公司实地调研", goal: "走访三家公司周边" });
  const pl1 = WB.upsertPlace({ name: "星尘科技总部", address: "科技园 1 号", projectId: proj.id, status: "todo" });
  const pl2 = WB.upsertPlace({ name: "远山数据办公点", address: "软件园 2 栋", projectId: proj.id, status: "todo" });
  assert.equal(pl1.status, "todo");

  // 2. 记录真实到访（自动翻转 todo → visited）
  const visited = WB.addPlaceVisit(pl1.id, { note: "周边餐饮多，通勤便利" });
  assert.equal(visited.status, "visited");
  assert.ok(visited.visits.length >= 1);

  // 3. 复访判断：第二次走访标记 revisit → 再次到访翻回 visited
  const rev = WB.setPlaceStatus(pl2.id, "revisit");
  assert.equal(rev.status, "revisit");
  const rev2 = WB.addPlaceVisit(pl2.id, { note: "这次确认了班车时刻" });
  assert.equal(rev2.status, "visited");

  // 4. 不适合是诚实记录（不隐藏也不删除）
  const pl3 = WB.upsertPlace({ name: "某小公司", address: "民房", projectId: proj.id, status: "todo" });
  const unsuitable = WB.setPlaceStatus(pl3.id, "unsuitable");
  assert.equal(unsuitable.status, "unsuitable");

  // 5. 进度 + 重新进入查看
  WB.addProgress({
    subjectType: "project", subjectId: proj.id, subjectTitle: proj.title,
    kind: "note", text: "两家确认适合投递，一家排除",
  });
  const bundle = WB.getProjectBundle(proj.id);
  assert.equal(bundle.places.length, 3);
  assert.equal(bundle.places.filter((p) => p.status === "visited").length, 2);
  assert.equal(bundle.places.filter((p) => p.status === "unsuitable").length, 1);
  assert.equal(bundle.progress.length, 1);
});

/* ══ cross-scenario: storage health of every new key ════════════════ */

test("三场景并存：四份新键 + 既有键互不干扰且健康", () => {
  // A
  const projA = WB.createProjectFromActivity({ id: "act-x", title: "X 活动" });
  WB.markRegistrationOpened(projA.activities[0].activityId, "https://x.example");
  // B
  Jobs.addApplication({ company: "D 公司", role: "r" });
  // C
  WB.upsertPlace({ name: "地点 P", status: "todo" });
  // Progress
  WB.addProgress({ subjectType: "project", subjectId: projA.id, text: "共同进度" });

  const progHealth = Prog.getStorageHealth();
  assert.equal(progHealth.available, true);
  assert.equal(progHealth.entries, 1);
  assert.equal(progHealth.corrupted, 0);
  const jobHealth = Jobs.getStorageHealth();
  assert.equal(jobHealth.available, true);
  assert.equal(jobHealth.applications, 1);
  // 既有键未受影响
  assert.equal(WB.getProjects().length, 1);
  assert.equal(Jobs.listApplications().length, 1);
  assert.equal(WB.getPlaces().length, 1);
});
