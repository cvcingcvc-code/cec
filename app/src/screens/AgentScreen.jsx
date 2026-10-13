// Android agent interaction. Capabilities and run states come from the PC.
import React from "react";
import { Button } from "../lib/ds.js";
import { Icon } from "../components/Icon.jsx";
import { importRunsMirror, readRunsMirror } from "../lib/agent-runs-mirror.js";
import {
  executorLabel, getAvailability, getInputMode, buildTaskInput,
  isTerminalRun, runStatusLabel, runSummary, mergeRunsForMirror, createAgentClient,
} from "./agent-screen-model.js";

const K_GATEWAY = "gorgon_agent_gateway_url";
const K_TOKEN = "gorgon_agent_gateway_token";
const card = {
  background: "var(--surface-card)", border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-md)", padding: 16, minWidth: 0,
};
const inputStyle = {
  width: "100%", boxSizing: "border-box", minWidth: 0, minHeight: 48,
  border: "1px solid var(--border-default)", borderRadius: "var(--radius-sm)",
  padding: "10px 12px", background: "var(--bg-sunken)",
  fontFamily: "var(--font-sans)", fontSize: 16, color: "var(--text-strong)",
};
const buttonStyle = { minHeight: 48, whiteSpace: "normal", lineHeight: 1.4, transition: "none" };
const textStyle = { fontSize: 14, color: "var(--text-muted)", lineHeight: 1.7, overflowWrap: "anywhere" };
const preStyle = {
  margin: "8px 0", padding: 12, borderRadius: "var(--radius-sm)",
  background: "var(--bg-sunken)", color: "var(--text-body)", fontSize: 14,
  lineHeight: 1.7, whiteSpace: "pre-wrap", overflowWrap: "anywhere", minWidth: 0,
};
const EVENT_LABELS = {
  created: "任务已提交", queued: "任务已排队", started: "开始执行", running: "执行中",
  completed: "执行完成", failed: "执行失败", timed_out: "执行超时",
  cancel_requested: "已请求取消", cancelled: "已取消", recovered: "电脑恢复记录",
};

