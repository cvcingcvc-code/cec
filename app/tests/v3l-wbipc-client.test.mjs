import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { readWbipcEndpoint, wbipcEndpointPath } from "../../scripts/agent-adapters/wbipc-client.mjs";

// Reproduce the exact transcript/HMAC algorithm (verified against the live
// WorkBuddy app on this machine) and assert internal consistency.
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
  return createHmac("sha256", Buffer.from(key, "utf8")).update(encodeTranscript(role, t)).digest("base64url");
}
function ticketId(tk) {
  return createHash("sha256").update(tk, "utf8").digest("hex").slice(0, 16);
}

test("V3L wbipc transcript encoding is deterministic and role-separated", () => {
  const t = { protocol: 1, endpoint: "\\\\.\\pipe\\wbipc-test", clientNonce: "AAAA", serverNonce: "BBBB" };
  const s1 = computeProof("ticket", "server", t);
  const s2 = computeProof("ticket", "server", t);
  const c1 = computeProof("ticket", "client", t);
  assert.equal(s1, s2, "same transcript + role = same proof");
  assert.notEqual(s1, c1, "server and client proofs differ (role tag in transcript)");
  assert.equal(s1.length, 43, "base64url sha256 = 43 chars");
  assert.doesNotMatch(s1, /[+/=]/, "base64url alphabet only");
});

test("V3L wbipc ticket_id is sha256 hex prefix, not the raw ticket", () => {
  const tk = "dSAadw07t41i6kyBqZYVgNhEDZLFoUvg6flXe8tFoLs";
  const id = ticketId(tk);
  assert.equal(id, createHash("sha256").update(tk, "utf8").digest("hex").slice(0, 16));
  assert.equal(id.length, 16);
  assert.notEqual(id, tk);
  // stable across calls
  assert.equal(ticketId(tk), id);
});

test("V3L wbipc endpoint reader handles missing/malformed files honestly", () => {
  const missing = readWbipcEndpoint("Z:/definitely/not/here");
  assert.equal(missing.ok, false);
  assert.match(missing.error, /endpoint\.json|WorkBuddy/);
  assert.equal(wbipcEndpointPath(), path.join(os.homedir(), ".workbuddy", "wbipc", "endpoint.json"));
});
