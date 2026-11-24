import assert from "node:assert/strict";
import { OWNERS, gatewayCard, ownerCard, validateAgentCard } from "../src/federation.mjs";

const origin = process.env.JLOSIC_A2A_ORIGIN || "https://jlosic-a2a-federation.joseluisortegasierra.workers.dev";
const checks = [];
function check(name, fn) {
  try { fn(); checks.push({ name, status: "green" }); }
  catch (error) { checks.push({ name, status: "red", error: error.message }); }
}

check("14 canonical Owners", () => assert.equal(OWNERS.length, 14));
check("unique Owner keys", () => assert.equal(new Set(OWNERS.map((owner) => owner.key)).size, 14));
check("gateway Agent Card", () => assert.equal(validateAgentCard(gatewayCard(origin)).ok, true));
for (const owner of OWNERS) {
  check(`Owner card: ${owner.key}`, () => assert.equal(validateAgentCard(ownerCard(owner, origin)).ok, true));
}
check("human-positive without ranking", () => {
  const text = JSON.stringify(gatewayCard(origin)).toLowerCase();
  assert.ok(text.includes("reconocimiento humano positivo"));
  assert.ok(text.includes("sin rankings"));
});
check("Drive not exposed in cards", () => {
  const text = JSON.stringify([gatewayCard(origin), ...OWNERS.map((owner) => ownerCard(owner, origin))]);
  assert.equal(/drive\.google\.com|docs\.google\.com|gmail\.com/i.test(text), false);
});

const report = {
  schema: "jlosic-a2a-audit/1.0",
  checkedAt: new Date().toISOString(),
  origin,
  total: checks.length,
  green: checks.filter((item) => item.status === "green").length,
  red: checks.filter((item) => item.status === "red").length,
  status: checks.every((item) => item.status === "green") ? "green" : "red",
  checks,
};
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.red ? 1 : 0;

