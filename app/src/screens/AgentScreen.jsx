// Gorgon Workbench — AgentScreen (V3 Phase A, Task #3/E).
//
// 手机端智能体入口：提交任务到电脑端 Agent Gateway、查看执行状态与
// 结构化结果、取消执行中的任务。真实执行，不模拟冒充（诚实纪律）：
//   * 网关地址 + 配对 token 存本地（Preferences 镜像持久化）。
//   * 提交 = POST /v1/runs（带 X-Gorgon-Token 头）。
//   * 结果 = GET /v1/runs/:id 轮询；状态词汇 queued/running/completed/
//     failed/cancelled 与 Gateway 侧一致。
//   * 连接失败/鉴权失败/未知执行器都如实显示错误，绝不假装成功。
//   * 取消 = POST /v1/runs/:id/cancel（协作取消）。
//
// 本屏不做任何执行器逻辑；执行器白名单由 Gateway 下发（/v1/executors）。

import React from "react";
import { Button } from "../lib/ds.js";
import { Icon } from "../components/Icon.jsx";

const K_GATEWAY = "gorgon_agent_gateway_url";
const K_TOKEN = "gorgon_agent_gateway_token";

const RUN_STATUS_LABEL = {
  queued: "排队中",
  running: "执行中",
  completed: "已完成",
  failed: "失败",
  timed_out: "已超时",
  cancelled: "已取消",
};

const RUN_STATUS_TONE = {
  queued: { color: "var(--text-muted)", bg: "var(--bg-sunken)" },
  running: { color: "var(--brand)", bg: "var(--brand-soft)" },
  completed: { color: "var(--accent-strong, #047857)", bg: "var(--accent-soft)" },
  failed: { color: "var(--danger)", bg: "var(--danger-soft)" },
  timed_out: { color: "var(--warning, #B45309)", bg: "var(--warning-soft, #FFF6E6)" },
  cancelled: { color: "var(--text-muted)", bg: "var(--bg-sunken)" },
};

function fmtTime(iso) {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  } catch (e) { return ""; }
}

function loadLocal(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch (e) {
    return fallback;
  }
}

function saveLocal(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) { /* private mode — session only */ }
}

