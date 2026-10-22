#!/usr/bin/env node
// Gorgon Workbench — PC Agent Controller V1 (V3L): WorkBuddy wbipc client.
//
// WHAT THIS IS
// ------------
// A minimal, verified client for the WorkBuddy desktop app's OFFICIAL local
// IPC channel ("wbipc"): a named pipe (\\.\pipe\wbipc-*) discovered via
// %USERPROFILE%\.workbuddy\wbipc\endpoint.json.
//
// PROTOCOL (reverse-engineered from the app bundle and VERIFIED against the
// live app on this machine — see docs/V3L_PC_AGENT_CONTROLLER_GUIDE.md):
//   1. client -> {type:"session_hello", protocol_min:1, protocol_max:1,
//                 session_id, client_nonce, ticket_id(=sha256(ticket)[0:16]hex),
//                 client:{kind,id,version}}
//   2. server -> {type:"session_challenge", server_nonce, server_proof}
//      server_proof = b64url(HMAC-SHA256(key=ticket, transcript("server",...)))
//      transcript    = {protocol:1, endpoint, clientNonce, serverNonce}
//      transcript encoding: for each of [role_tag, protocol, endpoint,
//        clientNonce, serverNonce] -> 4-byte BE length + utf8 bytes, concat
//      role_tag: "wbipc-s" (server) | "wbipc-c" (client)
//   3. client -> {type:"session_prove", client_proof=HMAC(key=ticket,"client",...)}
//   4. server -> {type:"session_hello_ack", connection_epoch, max_inflight, pipes}
//
// RPC (JSON-RPC 2.0 frames, same JSON+\n encoding):
//   broker/GetPipe {pipe} -> {channel:"c:<name>", methods:[...]}
//   <channel>/<method> with mode:"call" -> result (wb.request/http.fetch
//   proxies to the WorkBuddy cloud API with the USER's own login session).
//
// SECURITY BOUNDARY
//   * ticket comes from the local endpoint.json written by WorkBuddy itself —
//     it never leaves this machine (the Gateway runs locally).
//   * only read-only operations are exposed (GET requests / status probes).
//   * no third-party API keys are involved or forwarded.

import { connect } from "node:net";
import { createHmac, createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PROTOCOL_VERSION = 1;
const CONNECT_TIMEOUT_MS = 5000;
const FRAME_TIMEOUT_MS = 8000;

export function wbipcEndpointPath(configDir) {
  const dir = configDir || path.join(os.homedir(), ".workbuddy");
  return path.join(dir, "wbipc", "endpoint.json");
}

export function readWbipcEndpoint(configDir) {
  const p = wbipcEndpointPath(configDir);
  let raw;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch {
    return { ok: false, error: `wbipc endpoint.json not found at ${p} (WorkBuddy 未运行或版本过旧)` };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: `wbipc endpoint.json is malformed at ${p}` };
  }
  if (!parsed || typeof parsed.endpoint !== "string" || typeof parsed.ticket !== "string" || !parsed.endpoint || !parsed.ticket) {
    return { ok: false, error: "wbipc endpoint.json missing endpoint or ticket" };
  }
  return { ok: true, endpoint: parsed.endpoint, ticket: parsed.ticket };
}

function encodeTranscript(role, t) {
  const parts = [
    role === "server" ? "wbipc-s" : "wbipc-c",
    String(t.protocol),
    t.endpoint,
    t.clientNonce,
    t.serverNonce,
  ];
  const chunks = [];
  for (const part of parts) {
    const b = Buffer.from(part, "utf8");
    const len = Buffer.alloc(4);
    len.writeUInt32BE(b.length, 0);
    chunks.push(len, b);
  }
  return Buffer.concat(chunks);
}

function computeProof(key, role, t) {
  return createHmac("sha256", Buffer.from(key, "utf8"))
    .update(encodeTranscript(role, t))
    .digest("base64url");
}

function ticketId(tk) {
  return createHash("sha256").update(tk, "utf8").digest("hex").slice(0, 16);
}

/**
 * Connect to the wbipc broker, complete the HMAC challenge-response
 * handshake, and return a { sock, ack, call } client.
 * call(method, params, {timeoutMs, mode}) sends JSON-RPC frames and returns
 * the matching result (throws on {error}).
 */
