// V2.4 (feat/hackathon-discovery-v1) — the action closure.
//
// 发现 → 查看详情 → AI 匹配 → 收藏 → 创建任务 → 设置提醒 → 报名状态。
// Pins the ONE rule the task charter makes non-negotiable: opening the
// registration link is NEVER recorded as registered — only an explicit user
// confirm moves the record, and the result is recordable afterwards.

import { test } from "node:test";
import assert from "node:assert/strict";
import { filterActivities, toView } from "../src/lib/activity-view.js";
import { matchEvents } from "../src/workbench/match/match-model.js";
import { HACKATHONS, normalizeHackathon } from "../src/data/hackathons.js";
import {
  getRegistration, listRegistrations, markRegistrationOpened,
  setPrep, REG_STATUS, REG_LABEL,
  reset as resetOpportunities,
} from "../src/store/opportunity-repository.js";
import { setRegistrationStatus, reset as resetStore } from "../src/store/workbench-store.js";

const NOW = new Date("2026-10-23T12:00:00+08:00");

function setup() {
  resetOpportunities();
  resetStore();
  return HACKATHONS.map(normalizeHackathon).filter(Boolean);
}

test("closure: discover -> filter -> match -> favorite-id -> registration", () => {
  const list = setup();

  // 1. discover: filter to upcoming hackathons
  const hacks = filterActivities(list, { category: "hackathon", timeframe: "open" });
  assert.ok(hacks.length > 0, "upcoming hackathons exist");

  // 2. AI match over the same list
  const out = matchEvents({ projectInput: "具身智能机器人 VLA 项目", activities: hacks, now: NOW });
  assert.ok(out.matches.length > 0, "match found");

  // 3. the matched activity id works in the registration layer
  const act = out.matches[0].activity;
  assert.equal(getRegistration(act.id), null, "starts at none");
});

test("closure: opening the registration link is NOT registered", () => {
  setup();
  const act = HACKATHONS.find((a) => a.registrationUrl);
  assert.ok(act, "a record with a real link exists");

  markRegistrationOpened(act.id, act.registrationUrl);
  const r = getRegistration(act.id);
  assert.equal(r.status, REG_STATUS.OPENED, "opened_registration, never registered");
  assert.equal(REG_LABEL[r.status], "已打开报名页");
  assert.notEqual(r.status, REG_STATUS.REGISTERED);
});

test("closure: registered ONLY via explicit user confirm (with confirmedAt)", () => {
  setup();
  const act = HACKATHONS[0];
  markRegistrationOpened(act.id, act.registrationUrl);
  const r = setRegistrationStatus(act.id, REG_STATUS.REGISTERED);
  assert.equal(r.status, REG_STATUS.REGISTERED);
  assert.ok(r.confirmedAt, "confirmedAt stamped by the explicit confirm");
});

test("closure: failed/cancelled results are recordable after opening", () => {
  setup();
  const act = HACKATHONS[0];
  markRegistrationOpened(act.id, act.registrationUrl);
  const failed = setRegistrationStatus(act.id, REG_STATUS.FAILED);
  assert.equal(failed.status, REG_STATUS.FAILED);
  const cancelled = setRegistrationStatus(act.id, REG_STATUS.CANCELLED);
  assert.equal(cancelled.status, REG_STATUS.CANCELLED);
});

test("closure: prep checklist from AI match lands in the registration record", () => {
  setup();
  const list = setup();
  const out = matchEvents({ projectInput: "具身智能机器人项目", activities: list, now: NOW });
  const m = out.matches[0];
  const r = setPrep(m.activity.id, m.prepList.map((title) => ({ title, done: false })), null);
  assert.ok(Array.isArray(r.prep) && r.prep.length > 0, "prep persisted");
  assert.equal(r.status, REG_STATUS.NONE, "saving prep does NOT change the status");
});

test("closure: reminder time persists on the registration record", () => {
  setup();
  const act = HACKATHONS[0];
  const at = "2026-10-25T09:00:00+08:00";
  const r = setPrep(act.id, [], at);
  assert.equal(r.remindAt, at);
});

test("closure: full loop discover->match->prep->opened->registered->result", () => {
  const list = setup();

  const hacks = filterActivities(list, { category: "hackathon" });
  const out = matchEvents({ projectInput: "大模型 Agent 应用开发", activities: hacks, now: NOW });
  const m = out.matches[0];

  setPrep(m.activity.id, m.prepList.map((title) => ({ title, done: false })), null);
  markRegistrationOpened(m.activity.id, m.activity.registrationUrl);
  let r = getRegistration(m.activity.id);
  assert.equal(r.status, REG_STATUS.OPENED);
  assert.ok(r.prep.length > 0);

  r = setRegistrationStatus(m.activity.id, REG_STATUS.REGISTERED);
  assert.equal(r.status, REG_STATUS.REGISTERED);
  assert.ok(r.confirmedAt);

  const all = listRegistrations();
  assert.ok(all.some((x) => x.activityId === m.activity.id), "record persists in the envelope");
});

test("closure: view roundtrip keeps the additive fields for the detail screen", () => {
  const v = toView(HACKATHONS[0]);
  assert.ok(v.modeLabel);
  assert.ok(v.registrationDeadline);
  assert.ok(v.prize);
  assert.ok(v.eligibility);
  assert.ok(v.registrationUrl, "detail screen can render 打开报名链接");
});
