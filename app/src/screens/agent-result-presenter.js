// Display-only translation of structured PC agent results. Never mutates records.
const FOLLOW_UP = {
  failed: "执行失败，请核对电脑返回的错误后再决定是否重试。",
  timed_out: "执行超时，已返回的内容可能不完整，请核对电脑状态。",
  cancelled: "任务已取消，以下内容可能只是取消前的部分结果。",
};
function short(value) {
  if (value == null || typeof value === "object") return null;
  const s = String(value).trim();
  return s ? s.slice(0, 160) : null;
}
function stats(out) {
  if (!out || typeof out !== "object" || Array.isArray(out)) return null;
  const fields = [
    ["platform", "系统平台"], ["release", "系统版本"],
    ["cpuModel", "处理器"], ["cpuCount", "CPU 核心数"],
    ["totalMemGB", "总内存 GB"], ["freeMemGB", "可用内存 GB"], ["uptimeH", "已运行小时"],
  ];
  const lines = fields.map(([key, label]) => ({ label, value: short(out[key]) }))
    .filter((line) => line.value != null);
  return lines.length ? { heading: "电脑概况", lines, text: null } : null;
}
function git(out) {
  if (typeof out !== "string") return null;
  const rows = out.split(/\r?\n/).filter((line) => line.trim());
  if (!rows[0]?.startsWith("## ")) return null;
  const changed = rows.length - 1;
  return {
    heading: "项目文件状态",
    lines: [{ label: "分支", value: short(rows[0].slice(3)) || "未提供" },
      { label: "有变动的文件", value: changed + " 个" }],
    text: changed ? "电脑报告有未提交的文件变动，详情可查看文件名。"
      : "电脑未报告待提交的文件变动。",
  };
}
export function presentAgentResult(run) {
  const result = run?.result;
  const out = result && typeof result === "object" && Object.hasOwn(result, "output")
    ? result.output : result;
  let view = run?.executor === "host.stats" ? stats(out)
    : run?.executor === "repo.status" ? git(out) : null;
  if (!view && typeof out === "string") {
    const heading = run?.executor === "repo.readDoc" ? "文档内容"
      : run?.executor === "codex.readonly-diagnosis" ? "Codex 分析结果" : "电脑返回的文字";
    view = { heading, lines: [], text: out || "未收到文字内容。" };
  }
  if (!view) view = {
    heading: "结构化数据", lines: [],
    text: "电脑返回了结构化数据，请展开下方的技术详情查看；不能仅凭数据判断任务成功。",
  };
  return { ...view, nextStep: FOLLOW_UP[run?.status] || null };
}
