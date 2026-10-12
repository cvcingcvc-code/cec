// Gorgon V2.2 Stage 3 — Job application stage model (求职场景 B).
//
// A PURE module (no DOM / React / localStorage), mirroring task-model.js
// conventions. V2.2 gap #2 from the audit: the existing REG_STATUS /
// PLACE_STATUS vocabularies face activities and places; job hunting (求职)
// has its own stage vocabulary which was NOT modeled before.
//
// HONESTY RULES:
//   * A stage move happens ONLY through transitionStage() against the
//     TRANSITIONS whitelist — arbitrary stage writes are rejected.
//   * "offered" and "accepted" are ONLY reachable through explicit user
//     confirmation (the UI must ask; a link click or an auto-run never
//     moves a stage). Mirrors the registration honesty rule
//     (opened_registration is NEVER registered).
//   * REJECTED / GHOSTED are honest terminal records — a rejection is data,
//     never hidden, and never converted into any other stage.

import { randomUUID } from "../workbench/uuid.js";

/**
 * Job application stages — the ONLY vocabulary the UI may render.
 * 收集 → 已投递 → 笔试 → 面试 → Offer → 已接受；拒绝 / 无回音 为诚实终态。
 */
export const JOB_STAGE = {
  COLLECTING: "collecting",   // 收集中（发现岗位，准备材料）
  APPLIED: "applied",         // 已投递
  ASSESSMENT: "assessment",   // 笔试/测评
  INTERVIEW: "interview",     // 面试（含多轮）
  OFFERED: "offered",         // 拿到 offer —— ONLY via explicit user confirm
  ACCEPTED: "accepted",       // 已接受 —— ONLY via explicit user confirm
  REJECTED: "rejected",       // 被拒（诚实终态）
  GHOSTED: "ghosted",         // 无回音（诚实终态）
};

export const JOB_STAGE_LABEL = {
  [JOB_STAGE.COLLECTING]: "收集中",
  [JOB_STAGE.APPLIED]: "已投递",
  [JOB_STAGE.ASSESSMENT]: "笔试/测评",
  [JOB_STAGE.INTERVIEW]: "面试",
  [JOB_STAGE.OFFERED]: "Offer",
  [JOB_STAGE.ACCEPTED]: "已接受",
  [JOB_STAGE.REJECTED]: "被拒",
  [JOB_STAGE.GHOSTED]: "无回音",
};

/**
 * TRANSITIONS whitelist — the ONLY legal stage moves.
 * Forward path: collecting → applied → assessment → interview → offered → accepted
 * Honest exits: any active stage may go to rejected / ghosted / withdrawn.
 */
export const TRANSITIONS = {
  [JOB_STAGE.COLLECTING]: [JOB_STAGE.APPLIED, JOB_STAGE.REJECTED, JOB_STAGE.GHOSTED],
  [JOB_STAGE.APPLIED]: [JOB_STAGE.ASSESSMENT, JOB_STAGE.INTERVIEW, JOB_STAGE.OFFERED, JOB_STAGE.REJECTED, JOB_STAGE.GHOSTED],
  [JOB_STAGE.ASSESSMENT]: [JOB_STAGE.INTERVIEW, JOB_STAGE.OFFERED, JOB_STAGE.REJECTED, JOB_STAGE.GHOSTED],
  [JOB_STAGE.INTERVIEW]: [JOB_STAGE.OFFERED, JOB_STAGE.REJECTED, JOB_STAGE.GHOSTED],
  [JOB_STAGE.OFFERED]: [JOB_STAGE.ACCEPTED, JOB_STAGE.REJECTED, JOB_STAGE.GHOSTED],
  // Terminal: no moves out of accepted / rejected / ghosted.
  [JOB_STAGE.ACCEPTED]: [],
  [JOB_STAGE.REJECTED]: [],
  [JOB_STAGE.GHOSTED]: [],
};

export class InvalidStageTransitionError extends Error {
  constructor(from, to) {
    super(`Illegal job stage transition: ${from} -> ${to}`);
    this.name = "InvalidStageTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function canTransition(from, to) {
  const allowed = TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

/** Persisted record shape (normalize + guard). */
export function normalizeApplication(input) {
  const company = String(input.company == null ? "" : input.company).trim();
  const role = String(input.role == null ? "" : input.role).trim();
  if (!company || !role) return null;
  return {
    id: String(input.id || randomUUID()),
    company,
    role,
    stage: JOB_STAGE.COLLECTING,
    stageHistory: [{ stage: JOB_STAGE.COLLECTING, at: input.createdAt || new Date().toISOString() }],
    notes: String(input.notes == null ? "" : input.notes).trim(),
    sourceUrl: String(input.sourceUrl == null ? "" : input.sourceUrl).trim(),
    createdAt: String(input.createdAt || new Date().toISOString()),
    updatedAt: String(input.updatedAt || new Date().toISOString()),
  };
}
