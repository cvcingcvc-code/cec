import test from "node:test";
import assert from "node:assert/strict";
import { presentAgentResult } from "../src/screens/agent-result-presenter.js";

test("V3G host stats render Chinese labels without leaking unknown fields", () => {
  const run = { status: "completed", executor: "host.stats",
    result: { output: { platform: "win32", cpuCount: 8, totalMemGB: 16, secret: "PRIVATE" } } };
  const original = JSON.stringify(run);
  const displayed = presentAgentResult(run);
  assert.equal(displayed.heading, "电脑概况");
  assert.equal(displayed.lines.find((x) => x.label === "总内存 GB").value, "16");
  assert.equal(JSON.stringify(displayed).includes("PRIVATE"), false);
  assert.equal(JSON.stringify(run), original);
});

test("V3G git status accurately counts changed lines and avoids false clean", () => {
  const changed = presentAgentResult({ status: "completed", executor: "repo.status",
    result: { output: "## feature/work\n M docs/a.md\n?? b.md\n" } });
  assert.equal(changed.lines.find((x) => x.label === "有变动的文件").value, "2 个");
  assert.match(changed.text, /未提交/);
  const clean = presentAgentResult({ status: "completed", executor: "repo.status",
    result: { output: "## main\n" } });
  assert.match(clean.text, /未报告待提交/);
  const error = presentAgentResult({ status: "failed", executor: "repo.status",
    result: { output: "git timeout" } });
  assert.doesNotMatch(error.text, /未报告待提交/);
  assert.match(error.nextStep, /失败/);
});

test("V3G preserves long document and model text; timeout is still timeout", () => {
  const original = "第一段\n" + "正文".repeat(9000);
  const doc = presentAgentResult({ executor: "repo.readDoc", status: "completed", result: { output: original } });
  assert.equal(doc.text, original);
  const codex = presentAgentResult({ executor: "codex.readonly-diagnosis", status: "timed_out",
    result: { output: original } });
  assert.equal(codex.text, original);
  assert.match(codex.nextStep, /不完整/);
});

test("V3G unknown structured data does not claim success or reveal fields", () => {
  const result = presentAgentResult({ executor: "unknown", status: "cancelled",
    result: { output: { authorization: "do-not-display" } } });
  assert.equal(result.heading, "结构化数据");
  assert.equal(JSON.stringify(result).includes("do-not-display"), false);
  assert.match(result.nextStep, /取消/);
});
