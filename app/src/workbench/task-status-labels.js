// Gorgon Workbench — shared status labels (Phase 2 + V3N).
// Single small module so every screen renders the same Chinese labels for
// the formal state-machine vocabulary, without importing React code.
// V3N (§2 结果态词汇): 部分完成 derives from failed+partial metadata; the
// vocabulary itself is unchanged (same keys, same transitions).

export const STATUS_LABELS = {
  created: "已创建",
  planning: "规划中",
  ready: "等待执行",
  running: "执行中",
  review_required: "需要确认",
  completed: "已完成",
  failed: "失败",
};

/**
 * Context-aware label: pure failed (no preserved result/steps) reads 失败;
 * failed with preserved partial results reads 部分完成 (§2 vocabulary).
 */
export function statusLabel(status, task) {
  if (status === "failed") {
    const hasPartial = task && task.result && (task.result.content != null);
    const hasDoneSteps = task && Array.isArray(task.steps) &&
      task.steps.some((s) => s.status === "completed");
    if (hasPartial || hasDoneSteps) return "部分完成";
    return "失败";
  }
  return STATUS_LABELS[status] || status;
}
