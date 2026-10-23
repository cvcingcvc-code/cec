// Presentation and HTTP contract for the Android agent screen only.
const TASK_LABELS = {
  "repo.status": "查看项目状态",
  "repo.readDoc": "阅读项目文档",
  "host.stats": "查看电脑概况",
  "codex.readonly-diagnosis": "让 Codex 分析项目（只读）",
  "workbuddy.status": "查看 WorkBuddy 运行状态",
  "workbuddy.launch": "启动 WorkBuddy 桌面版",
};

export function executorLabel(executor) {
  const id = typeof executor === "string" ? executor : executor?.id;
  return TASK_LABELS[id] || executor?.description || id || "未知任务";
}

export function getAvailability(executor) {
  const code = executor?.availability;
  if (code === "AVAILABLE") {
    const isTool = executor.agent !== "gateway";
    return {
      code, canSubmit: true,
      label: isTool ? "可尝试执行 · 模型调用待验证" : "可用 · 电脑只读操作",
      detail: executor.agent === "codex"
        ? "电脑已检测到 Codex 工具。模型调用、登录、网络和额度尚未验证，执行结果以电脑返回的记录为准。"
        : executor.agent === "workbuddy"
          ? "电脑已检测到 WorkBuddy 桌面版。启动/状态为真实进程操作；WorkBuddy 没有已验证的任务接口，不能远程下达任务。"
          : isTool ? "电脑报告此工具可用；是否能成功调用模型，需要实际执行后确认。"
            : "由电脑直接读取信息，不调用 AI 模型。",
    };
  }
  return {
    code: code || "UNKNOWN", canSubmit: false,
    label: code === "UNAVAILABLE" ? "暂不可用" : "可用状态未确认",
    detail: code === "UNAVAILABLE"
      ? "电脑尚未检测到可用工具。请在电脑上检查配置，再点刷新状态。"
      : "电脑没有返回已确认的可用状态。请刷新状态后再试。",
  };
}

export function getInputMode(executor) {
  const input = executor?.input;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    if (Object.keys(input).length === 0) return "none";
    if (executor.id === "repo.readDoc" && Object.keys(input).length === 1 && "path" in input) return "document";
  }
  return "json";
}

export function buildTaskInput(executor, { documentPath = "", inputJson = "{}" } = {}) {
  const mode = getInputMode(executor);
  if (mode === "none") return {};
  if (mode === "document") {
    if (!documentPath.trim()) throw new Error("请填写要阅读的文档路径，例如 readme.md。");
    return { path: documentPath.trim() };
  }
  let input;
  try { input = JSON.parse(inputJson); }
  catch { throw new Error("任务参数格式有误，请填写有效的 JSON 对象。"); }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("任务参数必须是 JSON 对象，不能是数组、空值或普通文本。");
  }
  return input;
}

const STATUS_LABELS = {
  queued: "排队中", running: "执行中", completed: "已完成", failed: "执行失败",
  timed_out: "已超时", cancelled: "已取消",
};
export function isTerminalRun(run) {
  return ["completed", "failed", "timed_out", "cancelled"].includes(run?.status);
}
export function runStatusLabel(run, requested = false) {
  if (isTerminalRun(run)) return STATUS_LABELS[run.status];
  if (requested || run?.cancelRequested === true || run?.timeline?.some((event) => event.type === "cancel_requested")) {
    return "已请求取消";
  }
  return STATUS_LABELS[run?.status] || "状态待确认";
}

export function runSummary(run) {
  const summary = run?.summary || run?.result?.summary || "";
  if (summary === "git status (porcelain+b)") return "已读取项目分支和文件变更情况";
  if (summary === "host overview") return "已读取电脑系统、处理器和内存情况";
  return summary;
}

// V3L Phase D: fetch the handoff record for a resumable run. Returns a
// discriminated result — never throws — so the screen can render the real
// blocker for completed/cancelled runs (409) instead of a generic error.
export function addHandoffClient(client) {
  return {
    ...client,
    async handoff(runId) {
      try {
        const data = await client.requestRaw(`/v1/runs/${encodeURIComponent(runId)}/handoff`, "GET");
        return { kind: "ok", handoff: data.handoff };
      } catch (error) {
        if (error.status === 409) return { kind: "not_resumable", message: error.message };
        return { kind: "error", message: error.message };
      }
    },
  };
}

// The list endpoint omits output. Preserve fetched detail and the existing
// bounded offline mirror without letting an old detail override fresh status.
export function mergeRunsForMirror(rows, details, previousMirror = []) {
  const previous = new Map(previousMirror.map((run) => [run.runId, run]));
  return rows.map((row) => {
    const detail = details[row.runId];
    const saved = previous.get(row.runId);
    const base = detail?.status === row.status ? detail : saved?.status === row.status ? saved : {};
    return { ...base, ...row };
  });
}

