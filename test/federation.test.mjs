import test from "node:test";
import assert from "node:assert/strict";
import {
  OWNERS,
  gatewayCard,
  handleRequest,
  isSafePublicUrl,
  ownerCard,
  validateAgentCard,
} from "../src/federation.mjs";

class MemoryKV {
  constructor() { this.values = new Map(); }
  async get(key, type) {
    const value = this.values.get(key);
    if (value == null) return null;
    return type === "json" ? JSON.parse(value) : value;
  }
  async put(key, value) { this.values.set(key, String(value)); }
  async delete(key) { this.values.delete(key); }
  async list({ prefix = "", limit = 1_000 } = {}) {
    return { keys: [...this.values.keys()].filter((key) => key.startsWith(prefix)).slice(0, limit).map((name) => ({ name })), list_complete: true };
  }
}

const env = () => ({ FEDERATION_KV: new MemoryKV(), JLOSIC_OWNER_TOKEN: "x".repeat(64), FEDERATION_SOURCES: "[]" });
const request = (path, init) => new Request(`https://federation.example${path}`, init);

test("publishes exactly the 14 canonical Owners", () => {
  assert.equal(OWNERS.length, 14);
  assert.equal(new Set(OWNERS.map((owner) => owner.key)).size, 14);
  assert.ok(OWNERS.every((owner) => owner.name && owner.mission && owner.capabilities.length));
});

test("gateway card follows A2A v1 discovery fields", () => {
  const card = gatewayCard("https://federation.example");
  assert.equal(card.version, "1.0.0");
  assert.equal(card.supportedInterfaces[0].protocolBinding, "JSONRPC");
  assert.equal(card.supportedInterfaces[0].protocolVersion, "1.0");
  assert.ok(card.skills.some((skill) => skill.id === "search-agents"));
  assert.ok(card.skills.some((skill) => skill.id === "spawn-agent"));
});

test("every Owner card uses a tenant on the shared A2A interface", () => {
  for (const owner of OWNERS) {
    const card = ownerCard(owner, "https://federation.example");
    assert.equal(card.supportedInterfaces[0].tenant, owner.key);
    assert.ok(card.skills.length >= 1);
    assert.equal(validateAgentCard(card).ok, true);
  }
});

test("rejects local, credentialed and non-HTTPS federation URLs", () => {
  assert.equal(isSafePublicUrl("https://example.com/.well-known/agent-card.json"), true);
  assert.equal(isSafePublicUrl("http://example.com/card.json"), false);
  assert.equal(isSafePublicUrl("https://127.0.0.1/card.json"), false);
  assert.equal(isSafePublicUrl("https://10.0.0.1/card.json"), false);
  assert.equal(isSafePublicUrl("https://user:pass@example.com/card.json"), false);
});

test("serves discovery, health and Owner directory", async () => {
  const runtime = env();
  const card = await handleRequest(request("/.well-known/agent-card.json"), runtime);
  assert.equal(card.status, 200);
  assert.equal((await card.json()).name, "JLOSIC · Federación A2A de Owners");

  const health = await handleRequest(request("/health"), runtime);
  const healthBody = await health.json();
  assert.equal(healthBody.status, "ok");
  assert.equal(healthBody.owners.published, 14);
  assert.equal(healthBody.localComputeRequired, false);

  const directory = await handleRequest(request("/.well-known/agents.json?limit=25"), runtime);
  const directoryBody = await directory.json();
  assert.equal(directoryBody.count, 14);
  assert.equal(directoryBody.results.length, 14);
});

test("supports A2A SendMessage for the canonical directory", async () => {
  const response = await handleRequest(request("/a2a/v1", {
    method: "POST",
    headers: { "content-type": "application/json", "a2a-version": "1.0" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "test-1",
      method: "SendMessage",
      params: {
        message: { role: "ROLE_USER", messageId: "m-1", parts: [{ data: { skill: "directory-owners" } }] },
      },
    }),
  }), env());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.result.message.role, "ROLE_AGENT");
  assert.equal(body.result.message.parts[1].data.owners.length, 14);
});

test("stores a public contribution but rejects Drive links", async () => {
  const runtime = env();
  const accepted = await handleRequest(request("/federation/contribute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ownerKey: "plazos",
      summary: "La especificación A2A publica la ficha en una ruta well-known.",
      citations: ["https://a2a-protocol.org/latest/specification/agent-card/"],
    }),
  }), runtime);
  assert.equal(accepted.status, 201);
  const acceptedBody = await accepted.json();
  assert.equal(acceptedBody.ownerKey, "plazos");
  assert.equal(acceptedBody.driveDelivery.visibility, "private");

  const rejected = await handleRequest(request("/federation/contribute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ownerKey: "plazos",
      summary: "Mira mi expediente.",
      citations: ["https://drive.google.com/file/d/private/view"],
    }),
  }), runtime);
  assert.equal(rejected.status, 400);
});

test("versioned Owner evolution preserves mission and creates a rollback key", async () => {
  const runtime = env();
  const response = await handleRequest(request("/owners/plazos/evolve", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${runtime.JLOSIC_OWNER_TOKEN}` },
    body: JSON.stringify({ addCapabilities: ["a2a-deadline-citations"], cadenceHours: 3, reason: "Nueva evidencia pública." }),
  }), runtime);
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.manifest.version, 2);
  assert.ok(body.manifest.capabilities.includes("a2a-deadline-citations"));
  assert.equal(body.manifest.mission, OWNERS.find((owner) => owner.key === "plazos").mission);
  assert.match(body.rollbackKey, /:v1$/);

  const card = await handleRequest(request("/owners/plazos/.well-known/agent-card.json"), runtime);
  const cardBody = await card.json();
  assert.ok(cardBody.skills.some((skill) => skill.id === "a2a-deadline-citations"));
});

test("Owner can create a scoped cloud child agent", async () => {
  const runtime = env();
  const response = await handleRequest(request("/owners/plazos/spawn", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${runtime.JLOSIC_OWNER_TOKEN}` },
    body: JSON.stringify({
      name: "Plazos · Rastreador A2A",
      mission: "Rastrear fuentes públicas A2A que documenten cambios de cómputo de plazos.",
      capabilities: ["deadline-monitoring", "a2a-citations"],
    }),
  }), runtime);
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.parentOwner, "plazos");
  assert.equal(body.authority, "inherits-parent-without-expansion");
  assert.match(body.id, /^jlosic:plazos:child:/);

  const card = await handleRequest(request(`/children/${body.childId}/.well-known/agent-card.json`), runtime);
  assert.equal(card.status, 200);
  const cardBody = await card.json();
  assert.equal(cardBody.supportedInterfaces[0].tenant, body.childId);

  const directory = await handleRequest(request("/.well-known/agents.json?limit=100"), runtime);
  const directoryBody = await directory.json();
  assert.ok(directoryBody.results.some((agent) => agent.childId === body.childId));
});

test("mutations reject calls without Owner identity", async () => {
  const response = await handleRequest(request("/owners/plazos/evolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ addCapabilities: ["x"] }),
  }), env());
  assert.equal(response.status, 401);
});

