import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyLive } from "../tools/verify-live.mjs";

const sources = ["agentbazaar", "a2a-traffic", "jlosic-colabora"]
  .map((source) => ({ source, ok: true }));
const healthy = {
  health: { status: "ok", owners: { published: 14, complete: true }, storage: "reachable" },
  card: { name: "JLOSIC", version: "1.0.0" },
  directory: { count: 25, sources },
};

function fixture(directoryReplies, overrides = {}) {
  const calls = [];
  const delays = [];
  const replies = [...directoryReplies];
  const fetchImpl = async (url) => {
    const path = new URL(url).pathname;
    calls.push(path);
    let value = path === "/health" ? (overrides.health || healthy.health)
      : path === "/.well-known/agent-card.json" ? healthy.card : replies.shift();
    if (value instanceof Error) throw value;
    return { ok: true, json: async () => value };
  };
  return { fetchImpl, calls, delays, sleep: async (ms) => { delays.push(ms); } };
}

test("recovers a transient directory timeout and reports the retry", async () => {
  const f = fixture([new Error("The operation was aborted due to timeout"), healthy.directory]);
  const result = await verifyLive({ origin: "https://example.test", ...f });
  assert.equal(result.directoryAttempts, 2);
  assert.equal(result.recoveredAfterRetry, true);
  assert.match(result.previousFailures[0], /timeout/);
  assert.deepEqual(f.delays, [2000]);
});

test("recovers a source-level timeout without calling it healthy on the first try", async () => {
  const timedOut = { count: 25, sources: sources.map((item) => item.source === "agentbazaar"
    ? { source: item.source, ok: false, error: "The operation was aborted due to timeout" } : item) };
  const f = fixture([timedOut, healthy.directory]);
  const result = await verifyLive({ origin: "https://example.test", ...f });
  assert.equal(result.directoryAttempts, 2);
  assert.match(result.previousFailures[0], /agentbazaar/);
  assert.equal(result.recoveredAfterRetry, true);
});

test("keeps a persistent missing source red after three attempts", async () => {
  const partial = { count: 25, sources: sources.filter((s) => s.source !== "agentbazaar") };
  const f = fixture([partial, partial, partial]);
  await assert.rejects(verifyLive({ origin: "https://example.test", ...f }), /agentbazaar/);
  assert.deepEqual(f.delays, [2000, 4000]);
  assert.equal(f.calls.filter((path) => path === "/.well-known/agents.json").length, 3);
});

test("does not hide a failure of JLOSIC's own health", async () => {
  const f = fixture([healthy.directory], { health: { ...healthy.health, status: "degraded" } });
  await assert.rejects(verifyLive({ origin: "https://example.test", ...f }), /Own federation unhealthy/);
  assert.deepEqual(f.calls, ["/health"]);
});
