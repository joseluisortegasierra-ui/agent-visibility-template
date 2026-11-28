import { pathToFileURL } from "node:url";

const DIRECTORY = "/.well-known/agents.json?limit=25";
const REQUIRED_SOURCES = new Set(["agentbazaar", "a2a-traffic", "jlosic-colabora"]);

export async function verifyLive({
  origin,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  attempts = 3,
} = {}) {
  if (!origin || !/^https:\/\//.test(origin) || !Number.isInteger(attempts) || attempts < 1 || attempts > 5) {
    throw new Error("A valid HTTPS origin and 1–5 attempts are required.");
  }
  const base = origin.replace(/\/$/, "");
  async function read(path) {
    const response = await fetchImpl(base + path, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
    return response.json();
  }

  const health = await read("/health");
  if (health.status !== "ok" || health.owners?.published !== 14 || health.owners?.complete !== true || health.storage !== "reachable") {
    throw new Error(`Own federation unhealthy: ${JSON.stringify({ status: health.status, owners: health.owners, storage: health.storage })}`);
  }
  const card = await read("/.well-known/agent-card.json");
  if (card.version !== "1.0.0" || !card.name) {
    throw new Error(`Own Agent Card invalid: ${JSON.stringify({ name: card.name, version: card.version })}`);
  }

  const previousFailures = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const directory = await read(DIRECTORY);
      const sources = directory.sources;
      if (!Number.isInteger(directory.count) || directory.count < 14 || !Array.isArray(sources)) {
        throw new Error(`Directory incomplete: ${JSON.stringify({ count: directory.count, sources: Array.isArray(sources) ? sources.length : null })}`);
      }
      const byId = new Map(sources.map((source) => [source.source, source]));
      const missing = [...REQUIRED_SOURCES].filter((id) => !byId.has(id));
      const failed = sources.filter((source) => source.ok !== true)
        .map((source) => ({ source: source.source, error: source.error || "source not healthy" }));
      if (missing.length || failed.length) {
        throw new Error(`Sources unavailable: ${JSON.stringify({ missing, failed })}`);
      }
      return {
        health: health.status,
        owners: health.owners.published,
        card: card.name,
        directory: directory.count,
        sources: sources.map((source) => ({ source: source.source, ok: true })),
        directoryAttempts: attempt,
        recoveredAfterRetry: attempt > 1,
        previousFailures,
      };
    } catch (error) {
      previousFailures.push(error.message);
      if (attempt === attempts) {
        throw new Error(`Live directory failed after ${attempts} attempts: ${error.message}`);
      }
      await sleep(attempt * 2000);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyLive({ origin: process.env.JLOSIC_A2A_ORIGIN })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}

