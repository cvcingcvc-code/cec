// Gorgon Workbench — Phase B3: agent-gateway runs mirror (phone side).
//
// WHY: the PC gateway persists run records to scripts/.agent-gateway/runs.json
// on the WINDOWS machine. The phone can read them two ways:
//   1. LIVE over HTTP (AgentScreen — GET /v1/runs/:id, requires connection).
//   2. From a MIRROR copy the user pastes into Settings (this module).
//
// The mirror keeps the TaskDetail「电脑执行记录」card working even when the
// phone is offline: results from past sessions stay findable from the task
// itself, which is the whole point of closing the loop.
//
// FORMAT: the user pastes the JSON exported by the PC-side helper
// (`scripts/agent-gateway.mjs` runs.json or a trimmed array). We accept:
//   * an array of run records, or
//   * { runs: [...] }
// and keep ONLY the fields the task card renders (never store secrets — the
// pairing token is NOT part of run records).

const K_MIRROR = "gorgon_agent_runs_mirror";

const KEEP_FIELDS = ["runId", "executor", "status", "createdAt", "finishedAt", "summary", "error"];

/** Sanitize one run record to the card-renderable subset. */
function sanitizeRun(r) {
  if (!r || typeof r !== "object") return null;
  if (typeof r.runId !== "string" || !r.runId) return null;
  const out = {};
  for (const k of KEEP_FIELDS) {
    if (r[k] != null) out[k] = r[k];
  }
  // outputText: the bounded text the gateway returned (string form only)
  if (r.result && typeof r.result === "object") {
    if (typeof r.result.output === "string") out.outputText = r.result.output.slice(0, 4000);
    else if (r.result.output != null) {
      try { out.outputText = JSON.stringify(r.result.output, null, 2).slice(0, 4000); } catch (e) { /* skip */ }
    }
    if (!out.summary && typeof r.result.summary === "string") out.summary = r.result.summary;
  } else if (typeof r.outputText === "string") {
    out.outputText = r.outputText.slice(0, 4000);
  }
  return out;
}

/** Read the mirror (defensive; [] when absent/corrupt). */
export function readRunsMirror() {
  try {
    const raw = localStorage.getItem(K_MIRROR);
    if (!raw) return [];
    const j = JSON.parse(raw);
    const arr = Array.isArray(j) ? j : (j && Array.isArray(j.runs) ? j.runs : []);
    return arr.map(sanitizeRun).filter(Boolean);
  } catch (e) {
    return [];
  }
}

/** Read only the runs linked to a task's agentRunIds (order preserved). */
export function readAgentRunsMirror(agentRunIds) {
  const ids = Array.isArray(agentRunIds) ? agentRunIds.map(String) : [];
  if (!ids.length) return [];
  const all = readRunsMirror();
  const byId = new Map(all.map((r) => [r.runId, r]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

/**
 * Import a pasted mirror payload (Settings / Agent screen). NEVER merges
 * into existing records blindly: pasted runs replace by runId (upsert),
 * everything else is kept. Returns the number of runs stored.
 */
export function importRunsMirror(text) {
  let j;
  try { j = JSON.parse(String(text || "")); } catch (e) { return -1; }
  const arr = Array.isArray(j) ? j : (j && Array.isArray(j.runs) ? j.runs : null);
  if (!arr) return -1;
  const incoming = arr.map(sanitizeRun).filter(Boolean);
  if (!incoming.length) return -1;
  const existing = readRunsMirror();
  const byId = new Map(existing.map((r) => [r.runId, r]));
  for (const r of incoming) byId.set(r.runId, r); // upsert, never lose old
  const merged = Array.from(byId.values()).slice(0, 200);
  try {
    localStorage.setItem(K_MIRROR, JSON.stringify({ savedAt: new Date().toISOString(), runs: merged }));
    return merged.length;
  } catch (e) {
    return -1;
  }
}

/** Clear the mirror (user-initiated only). */
export function clearRunsMirror() {
  try { localStorage.removeItem(K_MIRROR); } catch (e) { /* no-op */ }
}