export async function wbipcConnect(configDir, { sessionId } = {}) {
  const ep = readWbipcEndpoint(configDir);
  if (!ep.ok) {
    const err = new Error(ep.error);
    err.code = "WBIPC_NO_ENDPOINT";
    throw err;
  }
  const { endpoint, ticket } = ep;

  const sock = connect(endpoint);
  sock.setNoDelay(true);
  let buf = Buffer.alloc(0);
  const queue = [];
  let waiter = null;

  function pushData(chunk) {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const idx = buf.indexOf(0x0a);
      if (idx < 0) break;
      const line = buf.subarray(0, idx).toString("utf8");
      buf = buf.subarray(idx + 1);
      if (!line.trim()) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      if (waiter) { const w = waiter; waiter = null; w(obj); continue; }
      queue.push(obj);
    }
  }

  function nextFrame(timeoutMs) {
    if (queue.length > 0) return Promise.resolve(queue.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiter = null;
        reject(Object.assign(new Error("wbipc: timeout waiting for frame"), { code: "WBIPC_TIMEOUT" }));
      }, timeoutMs);
      waiter = (f) => { clearTimeout(timer); resolve(f); };
    });
  }

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error("wbipc: connect timeout"), { code: "WBIPC_CONNECT_TIMEOUT" })), CONNECT_TIMEOUT_MS);
    sock.on("connect", () => { clearTimeout(timer); resolve(); });
    sock.on("error", (e) => { clearTimeout(timer); reject(Object.assign(new Error(`wbipc: pipe connect failed: ${e.message}`), { code: "WBIPC_CONNECT_FAILED" })); });
  });
  sock.on("data", pushData);

  const clientNonce = randomBytes(16).toString("base64url");
  sock.write(JSON.stringify({
    type: "session_hello",
    protocol_min: PROTOCOL_VERSION,
    protocol_max: PROTOCOL_VERSION,
    session_id: sessionId || `gorgon-controller-${randomBytes(4).toString("hex")}`,
    client_nonce: clientNonce,
    ticket_id: ticketId(ticket),
    client: { kind: "gorgon-agent-controller", id: "gateway", version: "1.0.0" },
  }) + "\n");

  let challenge;
  try {
    challenge = await nextFrame(FRAME_TIMEOUT_MS);
  } catch (e) {
    sock.destroy();
    throw e;
  }
  if (challenge.type !== "session_challenge") {
    sock.destroy();
    throw Object.assign(new Error(`wbipc: expected session_challenge, got ${challenge.type || JSON.stringify(challenge).slice(0, 80)}`), { code: "WBIPC_BAD_HANDSHAKE" });
  }
  const transcript = { protocol: PROTOCOL_VERSION, endpoint, clientNonce, serverNonce: challenge.server_nonce };
  sock.write(JSON.stringify({ type: "session_prove", client_proof: computeProof(ticket, "client", transcript) }) + "\n");

  let ack = null;
  for (let i = 0; i < 5; i++) {
    let f;
    try {
      f = await nextFrame(FRAME_TIMEOUT_MS);
    } catch (e) {
      break;
    }
    if (f.type === "session_hello_ack") { ack = f; break; }
    if (f.type === "session_hello_error") {
      sock.destroy();
      throw Object.assign(new Error(`wbipc: handshake rejected: ${f.code}`), { code: "WBIPC_AUTH_FAILED", detail: f.code });
    }
  }
  if (!ack) {
    sock.destroy();
    throw Object.assign(new Error("wbipc: no session_hello_ack received"), { code: "WBIPC_NO_ACK" });
  }

  let rpcSeq = 0;
  const openChannels = new Set();

  async function call(method, params, { timeoutMs = 60000, mode } = {}) {
    const id = ++rpcSeq;
    const frame = { jsonrpc: "2.0", id, method, params };
    if (mode !== undefined) frame.mode = mode;
    sock.write(JSON.stringify(frame) + "\n");
    for (;;) {
      const f = await nextFrame(timeoutMs);
      if (f.type) continue; // session_* notification frames
      if (f.id !== id) continue; // responses to other requests
      if (f.error) {
        throw Object.assign(new Error(f.error.message || "wbipc rpc error"), { code: f.error.code, data: f.error.data });
      }
      return f.result;
    }
  }

  /** Resolve (GetPipe) + remember a pipe channel, e.g. "wb.request". */
  async function openPipe(pipeName) {
    const key = `c:${pipeName}`;
    if (openChannels.has(key)) return key;
    const res = await call("broker/GetPipe", { pipe: pipeName }, { timeoutMs: FRAME_TIMEOUT_MS });
    if (!res || res.channel !== key) {
      throw Object.assign(new Error(`wbipc: GetPipe returned unexpected channel ${JSON.stringify(res)}`), { code: "WBIPC_BAD_CHANNEL" });
    }
    openChannels.add(key);
    return key;
  }

  return { sock, ack, call, openPipe };
}

/**
 * One-shot helper: connect, openPipe, run a channel call, close.
 */
export async function wbipcCall(configDir, pipeName, method, params, opts = {}) {
  const conn = await wbipcConnect(configDir, opts.sessionId ? { sessionId: opts.sessionId } : undefined);
  try {
    const channel = await conn.openPipe(pipeName);
    return await conn.call(`${channel}/${method}`, params, opts);
  } finally {
    try { conn.sock.destroy(); } catch { /* ignore */ }
  }
}