// ── V3L P0 fix: Android WebView is https://localhost (Capacitor androidScheme),
// so a fetch() to an http:// LAN gateway is MIXED CONTENT and the WebView
// blocks it before any packet leaves the device. The secure local-connection
// path is CapacitorHttp — the request goes through the NATIVE HTTP stack
// (HttpURLConnection), which never applies the WebView's mixed-content or
// CORS rules and keeps the token header intact. Strategy:
//   * Native shell + http:// URL  -> CapacitorHttp.request (native stack).
//   * Everything else (web preview, https URLs) -> unchanged fetch().
// No global CapacitorHttp fetch patching, no allowMixedContent, no
// server.cleartext: the WebView never sees the cleartext request at all.
function capacitorHttpAvailable() {
  return !!(
    typeof window !== "undefined" &&
    window.Capacitor &&
    window.Capacitor.isNativePlatform &&
    window.Capacitor.isNativePlatform() &&
    window.Capacitor.Plugins &&
    window.Capacitor.Plugins.CapacitorHttp
  );
}

async function nativeRequest(CapHttp, url, { method, headers, body, timeoutMs }) {
  // CapacitorHttp returns { status, data, headers, url } and THROWS a
  // CapacitorException on connection failures — map both to the same
  // discriminated contract the fetch path uses.
  try {
    const response = await CapHttp.request({
      url,
      method,
      headers,
      ...(body !== undefined ? { data: body } : {}),
      // Android native reads call.getInt("connectTimeout"/"readTimeout") —
      // millisecond values under these exact names.
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
    });
    let payload = response.data;
    if (typeof payload === "string") {
      try { payload = JSON.parse(payload); } catch { /* report HTTP status below */ }
    }
    const okStatus = response.status >= 200 && response.status < 300;
    if (!okStatus || !payload?.ok) {
      const message = response.status === 401 ? "配对码不正确或已失效，请检查电脑上的配对码。"
        : payload?.error || `电脑返回异常（HTTP ${response.status}）`;
      throw Object.assign(new Error(message), { status: response.status });
    }
    return payload;
  } catch (error) {
    // Re-throw our own contract errors untouched.
    if (error && typeof error.status === "number") throw error;
    const message = String(error?.message || error);
    throw new Error(`无法联系电脑，请检查电脑服务和网络连接（${message.slice(0, 120)}）。`);
  }
}

export function createAgentClient(url, token, fetchImpl = globalThis.fetch) {
  const base = String(url).trim().replace(/\/+$/, "");
  let parsed;
  try { parsed = new URL(base); } catch { throw new Error("电脑地址格式不正确，请填写完整的 http:// 或 https:// 地址。"); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("请填写 http:// 或 https:// 电脑地址，不要附带密码、查询参数或锚点。");
  }
  // Only plain-http gateways need the native path on Android; https URLs are
  // never mixed content and keep the standard fetch path everywhere.
  const useNativeOnDevice = parsed.protocol === "http:" && capacitorHttpAvailable();
  async function request(path, method = "GET", body, authenticated = true) {
    const fullUrl = `${base}${path}`;
    const headers = {
      ...(authenticated ? { "X-Gorgon-Token": token } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    };
    if (useNativeOnDevice) {
      return nativeRequest(window.Capacitor.Plugins.CapacitorHttp, fullUrl, {
        method, headers, timeoutMs: 15000,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetchImpl(fullUrl, {
        method, signal: controller.signal,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      let payload;
      try { payload = await response.json(); } catch { /* report HTTP status below */ }
      if (!response.ok || !payload?.ok) {
        const message = response.status === 401 ? "配对码不正确或已失效，请检查电脑上的配对码。"
          : payload?.error || `电脑返回异常（HTTP ${response.status}）`;
        throw Object.assign(new Error(message), { status: response.status });
      }
      return payload;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("电脑响应超时，请检查连接并刷新执行记录。");
      if (error instanceof TypeError) throw new Error("无法联系电脑，请检查电脑服务和网络连接。");
      throw error;
    } finally { clearTimeout(timeout); }
  }
  return {
    health: () => request("/health", "GET", undefined, false),
    async executors() {
      const data = await request("/v1/executors");
      if (!Array.isArray(data.executors) || data.executors.some((item) => !item || typeof item.id !== "string" || !item.id)) {
        throw new Error("电脑返回的任务列表格式异常。");
      }
      return data.executors;
    },
    async runs() {
      const data = await request("/v1/runs?limit=20");
      if (!Array.isArray(data.runs)) throw new Error("电脑返回的执行记录格式异常。");
      return data.runs;
    },
    async run(runId) {
      const data = await request(`/v1/runs/${encodeURIComponent(runId)}`);
      if (!data.run || data.run.runId !== runId) throw new Error("电脑返回的执行详情格式异常。");
      return data.run;
    },
    async submit(executor, input) {
      const data = await request("/v1/runs", "POST", { executor, input });
      if (typeof data.runId !== "string" || !data.runId) throw new Error("电脑没有返回执行编号，请刷新记录确认是否已提交。");
      return data;
    },
    cancel: (runId) => request(`/v1/runs/${encodeURIComponent(runId)}/cancel`, "POST"),
    /** Raw request for sibling helpers (addHandoffClient). Same auth/timeout. */
    requestRaw: request,
  };
}