export function AgentScreen({ flash, linkTask = null, linkableTasks = [] }) {
  const [url, setUrl] = React.useState(() => loadLocal(K_GATEWAY, "http://192.168.1.100:8765"));
  const [token, setToken] = React.useState(() => loadLocal(K_TOKEN, ""));
  const [executors, setExecutors] = React.useState([]);
  const [executor, setExecutor] = React.useState("");
  const [inputJson, setInputJson] = React.useState("{}");
  const [runs, setRuns] = React.useState([]);
  const [busy, setBusy] = React.useState(false);
  const [connState, setConnState] = React.useState("idle"); // idle|ok|error
  const [connError, setConnError] = React.useState("");
  const [detailRun, setDetailRun] = React.useState(null);

  React.useEffect(() => { saveLocal(K_GATEWAY, url); }, [url]);
  React.useEffect(() => { saveLocal(K_TOKEN, token); }, [token]);

  // Poll recent runs when connected.
  React.useEffect(() => {
    if (connState !== "ok") return undefined;
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`${url.replace(/\/+$/, "")}/v1/runs?limit=20`, {
          headers: { "X-Gorgon-Token": token },
        });
        if (res.status === 401) { if (!stop) { setConnState("error"); setConnError("鉴权失败（token 不正确）"); } return; }
        const j = await res.json();
        if (!stop && j && j.ok) setRuns(j.runs || []);
      } catch (e) { /* transient — keep last state */ }
    };
    tick();
    const iv = setInterval(tick, 4000);
    return () => { stop = true; clearInterval(iv); };
  }, [connState, url, token]);

  const connect = async () => {
    setBusy(true);
    setConnError("");
    try {
      const base = url.replace(/\/+$/, "");
      const h = await fetch(`${base}/health`);
      if (!h.ok) throw new Error(`health ${h.status}`);
      const hj = await h.json();
      if (!hj || !hj.ok) throw new Error("health 返回异常");
      // Verify the token too — honest pairing feedback.
      const ex = await fetch(`${base}/v1/executors`, { headers: { "X-Gorgon-Token": token } });
      if (ex.status === 401) throw new Error("token 不正确（检查电脑端 token）");
      const ej = await ex.json();
      setExecutors((ej && ej.executors) || []);
      setExecutor((cur) => cur || ((ej.executors && ej.executors[0] && ej.executors[0].id) || ""));
      setConnState("ok");
      if (flash) flash(`已连接 ${hj.name} v${hj.version}`);
    } catch (e) {
      setConnState("error");
      setConnError(String((e && e.message) || e));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!executor || busy) return;
    setBusy(true);
    try {
      let input = {};
      if (inputJson.trim()) {
        try { input = JSON.parse(inputJson); }
        catch (e) { if (flash) flash("输入不是合法 JSON"); setBusy(false); return; }
      }
      const res = await fetch(`${url.replace(/\/+$/, "")}/v1/runs`, {
        method: "POST",
        headers: { "X-Gorgon-Token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ executor, input }),
      });
      const j = await res.json();
      if (!j || !j.ok) throw new Error(j && j.error ? j.error : `HTTP ${res.status}`);
      if (flash) flash(`任务已提交：${j.runId.slice(0, 12)}…`);
    } catch (e) {
      if (flash) flash("提交失败：" + String((e && e.message) || e));
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (runId) => {
    setBusy(true);
    try {
      const res = await fetch(`${url.replace(/\/+$/, "")}/v1/runs/${runId}`, {
        headers: { "X-Gorgon-Token": token },
      });
      const j = await res.json();
      if (j && j.ok) setDetailRun(j.run);
      else if (flash) flash("读取失败：" + (j && j.error ? j.error : `HTTP ${res.status}`));
    } catch (e) {
      if (flash) flash("读取失败：" + String((e && e.message) || e));
    } finally {
      setBusy(false);
    }
  };

  const cancelRun = async (runId) => {
    setBusy(true);
    try {
      const res = await fetch(`${url.replace(/\/+$/, "")}/v1/runs/${runId}/cancel`, { method: "POST", headers: { "X-Gorgon-Token": token } });
      const j = await res.json();
      if (flash) flash(j && j.ok ? "已请求取消" : "取消失败：" + (j && j.error));
    } catch (e) {
      if (flash) flash("取消失败：" + String((e && e.message) || e));
    } finally {
      setBusy(false);
    }
  };

  const card = {
    background: "var(--surface-card)", border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius-md)", padding: "12px 14px",
  };
  const inputStyle = {
    flex: 1, minWidth: 0, border: "1px solid var(--border-subtle)", outline: "none",
    borderRadius: "var(--radius-sm)", padding: "9px 12px", background: "var(--bg-sunken)",
    fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--text-strong)",
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }} data-gg-screen="workbench-agent">
      <div style={{ padding: "28px 16px 40px", maxWidth: 860, margin: "0 auto", width: "100%" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 24, color: "var(--text-strong)", margin: 0 }}>
            智能体
          </h1>
          <span style={{ fontSize: 12, color: "var(--text-faint)" }}>
            电脑端 Agent Gateway · 真实执行 · 白名单任务
          </span>
        </div>

        {/* connection card */}
        <div style={card} data-testid="workbench-agent-conn">
          <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-faint)", marginBottom: 9, letterSpacing: "0.03em" }}>
            <Icon name="plug-zap" style={{ width: 13, height: 13, verticalAlign: "-2px", marginRight: 5 }} />
            连接电脑端网关
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            <input aria-label="网关地址" data-testid="workbench-agent-url" placeholder="http://192.168.x.x:8765"
              value={url} onChange={(e) => setUrl(e.target.value)}
              style={inputStyle} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            <input aria-label="配对 Token" data-testid="workbench-agent-token" placeholder="配对 token（电脑端首次启动时生成）"
              value={token} onChange={(e) => setToken(e.target.value)}
              style={{ ...inputStyle, fontFamily: "monospace", fontSize: 12 }} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
              <Button size="sm" variant="primary" data-testid="workbench-agent-connect" onClick={connect} disabled={busy || !url || !token}>
                连接
              </Button>
              {connState === "ok" && (
                <span data-testid="workbench-agent-conn-ok" style={{ fontSize: 12.5, color: "var(--accent-strong, #047857)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Icon name="check" style={{ width: 13, height: 13 }} />已连接 · {executors.length} 个执行器
                </span>
              )}
              {connState === "error" && (
                <span data-testid="workbench-agent-conn-error" style={{ fontSize: 12.5, color: "var(--danger)", fontWeight: 600 }}>
                  连接失败：{connError}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* submit card */}
        {connState === "ok" && (
          <div style={{ ...card, marginTop: 12 }} data-testid="workbench-agent-submit">
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-faint)", marginBottom: 9, letterSpacing: "0.03em" }}>
              <Icon name="play" style={{ width: 13, height: 13, verticalAlign: "-2px", marginRight: 5 }} />
              提交任务（白名单执行器）
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              <select aria-label="选择执行器" data-testid="workbench-agent-executor"
                value={executor} onChange={(e) => setExecutor(e.target.value)}
                style={{ border: "1px solid var(--border-subtle)", outline: "none", borderRadius: "var(--radius-sm)", padding: "9px 10px", background: "var(--bg-sunken)", fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--text-strong)" }}>
                {executors.map((x) => <option key={x.id} value={x.id}>{x.id} — {x.description}</option>)}
              </select>
              <textarea aria-label="任务输入 JSON" data-testid="workbench-agent-input"
                placeholder='{"path": "readme.md"}'
                value={inputJson} onChange={(e) => setInputJson(e.target.value)}
                rows={3}
                style={{ ...inputStyle, fontFamily: "monospace", fontSize: 12, resize: "vertical" }} />
              <div>
                <Button size="sm" variant="primary" data-testid="workbench-agent-submit-btn" onClick={submit} disabled={busy || !executor}>
                  提交执行
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* runs list */}
        {connState === "ok" && (
          <div style={{ marginTop: 16 }} data-testid="workbench-agent-runs">
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-muted)", marginBottom: 9 }}>
              执行记录（每 4 秒自动刷新）
            </div>
            {runs.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--text-faint)", padding: "18px 0" }}>
                还没有执行记录。提交一个白名单任务试试。
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                {runs.map((r) => {
                  const tone = RUN_STATUS_TONE[r.status] || RUN_STATUS_TONE.queued;
                  return (
                    <div key={r.runId} data-testid="workbench-agent-run" style={card}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <span data-testid="workbench-agent-run-status" style={{
                          flex: "none", fontSize: 11.5, fontWeight: 700, padding: "3px 10px",
                          borderRadius: "var(--radius-pill)", background: tone.bg, color: tone.color,
                        }}>
                          {RUN_STATUS_LABEL[r.status] || r.status}
                        </span>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-strong)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.executor}
                        </span>
                        <span style={{ flex: 1 }} />
                        <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{fmtTime(r.createdAt)}</span>
                      </div>
                      {r.summary && (
                        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.summary}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 8, marginTop: 9, flexWrap: "wrap" }}>
                        <button data-testid="workbench-agent-run-detail" onClick={() => openDetail(r.runId)}
                          style={{ border: "1px solid var(--border-subtle)", background: "transparent", color: "var(--text-body)", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "8px 12px", minHeight: 38, borderRadius: "var(--radius-sm)", fontFamily: "var(--font-sans)" }}>
                          查看结果
                        </button>
                        {(r.status === "queued" || r.status === "running") && (
                          <button data-testid="workbench-agent-run-cancel" onClick={() => cancelRun(r.runId)}
                            style={{ border: "1px solid var(--border-subtle)", background: "transparent", color: "var(--danger)", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "8px 12px", minHeight: 38, borderRadius: "var(--radius-sm)", fontFamily: "var(--font-sans)" }}>
                            取消
                          </button>
                        )}
                        {linkTask && (r.status === "completed" || r.status === "failed" || r.status === "timed_out" || r.status === "cancelled") && (
                          <select aria-label="关联到任务" data-testid="workbench-agent-run-link"
                            value=""
                            onChange={(e) => { if (e.target.value) linkTask(r.runId, e.target.value, r); }}
                            style={{ border: "1px solid var(--border-subtle)", background: "transparent", color: "var(--text-body)", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "8px 12px", minHeight: 38, borderRadius: "var(--radius-sm)", fontFamily: "var(--font-sans)", maxWidth: 180 }}>
                            <option value="">关联到任务…</option>
                            {linkableTasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                          </select>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* detail sheet (inline disclosure) */}
        {detailRun && (
          <div style={{ ...card, marginTop: 12 }} data-testid="workbench-agent-detail">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-strong)" }}>
                执行详情 {detailRun.runId.slice(0, 12)}…
              </span>
              <span style={{ flex: 1 }} />
              <button onClick={() => setDetailRun(null)} aria-label="关闭详情"
                style={{ border: "none", background: "transparent", cursor: "pointer", color: "var(--text-faint)", minWidth: 36, minHeight: 36, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <Icon name="x" style={{ width: 15, height: 15 }} />
              </button>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
              执行器：{detailRun.executor} · 状态：{RUN_STATUS_LABEL[detailRun.status] || detailRun.status}
            </div>
            {detailRun.error && (
              <div style={{ fontSize: 12.5, color: "var(--danger)", marginBottom: 8 }}>错误：{detailRun.error}</div>
            )}
            {detailRun.result && (
              <pre data-testid="workbench-agent-detail-result" style={{
                margin: "8px 0", padding: "10px 12px", borderRadius: "var(--radius-sm)",
                background: "var(--bg-sunken)", color: "var(--text-body)",
                fontSize: 11.5, lineHeight: 1.6, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all",
                maxHeight: 320, overflowY: "auto",
              }}>
                {typeof detailRun.result.output === "string"
                  ? detailRun.result.output
                  : JSON.stringify(detailRun.result.output, null, 2)}
              </pre>
            )}
            <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
              时间线：{detailRun.timeline.map((t) => t.type).join(" → ")}
            </div>
          </div>
        )}

        {/* safety note */}
        <div style={{ marginTop: 18, fontSize: 11.5, color: "var(--text-faint)", lineHeight: 1.7 }} data-testid="workbench-agent-safety">
          安全边界：网关默认只监听电脑本机（127.0.0.1）；手机访问需电脑端以 LAN 模式启动并使用配对 token。
          只能执行白名单内的只读任务（仓库状态/文档读取/本机概览），无法运行任意命令。
          每次执行都有审计记录（append-only）。
        </div>
      </div>
    </div>
  );
}