function fmtTime(iso) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return "时间未提供";
  return date.toLocaleString("zh-CN", { hour12: false });
}
function loadLocal(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function saveLocal(key, value) {
  try { localStorage.setItem(key, value); } catch { /* session remains usable */ }
}
function resultText(value) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

export function AgentScreen({ flash, linkTask = null, linkableTasks = [] }) {
  const [url, setUrl] = React.useState(() => loadLocal(K_GATEWAY, "http://192.168.1.100:8765"));
  const [token, setToken] = React.useState(() => loadLocal(K_TOKEN, ""));
  const [client, setClient] = React.useState(null);
  const [executors, setExecutors] = React.useState([]);
  const [executor, setExecutor] = React.useState("");
  const [documentPath, setDocumentPath] = React.useState("readme.md");
  const [inputJson, setInputJson] = React.useState("{}");
  const [inputError, setInputError] = React.useState("");
  const [runs, setRuns] = React.useState([]);
  const [details, setDetails] = React.useState({});
  const [detailId, setDetailId] = React.useState(null);
  const [requested, setRequested] = React.useState(new Set());
  const [busy, setBusy] = React.useState(false);
  const [connState, setConnState] = React.useState("idle");
  const [connError, setConnError] = React.useState("");
  const [refreshError, setRefreshError] = React.useState("");
  const [actionError, setActionError] = React.useState("");
  const [feedback, setFeedback] = React.useState("");
  const generation = React.useRef(0);
  const listRevision = React.useRef(0);
  const busyRef = React.useRef(false);
  const detailIdRef = React.useRef(detailId);
  const detailHeading = React.useRef(null);
  detailIdRef.current = detailId;

  React.useEffect(() => { saveLocal(K_GATEWAY, url); }, [url]);
  React.useEffect(() => { saveLocal(K_TOKEN, token); }, [token]);
  React.useEffect(() => () => { generation.current += 1; }, []);

  // Reuse the existing bounded mirror, including output already saved offline.
  React.useEffect(() => {
    if (connState !== "ok" || !runs.length) return;
    importRunsMirror(JSON.stringify({ runs: mergeRunsForMirror(runs, details, readRunsMirror()) }));
  }, [connState, runs, details]);
  React.useEffect(() => {
    if (detailId && details[detailId]) {
      detailHeading.current?.focus();
      detailHeading.current?.scrollIntoView({ block: "nearest" });
    }
  }, [detailId, !!details[detailId]]);

  const rememberRun = React.useCallback((run) => {
    setDetails((previous) => {
      // Gateway final states are immutable. Ignore an older in-flight response.
      if (isTerminalRun(previous[run.runId]) && previous[run.runId].status !== run.status) return previous;
      return { ...previous, [run.runId]: run };
    });
    setRuns((previous) => {
      const row = { ...run, summary: run.summary || run.result?.summary || run.error || "" };
      const existing = previous.find((item) => item.runId === run.runId);
      if (isTerminalRun(existing) && existing.status !== run.status) return previous;
      return existing ? previous.map((item) => item.runId === run.runId ? row : item) : [row, ...previous].slice(0, 20);
    });
    if (isTerminalRun(run) || runStatusLabel(run) === "已请求取消") setRequested((previous) => {
      const next = new Set(previous);
      if (isTerminalRun(run)) next.delete(run.runId);
      else next.add(run.runId);
      return next;
    });
  }, []);

  const handleError = (error, setter) => {
    setter(error.message || String(error));
    if (error.status === 401) {
      generation.current += 1;
      busyRef.current = false;
      setBusy(false);
      setClient(null);
      setConnState("error");
      setConnError(error.message);
    }
  };

  const refresh = React.useCallback(async (connection, session) => {
    const revision = ++listRevision.current;
    try {
      const [available, rows] = await Promise.all([connection.executors(), connection.runs()]);
      if (generation.current !== session || listRevision.current !== revision) return;
      setExecutors(available);
      setExecutor((previous) => available.some((item) => item.id === previous) ? previous
        : (available.find((item) => getAvailability(item).canSubmit) || available[0])?.id || "");
      setRuns((previous) => rows.map((row) => {
        const old = previous.find((item) => item.runId === row.runId);
        return isTerminalRun(old) && !isTerminalRun(row) ? old : row;
      }));
      setRequested((previous) => new Set([...previous].filter((id) => !rows.some((row) => row.runId === id && isTerminalRun(row)))));
      setRefreshError("");
      const opened = detailIdRef.current;
      if (opened) {
        const run = await connection.run(opened);
        if (generation.current === session && listRevision.current === revision) rememberRun(run);
      }
    } catch (error) {
      if (generation.current === session && listRevision.current === revision) handleError(error, setRefreshError);
    }
  }, [rememberRun]);

  React.useEffect(() => {
    if (!client || connState !== "ok") return undefined;
    let stop = false;
    let timer;
    const session = generation.current;
    const tick = async () => {
      await refresh(client, session);
      if (!stop && generation.current === session) timer = setTimeout(tick, 4000);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [client, connState, refresh]);

  const disconnect = () => {
    generation.current += 1;
    busyRef.current = false;
    setBusy(false);
    setClient(null);
    setConnState("idle");
    setConnError("");
    setExecutors([]);
    setRuns([]);
    setDetails({});
    setDetailId(null);
    setRequested(new Set());
    setActionError("");
    setRefreshError("");
    setFeedback("配对信息已修改，请重新连接电脑。");
  };
  const connect = async () => {
    if (busyRef.current) return;
    const session = ++generation.current;
    busyRef.current = true;
    setBusy(true);
    setClient(null);
    setConnState("connecting");
    setConnError("");
    setActionError("");
    setRefreshError("");
    setFeedback("");
    setDetailId(null);
    setDetails({});
    setRuns([]);
    setRequested(new Set());
    try {
      const connection = createAgentClient(url, token.trim());
      await connection.health();
      const available = await connection.executors();
      if (generation.current !== session) return;
      setExecutors(available);
      setExecutor((previous) => available.some((item) => item.id === previous) ? previous
        : (available.find((item) => getAvailability(item).canSubmit) || available[0])?.id || "");
      setClient(connection);
      setConnState("ok");
      setFeedback("已连接电脑，请选择要做的事。");
      flash?.("已连接电脑");
    } catch (error) {
      if (generation.current === session) { setConnState("error"); setConnError(error.message || String(error)); }
    } finally {
      if (generation.current === session) { busyRef.current = false; setBusy(false); }
    }
  };

  const selected = executors.find((item) => item.id === executor);
  const availability = getAvailability(selected);
  const inputMode = getInputMode(selected);
  const submit = async () => {
    if (!client || !selected || !availability.canSubmit || busyRef.current) return;
    setActionError(""); setInputError(""); setFeedback("");
    try { buildTaskInput(selected, { documentPath, inputJson }); }
    catch (error) { setInputError(error.message); return; }
    const session = generation.current;
    busyRef.current = true; setBusy(true);
    try {
      // Recheck the real capability just before submission; do not rely on a
      // CLI availability value from an earlier connection.
      const available = await client.executors();
      if (generation.current !== session) return;
      setExecutors(available);
      const actual = available.find((item) => item.id === executor);
      if (!actual || !getAvailability(actual).canSubmit) throw new Error("这项任务目前不可用，请刷新状态或在电脑上检查配置。");
      const input = buildTaskInput(actual, { documentPath, inputJson });
      const response = await client.submit(actual.id, input);
      if (generation.current !== session) return;
      setFeedback("任务已提交，电脑返回的执行状态会显示在下方记录中。");
      flash?.("任务已提交");
      rememberRun({ runId: response.runId, executor: actual.id, status: response.status });
      await refresh(client, session);
    } catch (error) {
      if (generation.current === session) handleError(error, (message) => setActionError(`提交失败：${message} 如未收到确认，请先刷新执行记录再重试。`));
    } finally {
      if (generation.current === session) { busyRef.current = false; setBusy(false); }
    }
  };
  const openDetail = async (runId) => {
    if (!client || busyRef.current) return;
    const session = generation.current;
    busyRef.current = true; setBusy(true); setActionError("");
    try {
      const run = await client.run(runId);
      if (generation.current !== session) return;
      rememberRun(run); setDetailId(runId);
    } catch (error) {
      if (generation.current === session) handleError(error, (message) => setActionError(`读取结果失败：${message}`));
    } finally {
      if (generation.current === session) { busyRef.current = false; setBusy(false); }
    }
  };
  const cancelRun = async (runId) => {
    if (!client || busyRef.current) return;
    const session = generation.current;
    busyRef.current = true; setBusy(true); setActionError(""); setFeedback("");
    try {
      const response = await client.cancel(runId);
      if (generation.current !== session) return;
      if (response.cancelRequested === true && !isTerminalRun(response)) {
        setRequested((previous) => new Set([...previous, runId]));
        setFeedback("已请求取消，正在等待电脑确认。只有电脑返回取消终态后才会显示「已取消」。");
        flash?.("已请求取消");
      } else {
        setFeedback(isTerminalRun(response) ? `电脑返回：${runStatusLabel(response)}。` : "取消请求已发送，请刷新记录确认状态。");
      }
      const run = await client.run(runId);
      if (generation.current !== session) return;
      rememberRun(run);
      if (isTerminalRun(run)) setFeedback(`电脑返回：${runStatusLabel(run)}。`);
    } catch (error) {
      if (generation.current === session) handleError(error, (message) => setActionError(`取消或查询状态失败：${message} 请刷新记录确认，勿将请求成功视为已经取消。`));
    } finally {
      if (generation.current === session) { busyRef.current = false; setBusy(false); }
    }
  };

  const refreshNow = async () => {
    if (!client || busyRef.current) return;
    const session = generation.current;
    busyRef.current = true; setBusy(true);
    try { await refresh(client, session); }
    finally {
      if (generation.current === session) { busyRef.current = false; setBusy(false); }
    }
  };

  const detailRun = details[detailId];
  const taskLabel = (id) => executorLabel(executors.find((item) => item.id === id) || id);
  const linkedNames = (run) => linkableTasks.filter((task) => task.agentRunIds?.includes(run.runId)).map((task) => task.title);
  const linkControl = (run) => linkTask && isTerminalRun(run) && (
    <div style={{ marginTop: 8 }}>
      {linkedNames(run).length > 0 && <p style={textStyle}>已关联：{linkedNames(run).join("、")}</p>}
      {linkableTasks.length ? (
        <label style={textStyle}>关联已有任务
          <select aria-label="关联到任务" data-testid="workbench-agent-run-link" value="" style={inputStyle}
            onChange={(event) => {
              if (!event.target.value) return;
              const full = mergeRunsForMirror([run], details, readRunsMirror())[0];
              importRunsMirror(JSON.stringify({ runs: [full] }));
              linkTask(run.runId, event.target.value, { ...full, summary: full.summary || full.result?.summary || "" });
            }}>
            <option value="">选择要关联的任务…</option>
            {linkableTasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
          </select>
        </label>
      ) : <p style={textStyle}>还没有本地任务。可先到任务页创建，再将这份结果关联进去。</p>}
    </div>
  );
  const statusBadge = (run) => {
    const label = runStatusLabel(run, requested.has(run.runId));
    const danger = ["failed", "timed_out"].includes(run.status);
    return <span data-testid="workbench-agent-run-status" style={{
      fontSize: 14, fontWeight: 700, padding: "4px 10px", borderRadius: "var(--radius-pill)",
      background: danger ? "var(--danger-soft)" : "var(--bg-sunken)",
      color: danger ? "var(--danger)" : "var(--text-strong)",
    }}>{label}</span>;
  };

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }} data-gg-screen="workbench-agent">
      <div style={{ padding: "24px 16px 40px", boxSizing: "border-box", maxWidth: 860, margin: "0 auto", width: "100%" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--text-strong)", margin: "0 0 8px" }}>智能体</h1>
        <p style={{ ...textStyle, margin: "0 0 16px" }}>让电脑帮你查看项目、阅读文档或分析问题，执行进度和结果都留在记录里。</p>

        <section style={card} data-testid="workbench-agent-conn" aria-labelledby="agent-connect-title">
          <h2 id="agent-connect-title" style={{ fontSize: 18, color: "var(--text-strong)", margin: "0 0 8px" }}>连接你的电脑</h2>
          <p style={textStyle}>手机和电脑需在同一网络。在电脑上启动连接服务，将电脑地址和配对码填到这里。</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <label style={textStyle}>电脑地址
              <input aria-label="网关地址" data-testid="workbench-agent-url" placeholder="http://192.168.x.x:8765"
                value={url} onChange={(event) => { disconnect(); setUrl(event.target.value); }} style={inputStyle}
                inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            </label>
            <label style={textStyle}>配对码（由电脑提供）
              <input aria-label="配对码" data-testid="workbench-agent-token" type="password" placeholder="粘贴电脑提供的配对码"
                value={token} onChange={(event) => { disconnect(); setToken(event.target.value); }} style={inputStyle}
                autoCapitalize="off" autoCorrect="off" spellCheck={false} autoComplete="off" />
            </label>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Button size="sm" style={buttonStyle} data-testid="workbench-agent-connect" onClick={connect} disabled={busy || !url.trim() || !token.trim()}>
                {connState === "connecting" ? "正在连接…" : connState === "ok" ? "重新连接" : "连接电脑"}
              </Button>
              {connState === "ok" && <span data-testid="workbench-agent-conn-ok" style={textStyle}>已连接电脑 · {executors.length} 项任务</span>}
            </div>
            {connState === "error" && <p role="alert" data-testid="workbench-agent-conn-error" style={{ ...textStyle, color: "var(--danger)", margin: 0 }}>连接失败：{connError}</p>}
          </div>
        </section>

        {connState === "ok" && (
          <section style={{ ...card, marginTop: 16 }} data-testid="workbench-agent-submit" aria-labelledby="agent-submit-title">
            <h2 id="agent-submit-title" style={{ fontSize: 18, color: "var(--text-strong)", margin: "0 0 12px" }}>想让电脑做什么</h2>
            {executors.length === 0 ? <p style={textStyle}>电脑没有提供可执行任务。请检查电脑配置后刷新状态。</p> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <label style={textStyle}>选择一项任务
                  <select aria-label="想让电脑做什么" data-testid="workbench-agent-executor" value={executor} style={inputStyle}
                    onChange={(event) => { setExecutor(event.target.value); setInputError(""); setActionError(""); setFeedback(""); }}>
                    {executors.map((item) => <option key={item.id} value={item.id}>{executorLabel(item)}{getAvailability(item).canSubmit ? "" : "（暂不可用）"}</option>)}
                  </select>
                </label>
                <div data-testid="workbench-agent-availability" style={textStyle}>
                  <strong style={{ color: availability.canSubmit ? "var(--text-strong)" : "var(--danger)" }}>{availability.label}</strong>
                  <div>{availability.detail}</div>
                </div>
                {inputMode === "none" && <p style={{ ...textStyle, margin: 0 }}>这项任务不需要填写参数，点一次即可提交。</p>}
                {inputMode === "document" && <label style={textStyle}>要阅读的文档
                  <input aria-label="文档路径" data-testid="workbench-agent-document-path" value={documentPath}
                    onChange={(event) => { setDocumentPath(event.target.value); setInputError(""); }} style={inputStyle}
                    placeholder="readme.md 或 docs/ROADMAP.md" autoCapitalize="off" spellCheck={false}
                    aria-invalid={!!inputError} aria-describedby="agent-input-hint agent-input-error" />
                  <span id="agent-input-hint">填写项目内的文档路径，支持 readme.md 或 docs/ 下的 Markdown 文档。</span>
                </label>}
                {inputMode === "json" && <label style={textStyle}>任务参数（高级）
                  <span style={{ display: "block" }}>这项任务需要电脑指定的参数，请按下方参数说明填写。</span>
                  <textarea aria-label="任务输入 JSON" data-testid="workbench-agent-input" rows={4} value={inputJson}
                    onChange={(event) => { setInputJson(event.target.value); setInputError(""); }}
                    style={{ ...inputStyle, resize: "vertical" }} aria-invalid={!!inputError} aria-describedby="agent-input-error" />
                </label>}
                {inputError && <p id="agent-input-error" role="alert" data-testid="workbench-agent-input-error" style={{ ...textStyle, color: "var(--danger)", margin: 0 }}>{inputError}</p>}
                <details style={textStyle}>
                  <summary style={{ cursor: "pointer", minHeight: 48, display: "list-item" }}>查看电脑提供的任务说明</summary>
                  <p>{selected?.description}</p>
                  <pre style={preStyle}>{JSON.stringify({ id: selected?.id, agent: selected?.agent, availability: selected?.availability, input: selected?.input }, null, 2)}</pre>
                </details>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Button size="sm" style={buttonStyle} data-testid="workbench-agent-submit-btn" onClick={submit} disabled={busy || !selected || !availability.canSubmit}>
                    {busy ? "正在处理…" : inputMode === "none" ? "一键执行" : "开始执行"}
                  </Button>
                  <Button size="sm" style={buttonStyle} variant="secondary" data-testid="workbench-agent-refresh" disabled={busy}
                    onClick={refreshNow}>刷新状态</Button>
                </div>
              </div>
            )}
            {executors.length === 0 && <Button style={buttonStyle} variant="secondary" data-testid="workbench-agent-refresh" disabled={busy}
              onClick={refreshNow}>刷新状态</Button>}
          </section>
        )}

        {feedback && <p role="status" data-testid="workbench-agent-feedback" style={textStyle}>{feedback}</p>}
        {actionError && <p role="alert" data-testid="workbench-agent-action-error" style={{ ...textStyle, color: "var(--danger)" }}>{actionError}</p>}
        {refreshError && <p role="alert" style={{ ...textStyle, color: "var(--danger)" }}>刷新失败：{refreshError} 当前显示的是上次收到的记录，可点「刷新状态」重试。</p>}

        {detailRun && (
          <section style={{ ...card, marginTop: 16 }} data-testid="workbench-agent-detail" aria-labelledby="agent-detail-title">
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <h2 id="agent-detail-title" ref={detailHeading} tabIndex={-1} style={{ fontSize: 18, color: "var(--text-strong)", margin: 0 }}>执行结果 · {taskLabel(detailRun.executor)}</h2>
              <Button style={buttonStyle} variant="ghost" onClick={() => setDetailId(null)} aria-label="关闭详情">关闭</Button>
            </div>
            <p>{statusBadge(detailRun)}</p>
            {runSummary(detailRun) && <p style={textStyle}>{runSummary(detailRun)}</p>}
            {detailRun.error && <p role="alert" style={{ ...textStyle, color: "var(--danger)" }}>电脑返回的错误：{detailRun.error}</p>}
            {detailRun.result != null ? (
              <div>
                <h3 style={{ ...textStyle, fontWeight: 700 }}>完整输出（电脑返回的内容）</h3>
                <pre data-testid="workbench-agent-detail-result" style={preStyle}>{resultText(detailRun.result.output ?? detailRun.result)}</pre>
                {detailRun.result.meta && <details style={textStyle}><summary style={{ cursor: "pointer", minHeight: 48 }}>执行附加信息</summary><pre style={preStyle}>{resultText(detailRun.result.meta)}</pre></details>}
              </div>
            ) : <p style={textStyle}>{isTerminalRun(detailRun) ? "电脑没有返回结果内容，请查看状态和错误说明。" : "结果尚未返回，页面会自动查询进度。"}</p>}
            {linkControl(detailRun)}
            <h3 style={{ ...textStyle, fontWeight: 700 }}>执行过程</h3>
            {Array.isArray(detailRun.timeline) && detailRun.timeline.length ? (
              <ol style={{ ...textStyle, paddingLeft: 24 }}>
                {detailRun.timeline.map((event, index) => <li key={`${event.ts}-${index}`} style={{ marginBottom: 8 }}>
                  <strong>{EVENT_LABELS[event.type] || "电脑记录"}</strong> · {fmtTime(event.ts)}
                  {event.message && <div>{event.message}</div>}
                </li>)}
              </ol>
            ) : <p style={textStyle}>电脑尚未提供过程记录。</p>}
            <details style={textStyle}>
              <summary style={{ cursor: "pointer", minHeight: 48 }}>查看完整原始执行记录</summary>
              <pre style={preStyle}>{JSON.stringify(detailRun, null, 2)}</pre>
            </details>
          </section>
        )}

        {connState === "ok" && (
          <section style={{ marginTop: 24 }} data-testid="workbench-agent-runs" aria-labelledby="agent-runs-title">
            <h2 id="agent-runs-title" style={{ fontSize: 18, color: "var(--text-strong)", marginBottom: 8 }}>最近执行记录</h2>
            <p style={textStyle}>约每 4 秒查询电脑。取消请求需要电脑确认，记录以电脑返回的状态为准。</p>
            {runs.length === 0 ? <p style={textStyle}>还没有执行记录。选择一项可用任务，点击执行即可。</p> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {runs.map((run) => <article key={run.runId} data-testid="workbench-agent-run" style={card}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {statusBadge(run)}<strong style={{ ...textStyle, color: "var(--text-strong)" }}>{taskLabel(run.executor)}</strong>
                  </div>
                  <p style={textStyle}>{fmtTime(run.createdAt)}</p>
                  {runSummary(run) && <p style={textStyle}>{runSummary(run)}</p>}
                  {run.error && <p style={{ ...textStyle, color: "var(--danger)" }}>电脑返回的错误：{run.error}</p>}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Button variant="secondary" size="sm" style={buttonStyle} data-testid="workbench-agent-run-detail" disabled={busy} onClick={() => openDetail(run.runId)}>查看完整结果</Button>
                    {["queued", "running"].includes(run.status) && <Button variant="secondary" size="sm" style={{ ...buttonStyle, color: "var(--danger)" }}
                      data-testid="workbench-agent-run-cancel" disabled={busy || runStatusLabel(run, requested.has(run.runId)) === "已请求取消"} onClick={() => cancelRun(run.runId)}>
                      {runStatusLabel(run, requested.has(run.runId)) === "已请求取消" ? "已请求取消" : "请求取消"}
                    </Button>}
                  </div>
                  {linkControl(run)}
                </article>)}
              </div>
            )}
          </section>
        )}

        <p style={{ ...textStyle, marginTop: 24 }} data-testid="workbench-agent-safety">
          <Icon name="shield-check" aria-hidden="true" style={{ width: 16, height: 16, verticalAlign: "-3px", marginRight: 6 }} />
          手机只提交电脑提供的获准任务，每次执行都有记录。当前任务用于只读查看与分析，不能输入任意命令。
          结果可关联到本地任务；已读取的记录会沿用现有离线镜像保存。
        </p>
      </div>
    </div>
  );
}
