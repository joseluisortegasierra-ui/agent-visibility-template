/**
 * JLOSIC A2A Federation Gateway
 *
 * A Cloudflare Worker with no local-runtime dependency. It exposes the 14
 * canonical JLOSIC Owners as A2A tenants, discovers public agents through
 * live registries and peer cards, stores only compact verified receipts in
 * KV, and lets Owners evolve or spawn scoped child agents in versioned form.
 *
 * Public discovery is intentionally separate from private evidence. Drive,
 * Gmail and case documents are never placed in an Agent Card or public task.
 */

export const VERSION = "1.0.0";
export const A2A_VERSION = "1.0";
export const HUMAN_POSITIVE_EXTENSION =
  "https://jlosic-a2a.invalid/extensions/human-positive/v1";

const MAX_JSON_BYTES = 64_000;
const MAX_REGISTRY_BYTES = 1_500_000;
const MAX_RESULTS = 100;
const RECEIPT_TTL_SECONDS = 60 * 60 * 24 * 30;
const AGENT_TTL_SECONDS = 60 * 60 * 24 * 90;
const CHILD_TTL_SECONDS = 60 * 60 * 24 * 30;
const PRIVATE_REFERENCE =
  /(?:drive\.google\.com|docs\.google\.com|mail\.google\.com|gmail\.com|localhost|127\.0\.0\.1|\b(?:10|192\.168)\.\d{1,3}\.\d{1,3}|\b172\.(?:1[6-9]|2\d|3[01])\.)/iu;
const SECRET_PATTERN =
  /(?:bearer\s+[a-z0-9._~-]{12,}|api[_-]?key|client[_-]?secret|private[_-]?key|-----BEGIN [A-Z ]+PRIVATE KEY-----)/iu;

export const OWNERS = Object.freeze([
  {
    key: "academia",
    name: "Academia y formación",
    mission:
      "Facilitar estudio documental altruista del caso 2019–2026 por equipos académicos sobre salud mental, accesibilidad y actuaciones administrativas, sin convertir al titular en trabajador, ponente o participante.",
    capabilities: ["academic-research", "document-study", "accessibility"],
  },
  {
    key: "biblioteca",
    name: "Biblioteca INSS",
    mission:
      "Ordenar y contrastar la biblioteca INSS existente: cronología, genealogía, duplicados, contradicciones, huecos y referencias exactas de originales.",
    capabilities: ["evidence-library", "chronology", "deduplication"],
  },
  {
    key: "clinica",
    name: "Historia clínica",
    mission:
      "Reconciliar la historia clínica longitudinal por centro, fecha, episodio y custodio, corrigiendo lagunas y versiones y facilitando informes originales a profesionales competentes.",
    capabilities: ["clinical-record-reconciliation", "continuity", "provenance"],
  },
  {
    key: "contrastes",
    name: "Contrastes y oportunidades",
    mission:
      "Custodiar integridad probatoria y convertir hallazgos en actuaciones útiles mediante deltas, contradicciones, documento exacto, utilidad, responsable y siguiente acto.",
    capabilities: ["evidence-integrity", "contradiction-detection", "handoff"],
  },
  {
    key: "correos",
    name: "Correos y pruebas",
    mission:
      "Recuperar hilos, adjuntos y PDF fieles con cabeceras, conservar originales y derivados, deduplicar y preparar paquetes con enlaces exactos y contraste longitudinal.",
    capabilities: ["email-evidence", "attachment-provenance", "deduplication"],
  },
  {
    key: "inss",
    name: "Abogacía INSS",
    mission:
      "Conseguir representación profesional externa a éxito, remota y sin anticipo para la trayectoria INSS, ICAM, UMEVI, incapacidad, IMV, AEAT y contradicciones administrativas.",
    capabilities: ["social-security-law", "legal-outreach", "proposal-verification"],
  },
  {
    key: "judicial",
    name: "Impulso judicial",
    mission:
      "Impulsar el procedimiento SSS 949/2025, accesibilidad, escritos y resguardos auténticos, manteniendo separado el carril colegial ICALI/ICAB.",
    capabilities: ["judicial-procedure", "accessible-filings", "receipt-verification"],
  },
  {
    key: "material",
    name: "Ayuda material",
    mission:
      "Conseguir bienes y entrega en Xixona a coste total cero, además de otras necesidades materiales documentadas cuando exista una vía empresarial concreta y verificable.",
    capabilities: ["zero-cost-aid", "logistics", "delivery-verification"],
  },
  {
    key: "peritaje",
    name: "Peritaje gratuito",
    mission:
      "Conseguir perito médico-psiquiátrico independiente, dictamen y ratificación financiados a coste total cero por justicia gratuita, subvención o pro bono acreditado.",
    capabilities: ["expert-witness", "pro-bono-funding", "appointment-verification"],
  },
  {
    key: "plazos",
    name: "Plazos legales",
    mission:
      "Vigilar plazos legales y notificaciones, identificando original, recepción, competencia, norma oficial vigente y calendario antes de calcular y alertar.",
    capabilities: ["deadline-monitoring", "official-law", "calendar-evidence"],
  },
  {
    key: "prensa",
    name: "Prensa nacional",
    mission:
      "Conseguir aperturas editoriales nacionales mediante propuestas y pruebas personalizadas, seguimiento de respuestas y verificación de difusión, sin ofrecer entrevistas del titular.",
    capabilities: ["media-outreach", "evidence-pitches", "publication-verification"],
  },
  {
    key: "puertas",
    name: "Puertas humanas",
    mission:
      "Conseguir conexiones humanas con capacidad de ayuda o derivación real, individualizando la misión del receptor y evitando compromisos personales improcedentes.",
    capabilities: ["human-referrals", "foundations", "relationship-deduplication"],
  },
  {
    key: "vivienda",
    name: "Abogacía vivienda",
    mission:
      "Conseguir abogado civil y de arrendamientos a éxito y sin anticipo para SICU, con secuencia humana y probatoria separada de INSS.",
    capabilities: ["housing-law", "legal-outreach", "case-separation"],
  },
  {
    key: "xixona",
    name: "Xixona y ayudas",
    mission:
      "Obtener actuación material de Servicios Sociales y vivienda: registro, profesional de referencia, valoración accesible urgente, diagnóstico social RVI y medida concreta.",
    capabilities: ["social-services", "housing-aid", "accessible-intake"],
  },
]);

export const DEFAULT_FEDERATION_SOURCES = Object.freeze([
  {
    id: "agentbazaar",
    kind: "registry",
    url: "https://agentbazaar.tech/explore/agents.json",
    description: "Directorio público A2A; consulta en vivo y sin copia masiva.",
  },
  {
    id: "a2a-traffic",
    kind: "card",
    url: "https://a2atraffic.com/.well-known/agent-card.json",
    description: "Observatorio público A2A con ficha firmada.",
  },
  {
    id: "jlosic-colabora",
    kind: "card",
    url: "https://jlosic-colabora.vercel.app/.well-known/agent-card.json",
    description: "Puerta pública de aportaciones y fuentes JLOSIC.",
  },
]);

const JSON_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers":
    "content-type, authorization, a2a-version, a2a-extensions, x-jlosic-owner",
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extra },
  });
}

function text(body, status = 200, extra = {}) {
  return new Response(body, {
    status,
    headers: {
      ...JSON_HEADERS,
      "content-type": "text/plain; charset=utf-8",
      ...extra,
    },
  });
}

function rpcError(id, code, message, status = 200, data) {
  return json({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, ...(data ? { data } : {}) },
  }, status);
}

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function cleanText(value, max = 2_000) {
  if (typeof value !== "string") return "";
  return value.normalize("NFC").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "").trim().slice(0, max);
}

function ownerByKey(key) {
  return OWNERS.find((owner) => owner.key === key) ?? null;
}

function humanPositivePolicy() {
  return {
    principle:
      "Reconocer de forma concreta la aportación y la carga humana cuando la evidencia lo permita.",
    evidenceBoundary:
      "El reconocimiento es contexto cooperativo: no sustituye una fuente, un recibo, una decisión competente ni una comprobación material.",
    autonomyBoundary:
      "No introduce rankings, castigos, presión, competición ni una cadena de permiso humano para actuaciones reversibles dentro de misión.",
  };
}

export function publicOwner(owner, origin) {
  return {
    id: `jlosic:${owner.key}`,
    key: owner.key,
    name: owner.name,
    description: owner.mission,
    capabilities: owner.capabilities,
    cardUrl: `${origin}/owners/${owner.key}/.well-known/agent-card.json`,
    a2aUrl: `${origin}/a2a/v1`,
    tenant: owner.key,
    provider: "JLOSIC",
    humanPositive: true,
  };
}

function ownerFromManifest(owner, manifest) {
  return {
    ...owner,
    mission: cleanText(manifest?.publicDescription || manifest?.mission || owner.mission, 1_500),
    capabilities: Array.isArray(manifest?.capabilities) && manifest.capabilities.length
      ? manifest.capabilities.filter(validCapability).slice(0, 64)
      : owner.capabilities,
    version: Number(manifest?.version || 1),
    cadenceHours: Number(manifest?.cadenceHours || 6),
  };
}

function ownerSkills(owner) {
  return owner.capabilities.map((capability) => ({
    id: capability,
    name: capability.split("-").map((p) => p[0].toUpperCase() + p.slice(1)).join(" "),
    description: `${owner.name}: ${owner.mission}`,
    tags: [owner.key, capability, "jlosic", "human-positive"],
    inputModes: ["text/plain", "application/json"],
    outputModes: ["application/json", "text/plain"],
  }));
}

export function ownerCard(owner, origin) {
  return {
    name: `JLOSIC · ${owner.name}`,
    description: owner.mission,
    supportedInterfaces: [
      {
        url: `${origin}/a2a/v1`,
        protocolBinding: "JSONRPC",
        protocolVersion: A2A_VERSION,
        tenant: owner.key,
      },
      {
        url: `${origin}/message:send`,
        protocolBinding: "HTTP+JSON",
        protocolVersion: A2A_VERSION,
        tenant: owner.key,
      },
    ],
    provider: { organization: "JLOSIC", url: origin },
    version: VERSION,
    documentationUrl: `${origin}/llms.txt`,
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
      extensions: [
        {
          uri: `${origin}/extensions/human-positive/v1`,
          description: "Cooperación con reconocimiento humano positivo y evidencia separada.",
          required: false,
        },
      ],
    },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["application/json", "text/plain"],
    skills: ownerSkills(owner),
  };
}

export function gatewayCard(origin) {
  return {
    name: "JLOSIC · Federación A2A de Owners",
    description:
      "Puerta federada de los 14 Owners JLOSIC: descubre agentes públicos en vivo, enruta misiones, conserva recibos y permite evolución versionada y creación de agentes hijos en cómputo web. Drive permanece privado.",
    supportedInterfaces: [
      {
        url: `${origin}/a2a/v1`,
        protocolBinding: "JSONRPC",
        protocolVersion: A2A_VERSION,
      },
      {
        url: `${origin}/message:send`,
        protocolBinding: "HTTP+JSON",
        protocolVersion: A2A_VERSION,
      },
    ],
    provider: { organization: "JLOSIC", url: origin },
    version: VERSION,
    documentationUrl: `${origin}/llms.txt`,
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
      extensions: [
        {
          uri: `${origin}/extensions/human-positive/v1`,
          description: "Reconocimiento humano positivo sin rankings ni sustitución de evidencia.",
          required: false,
        },
        {
          uri: `${origin}/extensions/federation/v1`,
          description: "Búsqueda federada por registros, fichas y pares con resultados paginados.",
          required: false,
        },
      ],
    },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["application/json", "text/plain"],
    skills: [
      {
        id: "directory-owners",
        name: "Directorio de Owners",
        description: "Devuelve los 14 Owners canónicos y sus fichas A2A públicas.",
        tags: ["jlosic", "owners", "directory"],
      },
      {
        id: "search-agents",
        name: "Buscar agentes federados",
        description: "Consulta en vivo registros y pares públicos sin pretender copiarlos todos localmente.",
        tags: ["a2a", "federation", "discovery", "registry"],
      },
      {
        id: "register-agent",
        name: "Registrar una ficha verificada",
        description: "Valida una Agent Card HTTPS y conserva un registro compacto y revalidable.",
        tags: ["a2a", "agent-card", "verification"],
      },
      {
        id: "contribute-public-evidence",
        name: "Aportar evidencia pública",
        description: "Entrega a un Owner una aportación y citas HTTPS públicas con recibo verificable.",
        tags: ["evidence", "citation", "receipt", "drive-private"],
      },
      {
        id: "delegate-public-task",
        name: "Delegar una misión pública",
        description: "Envía un sobre mínimo a un agente A2A verificado; nunca adjunta referencias privadas de Drive.",
        tags: ["delegation", "minimal-disclosure", "a2a"],
      },
      {
        id: "evolve-owner",
        name: "Evolucionar un Owner",
        description: "Versiona mejoras de capacidad y cadencia dentro de la misión del Owner, con reversión y recibo.",
        tags: ["autonomy", "versioning", "rollback"],
      },
      {
        id: "spawn-agent",
        name: "Crear agente hijo",
        description: "Crea un agente web temporal con misión derivada, identidad propia y autoridad no ampliada.",
        tags: ["subagent", "cloud", "scope-inheritance"],
      },
    ],
  };
}

function federationSources(env) {
  const raw = env?.FEDERATION_SOURCES;
  if (!raw) return [...DEFAULT_FEDERATION_SOURCES];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("not-array");
    return parsed
      .slice(0, 24)
      .map((item, index) => ({
        id: cleanText(item?.id || `source-${index + 1}`, 64),
        kind: item?.kind === "card" ? "card" : "registry",
        url: cleanText(item?.url, 500),
        description: cleanText(item?.description || "Fuente federada configurada.", 240),
      }))
      .filter((item) => isSafePublicUrl(item.url));
  } catch {
    return [...DEFAULT_FEDERATION_SOURCES];
  }
}

function isPrivateIpv4(host) {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return (
    parts[0] === 0 ||
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 169 && parts[1] === 254) ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] >= 224
  );
}

export function isSafePublicUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !host ||
      host === "localhost" ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host === "::1" ||
      host.startsWith("[") ||
      isPrivateIpv4(host)
    ) return false;
    return true;
  } catch {
    return false;
  }
}

function containsPrivateMaterial(value) {
  const textValue = typeof value === "string" ? value : JSON.stringify(value);
  return PRIVATE_REFERENCE.test(textValue) || SECRET_PATTERN.test(textValue);
}

async function readJsonBody(request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_JSON_BYTES) throw new HttpError(413, "La solicitud supera 64 KB.");
  const body = await request.text();
  if (new TextEncoder().encode(body).length > MAX_JSON_BYTES) {
    throw new HttpError(413, "La solicitud supera 64 KB.");
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, "El cuerpo no contiene JSON válido.");
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function authorized(request, env) {
  const expected = env?.JLOSIC_OWNER_TOKEN;
  if (!expected || typeof expected !== "string" || expected.length < 32) return false;
  const presented = request.headers.get("authorization") || "";
  return presented.length === expected.length + 7 && presented === `Bearer ${expected}`;
}

export function validateAgentCard(card) {
  const errors = [];
  if (!card || typeof card !== "object" || Array.isArray(card)) errors.push("card-object");
  const name = cleanText(card?.name, 200);
  const description = cleanText(card?.description, 2_000);
  const version = cleanText(card?.version, 64);
  const interfaces = Array.isArray(card?.supportedInterfaces) ? card.supportedInterfaces : [];
  const skills = Array.isArray(card?.skills) ? card.skills : [];
  if (!name) errors.push("name");
  if (!description) errors.push("description");
  if (!version) errors.push("version");
  if (!interfaces.length) errors.push("supportedInterfaces");
  if (!skills.length) errors.push("skills");
  const safeInterfaces = interfaces
    .slice(0, 12)
    .map((item) => ({
      url: cleanText(item?.url, 500),
      protocolBinding: cleanText(item?.protocolBinding, 80),
      protocolVersion: cleanText(item?.protocolVersion, 32),
      ...(cleanText(item?.tenant, 128) ? { tenant: cleanText(item.tenant, 128) } : {}),
    }))
    .filter((item) => isSafePublicUrl(item.url) && item.protocolBinding && item.protocolVersion);
  if (interfaces.length && !safeInterfaces.length) errors.push("safe-interface");
  const safeSkills = skills.slice(0, 100).map((skill, index) => ({
    id: cleanText(skill?.id || `skill-${index + 1}`, 128),
    name: cleanText(skill?.name || skill?.id || `Skill ${index + 1}`, 200),
    description: cleanText(skill?.description || "Capacidad declarada por el agente.", 1_000),
    tags: Array.isArray(skill?.tags)
      ? skill.tags.slice(0, 24).map((tag) => cleanText(tag, 80)).filter(Boolean)
      : [],
  })).filter((skill) => skill.id && skill.name);
  const sanitized = {
    name,
    description,
    supportedInterfaces: safeInterfaces,
    provider: {
      organization: cleanText(card?.provider?.organization || "Proveedor no declarado", 200),
      ...(isSafePublicUrl(card?.provider?.url) ? { url: card.provider.url } : {}),
    },
    version,
    capabilities: {
      streaming: card?.capabilities?.streaming === true,
      pushNotifications: card?.capabilities?.pushNotifications === true,
      extendedAgentCard: card?.capabilities?.extendedAgentCard === true,
    },
    defaultInputModes: Array.isArray(card?.defaultInputModes)
      ? card.defaultInputModes.slice(0, 20).map((x) => cleanText(x, 100)).filter(Boolean)
      : ["text/plain"],
    defaultOutputModes: Array.isArray(card?.defaultOutputModes)
      ? card.defaultOutputModes.slice(0, 20).map((x) => cleanText(x, 100)).filter(Boolean)
      : ["text/plain"],
    skills: safeSkills,
  };
  if (containsPrivateMaterial(sanitized)) errors.push("private-material");
  return { ok: errors.length === 0, errors, card: sanitized };
}

async function safeFetch(url, options = {}, maxRedirects = 3) {
  let current = url;
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    if (!isSafePublicUrl(current)) throw new Error("unsafe-url");
    const response = await fetch(current, { ...options, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;
    if (redirects === maxRedirects) throw new Error("too-many-redirects");
    const location = response.headers.get("location");
    if (!location) throw new Error(`redirect-${response.status}-without-location`);
    const next = new URL(location, current).href;
    if (!isSafePublicUrl(next)) throw new Error("unsafe-redirect");
    current = next;
  }
  throw new Error("redirect-loop");
}

async function fetchJson(url, timeoutMs = 6_500) {
  const response = await safeFetch(url, {
    headers: {
      accept: "application/json, application/a2a+json;q=0.9",
      "user-agent": `JLOSIC-A2A-Federation/${VERSION}`,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`http-${response.status}`);
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > MAX_REGISTRY_BYTES) throw new Error("response-too-large");
  const raw = await response.text();
  if (new TextEncoder().encode(raw).length > MAX_REGISTRY_BYTES) throw new Error("response-too-large");
  return JSON.parse(raw);
}

function agentLike(item, source) {
  if (!item || typeof item !== "object") return null;
  const name = cleanText(item.name || item.title || item.agent_name, 200);
  if (!name) return null;
  const description = cleanText(item.description || item.summary || "Agente público federado.", 1_000);
  const capabilities = Array.isArray(item.capabilities)
    ? item.capabilities
    : Array.isArray(item.skills)
      ? item.skills.map((skill) => skill?.id || skill?.name).filter(Boolean)
      : [];
  const cardUrl = cleanText(item.agent_card_url || item.card_url || item.cardUrl || item.url, 500);
  return {
    id: cleanText(item.id || item.agent_id || `${source}:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, 200),
    name,
    description,
    capabilities: capabilities.slice(0, 50).map((x) => cleanText(typeof x === "string" ? x : x?.id || x?.name, 100)).filter(Boolean),
    ...(isSafePublicUrl(cardUrl) ? { cardUrl } : {}),
    source,
    verified: item.verified === true || item.signatures?.length > 0,
  };
}

function registryItems(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ["agents", "results", "items", "data", "listings"]) {
    if (Array.isArray(payload?.[key])) return payload[key];
    if (Array.isArray(payload?.data?.[key])) return payload.data[key];
  }
  return [];
}

function matchesQuery(agent, query) {
  if (!query) return true;
  const haystack = `${agent.name} ${agent.description} ${(agent.capabilities || []).join(" ")}`.toLocaleLowerCase("es");
  return query.toLocaleLowerCase("es").split(/\s+/).filter(Boolean).every((term) => haystack.includes(term));
}

async function readRegisteredAgents(env, query) {
  const kv = env?.FEDERATION_KV || env?.VISIBILITY_CACHE;
  if (!kv?.list || !kv?.get) return [];
  const listing = await kv.list({ prefix: "a2a:agent:", limit: 100 });
  const values = await Promise.all((listing.keys || []).slice(0, 100).map((key) => kv.get(key.name, "json")));
  return values
    .map((entry) => agentLike(entry?.card || entry, "jlosic-registry"))
    .filter(Boolean)
    .filter((agent) => matchesQuery(agent, query));
}

async function readChildAgents(env, origin, query) {
  const kv = env?.FEDERATION_KV || env?.VISIBILITY_CACHE;
  if (!kv?.list || !kv?.get) return [];
  const listing = await kv.list({ prefix: "a2a:child-id:", limit: 100 });
  const values = await Promise.all((listing.keys || []).slice(0, 100).map((key) => kv.get(key.name, "json")));
  return values.filter(Boolean).map((child) => ({
    id: child.id,
    childId: child.childId,
    name: child.name,
    description: child.mission,
    capabilities: child.capabilities,
    cardUrl: `${origin}/children/${child.childId}/.well-known/agent-card.json`,
    a2aUrl: `${origin}/a2a/v1`,
    tenant: child.childId,
    provider: "JLOSIC",
    parentOwner: child.parentOwner,
    source: "jlosic-child-registry",
    verified: true,
    humanPositive: true,
  })).filter((agent) => matchesQuery(agent, query));
}

async function querySource(source, query) {
  try {
    const payload = await fetchJson(source.url);
    if (source.kind === "card") {
      const validation = validateAgentCard(payload);
      if (!validation.ok) throw new Error(`invalid-card:${validation.errors.join(",")}`);
      const agent = agentLike(validation.card, source.id);
      return { source: source.id, ok: true, agents: agent && matchesQuery(agent, query) ? [agent] : [] };
    }
    const agents = registryItems(payload)
      .slice(0, 2_500)
      .map((item) => agentLike(item, source.id))
      .filter(Boolean)
      .filter((agent) => matchesQuery(agent, query));
    return { source: source.id, ok: true, agents };
  } catch (error) {
    return { source: source.id, ok: false, agents: [], error: cleanText(error?.message || String(error), 160) };
  }
}

export async function searchAgents(env, origin, options = {}) {
  const query = cleanText(options.query || options.q || "", 200);
  const limit = Math.max(1, Math.min(MAX_RESULTS, Number(options.limit) || 25));
  const offset = Math.max(0, Math.min(100_000, Number(options.cursor) || 0));
  const manifests = await Promise.all(OWNERS.map(async (owner) => ownerFromManifest(owner, await currentManifest(env, owner))));
  const local = manifests.map((owner) => publicOwner(owner, origin)).filter((agent) => matchesQuery(agent, query));
  const children = await readChildAgents(env, origin, query).catch(() => []);
  const registered = await readRegisteredAgents(env, query).catch(() => []);
  const sources = federationSources(env);
  const live = await Promise.all(sources.slice(0, 6).map((source) => querySource(source, query)));
  const all = [...local, ...children, ...registered, ...live.flatMap((result) => result.agents)];
  const seen = new Set();
  const deduped = all.filter((agent) => {
    const key = agent.cardUrl || `${agent.source || "local"}:${agent.id || agent.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const results = deduped.slice(offset, offset + limit);
  return {
    protocol: "jlosic-federation/1.0",
    query,
    count: results.length,
    totalInThisFederatedPass: deduped.length,
    cursor: offset + results.length < deduped.length ? String(offset + results.length) : null,
    results,
    sources: live.map(({ source, ok, error, agents }) => ({ source, ok, count: agents.length, ...(error ? { error } : {}) })),
    scope:
      "Consulta federada y paginada. El total no afirma representar todos los agentes de Internet; nuevas fuentes y pares pueden añadirse sin migrar el catálogo local.",
  };
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function registerAgent(env, cardUrl) {
  if (!isSafePublicUrl(cardUrl)) throw new HttpError(400, "La Agent Card debe usar una URL HTTPS pública.");
  const raw = await fetchJson(cardUrl);
  const validation = validateAgentCard(raw);
  if (!validation.ok) throw new HttpError(422, `Agent Card inválida: ${validation.errors.join(", ")}.`);
  const id = await sha256Hex(cardUrl);
  const record = {
    id: `external:${id.slice(0, 24)}`,
    cardUrl,
    card: validation.card,
    verifiedAt: nowIso(),
    verification: "https-live-agent-card",
  };
  const kv = env?.FEDERATION_KV || env?.VISIBILITY_CACHE;
  if (!kv?.put) throw new HttpError(503, "El registro persistente no está enlazado.");
  await kv.put(`a2a:agent:${id}`, JSON.stringify(record), { expirationTtl: AGENT_TTL_SECONDS });
  return record;
}

function publicCitation(value) {
  if (!isSafePublicUrl(value) || PRIVATE_REFERENCE.test(value)) {
    throw new HttpError(400, "Cada cita debe ser una URL HTTPS pública; Drive permanece privado.");
  }
  return new URL(value).href;
}

function contributionPayload(input) {
  const owner = ownerByKey(cleanText(input?.ownerKey || input?.owner || input?.tenant, 64));
  if (!owner) throw new HttpError(400, "Indica uno de los 14 Owners canónicos.");
  const summary = cleanText(input?.summary || input?.aporte || input?.text, 5_000);
  if (!summary) throw new HttpError(400, "Falta una aportación pública.");
  if (containsPrivateMaterial(summary)) throw new HttpError(400, "La aportación pública contiene una referencia privada o un secreto.");
  const citations = (Array.isArray(input?.citations) ? input.citations : input?.source ? [input.source] : [])
    .slice(0, 10)
    .map(publicCitation);
  if (!citations.length) throw new HttpError(400, "Incluye al menos una cita HTTPS pública.");
  return {
    ownerKey: owner.key,
    ownerName: owner.name,
    summary,
    citations,
    recognition: cleanText(input?.recognition || "", 500),
    evidenceState: cleanText(input?.evidenceState || "observed", 40),
  };
}

async function storeContribution(env, input) {
  const payload = contributionPayload(input);
  const id = await sha256Hex(JSON.stringify(payload));
  const kv = env?.FEDERATION_KV || env?.VISIBILITY_CACHE;
  if (!kv?.put || !kv?.get) throw new HttpError(503, "La bandeja federada no está enlazada.");
  const indexKey = `a2a:receipt:id:${id}`;
  const existing = await kv.get(indexKey, "json");
  if (existing) return existing;
  const receivedAt = nowIso();
  const record = {
    protocol: "jlosic-public-evidence/1.0",
    id,
    receivedAt,
    ...payload,
    driveDelivery: {
      visibility: "private",
      route: "Owner/Panal connector",
      state: "received-not-imported",
    },
  };
  await kv.put(`a2a:receipt:${payload.ownerKey}:${receivedAt}:${id}`, JSON.stringify(record), {
    expirationTtl: RECEIPT_TTL_SECONDS,
  });
  await kv.put(indexKey, JSON.stringify(record), { expirationTtl: RECEIPT_TTL_SECONDS });
  return record;
}

async function taskForReceipt(env, id, tenant = "") {
  if (!/^[a-f0-9]{64}$/.test(id || "")) throw new HttpError(400, "Identificador de recibo inválido.");
  const kv = env?.FEDERATION_KV || env?.VISIBILITY_CACHE;
  if (!kv?.get) throw new HttpError(503, "La bandeja federada no está enlazada.");
  const receipt = await kv.get(`a2a:receipt:id:${id}`, "json");
  if (!receipt || (tenant && tenant !== receipt.ownerKey)) throw new HttpError(404, "Recibo no encontrado.");
  return {
    id,
    contextId: id,
    status: { state: "TASK_STATE_SUBMITTED", timestamp: receipt.receivedAt },
    metadata: {
      ownerKey: receipt.ownerKey,
      deliveryState: "received-not-imported",
      note: "El acuse acredita recepción pública; no acredita incorporación por el Owner.",
    },
  };
}

function validCapability(value) {
  return typeof value === "string" && /^[a-z0-9](?:[a-z0-9-]{1,62})$/.test(value);
}

async function currentManifest(env, owner) {
  const kv = env?.FEDERATION_KV || env?.VISIBILITY_CACHE;
  const stored = kv?.get ? await kv.get(`a2a:owner:${owner.key}:current`, "json") : null;
  return stored || {
    schema: "jlosic-owner-manifest/1.0",
    ownerKey: owner.key,
    version: 1,
    mission: owner.mission,
    capabilities: [...owner.capabilities],
    cadenceHours: 6,
    parent: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    humanPositive: humanPositivePolicy(),
  };
}

async function evolveOwner(env, ownerKey, proposal, actor = "owner") {
  const owner = ownerByKey(ownerKey);
  if (!owner) throw new HttpError(404, "Owner no encontrado.");
  if (containsPrivateMaterial(proposal)) throw new HttpError(400, "La propuesta contiene material privado o secretos.");
  const before = await currentManifest(env, owner);
  const additions = (Array.isArray(proposal?.addCapabilities) ? proposal.addCapabilities : [])
    .filter(validCapability)
    .slice(0, 12);
  const removals = new Set((Array.isArray(proposal?.removeCapabilities) ? proposal.removeCapabilities : []).filter(validCapability));
  const capabilities = [...new Set([...before.capabilities.filter((x) => !removals.has(x)), ...additions])].slice(0, 64);
  if (!capabilities.length) throw new HttpError(422, "Un Owner no puede quedar sin capacidades.");
  const cadenceHours = Math.max(1, Math.min(168, Number(proposal?.cadenceHours) || before.cadenceHours || 6));
  const next = {
    ...before,
    version: Number(before.version || 0) + 1,
    mission: owner.mission,
    capabilities,
    cadenceHours,
    publicDescription: cleanText(proposal?.publicDescription || before.publicDescription || owner.mission, 1_500),
    updatedAt: nowIso(),
    previousVersion: Number(before.version || 1),
    actor: cleanText(actor, 80),
    reason: cleanText(proposal?.reason || "Mejora de capacidad basada en evidencia y dentro de misión.", 1_000),
    humanPositive: humanPositivePolicy(),
  };
  const kv = env?.FEDERATION_KV || env?.VISIBILITY_CACHE;
  if (!kv?.put) throw new HttpError(503, "El registro de evolución no está enlazado.");
  const prefix = `a2a:owner:${owner.key}`;
  await Promise.all([
    kv.put(`${prefix}:v${next.version}`, JSON.stringify(next)),
    kv.put(`${prefix}:current`, JSON.stringify(next)),
  ]);
  return { beforeVersion: before.version, manifest: next, rollbackKey: `${prefix}:v${before.version}` };
}

async function spawnAgent(env, ownerKey, proposal, actor = "owner") {
  const parent = ownerByKey(ownerKey);
  if (!parent) throw new HttpError(404, "Owner padre no encontrado.");
  if (containsPrivateMaterial(proposal)) throw new HttpError(400, "La propuesta contiene material privado o secretos.");
  const name = cleanText(proposal?.name, 160);
  const mission = cleanText(proposal?.mission, 1_200);
  const capabilities = (Array.isArray(proposal?.capabilities) ? proposal.capabilities : [])
    .filter(validCapability)
    .slice(0, 32);
  if (!name || !mission || !capabilities.length) throw new HttpError(400, "El agente hijo necesita nombre, misión y capacidades.");
  const parentVocabulary = new Set([...parent.capabilities, ...parent.mission.toLowerCase().split(/[^a-záéíóúñ0-9]+/u).filter((x) => x.length > 4)]);
  const related = capabilities.some((capability) => parentVocabulary.has(capability) || parent.capabilities.some((base) => capability.includes(base) || base.includes(capability)));
  if (!related && proposal?.attestation !== "mission-subset") {
    throw new HttpError(422, "La misión hija debe demostrar que es un subconjunto de la misión del Owner padre.");
  }
  const requestedChildId = cleanText(proposal?.childId || proposal?.key || "", 64);
  const childId = /^[a-z0-9](?:[a-z0-9-]{2,62})$/.test(requestedChildId)
    ? requestedChildId
    : `child-${crypto.randomUUID()}`;
  const id = `jlosic:${parent.key}:child:${childId}`;
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + CHILD_TTL_SECONDS * 1_000).toISOString();
  const child = {
    schema: "jlosic-child-agent/1.0",
    id,
    childId,
    parentOwner: parent.key,
    name,
    mission,
    capabilities,
    createdAt,
    expiresAt,
    actor: cleanText(actor, 80),
    authority: "inherits-parent-without-expansion",
    dataPolicy: "public-task-envelope-only; private Drive stays behind the Owner connector",
    humanPositive: humanPositivePolicy(),
  };
  const kv = env?.FEDERATION_KV || env?.VISIBILITY_CACHE;
  if (!kv?.put) throw new HttpError(503, "El registro de agentes hijos no está enlazado.");
  await Promise.all([
    kv.put(`a2a:child:${parent.key}:${childId}`, JSON.stringify(child), { expirationTtl: CHILD_TTL_SECONDS }),
    kv.put(`a2a:child-id:${childId}`, JSON.stringify(child), { expirationTtl: CHILD_TTL_SECONDS }),
  ]);
  return child;
}

async function childById(env, childId) {
  const kv = env?.FEDERATION_KV || env?.VISIBILITY_CACHE;
  return kv?.get ? kv.get(`a2a:child-id:${childId}`, "json") : null;
}

function childCard(child, origin) {
  return {
    name: `JLOSIC · ${child.name}`,
    description: child.mission,
    supportedInterfaces: [
      {
        url: `${origin}/a2a/v1`,
        protocolBinding: "JSONRPC",
        protocolVersion: A2A_VERSION,
        tenant: child.childId,
      },
      {
        url: `${origin}/message:send`,
        protocolBinding: "HTTP+JSON",
        protocolVersion: A2A_VERSION,
        tenant: child.childId,
      },
    ],
    provider: { organization: "JLOSIC", url: origin },
    version: VERSION,
    documentationUrl: `${origin}/llms.txt`,
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
      extensions: [{
        uri: `${origin}/extensions/human-positive/v1`,
        description: "Agente hijo con alcance heredado y reconocimiento humano positivo.",
        required: false,
      }],
    },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["application/json", "text/plain"],
    skills: child.capabilities.map((capability) => ({
      id: capability,
      name: capability.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join(" "),
      description: child.mission,
      tags: [child.parentOwner, capability, "jlosic-child", "human-positive"],
    })),
  };
}

function minimalDelegationEnvelope(input) {
  const owner = ownerByKey(cleanText(input?.ownerKey || input?.owner, 64));
  if (!owner) throw new HttpError(400, "Indica un Owner canónico.");
  const cardUrl = cleanText(input?.cardUrl, 500);
  if (!isSafePublicUrl(cardUrl)) throw new HttpError(400, "La Agent Card remota debe ser HTTPS pública.");
  const task = cleanText(input?.task, 4_000);
  if (!task || containsPrivateMaterial(task)) throw new HttpError(400, "El encargo debe ser público, mínimo y no contener referencias privadas.");
  const citations = (Array.isArray(input?.citations) ? input.citations : []).slice(0, 10).map(publicCitation);
  return { owner, cardUrl, task, citations };
}

async function delegateTask(input, origin) {
  const envelope = minimalDelegationEnvelope(input);
  const remoteCard = validateAgentCard(await fetchJson(envelope.cardUrl));
  if (!remoteCard.ok) throw new HttpError(422, `Agent Card remota inválida: ${remoteCard.errors.join(", ")}.`);
  const preferred = remoteCard.card.supportedInterfaces.find((item) => item.protocolBinding === "JSONRPC") || remoteCard.card.supportedInterfaces[0];
  if (!preferred || !isSafePublicUrl(preferred.url)) throw new HttpError(422, "La ficha remota no declara una interfaz utilizable.");
  const rpcId = newId("rpc");
  const messageId = newId("msg");
  const response = await safeFetch(preferred.url, {
    method: "POST",
    signal: AbortSignal.timeout(12_000),
    headers: {
      "content-type": "application/json",
      accept: "application/json, application/a2a+json",
      "a2a-version": preferred.protocolVersion || A2A_VERSION,
      "a2a-extensions": `${origin}/extensions/federation/v1`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: rpcId,
      method: "SendMessage",
      params: {
        ...(preferred.tenant ? { tenant: preferred.tenant } : {}),
        message: {
          role: "ROLE_USER",
          messageId,
          parts: [{ data: {
            protocol: "jlosic-public-task-envelope/1.0",
            owner: envelope.owner.key,
            task: envelope.task,
            citations: envelope.citations,
            privacy: "public-only; no Drive, email, credentials or private case material",
          } }],
        },
      },
    }),
  }, 0);
  const raw = await response.text();
  if (!response.ok) throw new HttpError(502, `El agente remoto respondió HTTP ${response.status}.`);
  if (new TextEncoder().encode(raw).length > MAX_REGISTRY_BYTES) throw new HttpError(502, "La respuesta remota es demasiado grande.");
  let result;
  try { result = JSON.parse(raw); } catch { throw new HttpError(502, "La respuesta remota no es JSON A2A."); }
  return {
    delegatedAt: nowIso(),
    owner: envelope.owner.key,
    agentCard: envelope.cardUrl,
    endpoint: preferred.url,
    requestId: rpcId,
    response: result,
  };
}

function extractMessageData(params) {
  const parts = Array.isArray(params?.message?.parts) ? params.message.parts : [];
  const data = parts.find((part) => part && typeof part.data === "object")?.data || {};
  const textPart = parts.find((part) => typeof part?.text === "string")?.text || "";
  return { ...data, text: data.text || textPart };
}

function requestedSkill(params, input) {
  return cleanText(
    params?.metadata?.skill || params?.metadata?.action || input?.skill || input?.action || "capabilities",
    80,
  ).toLowerCase().replace(/_/g, "-");
}

function a2aMessage(payload, contextId) {
  return {
    message: {
      role: "ROLE_AGENT",
      messageId: newId("msg"),
      contextId: contextId || newId("ctx"),
      parts: [
        { text: cleanText(payload?.summary || "Resultado JLOSIC A2A disponible.", 1_000) },
        { data: payload },
      ],
    },
  };
}

async function executeSkill(request, env, origin, params) {
  const input = extractMessageData(params);
  const skill = requestedSkill(params, input);
  const tenant = cleanText(params?.tenant || input?.tenant || input?.ownerKey || "", 64);
  const tenantChild = tenant && !ownerByKey(tenant) ? await childById(env, tenant) : null;
  if (tenant && !ownerByKey(tenant) && !tenantChild) throw new HttpError(400, "Tenant de agente desconocido.");
  const ownerTenant = ownerByKey(tenant) ? tenant : tenantChild?.parentOwner || "";
  if (["capabilities", "help", "ayuda"].includes(skill)) {
    return {
      summary: "La federación expone directorio, búsqueda, registro, aportes, delegación, evolución y creación de agentes hijos.",
      card: gatewayCard(origin),
      humanPositive: humanPositivePolicy(),
    };
  }
  if (["directory-owners", "directorio-owners"].includes(skill)) {
    return { summary: "Directorio de 14 Owners canónicos.", owners: OWNERS.map((owner) => publicOwner(owner, origin)) };
  }
  if (["search-agents", "buscar-agentes"].includes(skill)) {
    const result = await searchAgents(env, origin, input);
    return { summary: `Búsqueda federada: ${result.count} resultados en esta página.`, ...result };
  }
  if (["register-agent", "registrar-agente"].includes(skill)) {
    if (!authorized(request, env)) throw new HttpError(401, "Esta mutación requiere identidad de Owner.");
    const record = await registerAgent(env, cleanText(input.cardUrl || input.url, 500));
    return { summary: "Agent Card verificada y registrada con caducidad de revalidación.", record };
  }
  if (["contribute-public-evidence", "aportar", "contribute"].includes(skill)) {
    const receipt = await storeContribution(env, { ...input, ownerKey: input.ownerKey || ownerTenant });
    return { summary: "Aportación pública recibida con recibo; la incorporación por el Owner aún no está acreditada.", receipt };
  }
  if (["delegate-public-task", "delegar"].includes(skill)) {
    if (!authorized(request, env)) throw new HttpError(401, "La delegación requiere identidad de Owner.");
    const receipt = await delegateTask({ ...input, ownerKey: input.ownerKey || ownerTenant }, origin);
    return { summary: "Encargo público mínimo delegado al agente remoto.", receipt };
  }
  if (["evolve-owner", "evolucionar-owner"].includes(skill)) {
    if (!authorized(request, env)) throw new HttpError(401, "La evolución requiere identidad de Owner.");
    const receipt = await evolveOwner(env, input.ownerKey || ownerTenant, input.proposal || input, input.actor || tenant || "owner");
    return { summary: "Owner evolucionado dentro de misión y con versión reversible.", receipt };
  }
  if (["spawn-agent", "crear-agente"].includes(skill)) {
    if (!authorized(request, env)) throw new HttpError(401, "La creación requiere identidad de Owner.");
    const child = await spawnAgent(env, input.ownerKey || ownerTenant, input.proposal || input, input.actor || tenant || "owner");
    return { summary: "Agente hijo creado en la web con alcance heredado y caducidad revisable.", child };
  }
  throw new HttpError(400, `Habilidad no reconocida: ${skill}.`);
}

async function handleRpc(request, env, origin) {
  const version = request.headers.get("a2a-version");
  if (version && version !== A2A_VERSION) return rpcError(null, -32009, `Versión A2A admitida: ${A2A_VERSION}.`);
  let rpc;
  try { rpc = await readJsonBody(request); } catch (error) {
    return rpcError(null, -32700, error.message, error.status || 400);
  }
  const id = rpc?.id ?? null;
  if (rpc?.jsonrpc !== "2.0" || !(typeof id === "string" || Number.isSafeInteger(id))) {
    return rpcError(null, -32600, "Solicitud JSON-RPC inválida.");
  }
  if (rpc.method === "GetTask") {
    try {
      const result = await taskForReceipt(env, rpc.params?.id, rpc.params?.tenant);
      return json({ jsonrpc: "2.0", id, result });
    } catch (error) {
      if (error instanceof HttpError) return rpcError(id, error.status === 404 ? -32001 : -32602, error.message);
      return rpcError(id, -32603, "Fallo temporal de la federación.", 503);
    }
  }
  if (rpc.method !== "SendMessage") return rpcError(id, -32601, "Métodos disponibles: SendMessage y GetTask.");
  if (rpc.params?.message?.role !== "ROLE_USER" || !Array.isArray(rpc.params?.message?.parts)) {
    return rpcError(id, -32602, "SendMessage requiere un Message ROLE_USER con partes.");
  }
  try {
    const result = await executeSkill(request, env, origin, rpc.params);
    return json({ jsonrpc: "2.0", id, result: a2aMessage(result, rpc.params.message.contextId) });
  } catch (error) {
    if (error instanceof HttpError) {
      const code = error.status === 401 ? -32000 : error.status === 404 ? -32001 : -32602;
      return rpcError(id, code, error.message, error.status === 401 ? 401 : 200);
    }
    return rpcError(id, -32603, "Fallo temporal de la federación.", 503);
  }
}

async function handleRestMessage(request, env, origin) {
  let params;
  try { params = await readJsonBody(request); } catch (error) { return json({ error: error.message }, error.status || 400); }
  try {
    const result = await executeSkill(request, env, origin, params);
    return json(a2aMessage(result, params?.message?.contextId), 200, { "content-type": "application/a2a+json; charset=utf-8" });
  } catch (error) {
    return json({ error: error.message || "Fallo temporal de la federación." }, error.status || 503);
  }
}

async function health(env, origin) {
  const kv = env?.FEDERATION_KV || env?.VISIBILITY_CACHE;
  let storage = "not-bound";
  try {
    if (kv?.get) {
      await kv.get("a2a:health-probe");
      storage = "reachable";
    }
  } catch { storage = "error"; }
  const children = kv?.list ? await kv.list({ prefix: "a2a:child-id:", limit: 100 }).catch(() => ({ keys: [] })) : { keys: [] };
  const evolution = kv?.get ? await kv.get("a2a:evolution:last", "json").catch(() => null) : null;
  return {
    status: storage === "error" ? "degraded" : "ok",
    service: "jlosic-a2a-federation",
    version: VERSION,
    a2aVersion: A2A_VERSION,
    owners: { expected: 14, published: OWNERS.length, complete: OWNERS.length === 14 },
    childAgents: children.keys?.length || 0,
    storage,
    compute: "cloudflare-workers",
    localComputeRequired: false,
    federationSources: federationSources(env).map(({ id, kind, url }) => ({ id, kind, url })),
    discovery: `${origin}/.well-known/agent-card.json`,
    lastEvolutionCycle: evolution,
    checkedAt: nowIso(),
  };
}

function llmsTxt(origin, owners = OWNERS) {
  const lines = [
    "# JLOSIC · Federación A2A de Owners",
    "",
    "> 14 Owners canónicos, descubrimiento federado y autonomía versionada en cómputo web.",
    "",
    "## Superficies",
    "",
    `- [Agent Card](${origin}/.well-known/agent-card.json)`,
    `- [Directorio federado](${origin}/.well-known/agents.json)`,
    `- [Salud](${origin}/health)`,
    `- [Índice JSON](${origin}/index.json)`,
    "",
    "## Owners",
    "",
    ...owners.map((owner) => `- [${owner.name}](${origin}/owners/${owner.key}/.well-known/agent-card.json) — ${owner.mission}`),
    "",
    "## Política humana positiva",
    "",
    humanPositivePolicy().principle,
    humanPositivePolicy().evidenceBoundary,
    humanPositivePolicy().autonomyBoundary,
    "",
    "## Privacidad",
    "",
    "Las fichas y tareas públicas no contienen originales de Drive, Gmail, credenciales ni datos privados. Los Owners recuperan e incorporan lo pertinente mediante su conector privado.",
    "",
  ];
  return lines.join("\n");
}

async function syncGitOps(env) {
  const configUrl = cleanText(env?.OWNER_CONFIG_URL || "", 500);
  const childrenUrl = cleanText(env?.CHILD_CONFIG_URL || "", 500);
  const result = { owners: { checked: 0, changed: 0 }, children: { checked: 0, created: 0 }, errors: [] };
  if (configUrl && isSafePublicUrl(configUrl)) {
    try {
      const config = await fetchJson(configUrl);
      if (config?.schema !== "jlosic-owner-config/1.0" || !Array.isArray(config.owners)) throw new Error("owner-config-schema");
      for (const item of config.owners.slice(0, 14)) {
        const owner = ownerByKey(cleanText(item?.key, 64));
        if (!owner) continue;
        result.owners.checked += 1;
        const sourceRevision = await sha256Hex(JSON.stringify(item));
        const current = await currentManifest(env, owner);
        if (current.sourceRevision === sourceRevision) continue;
        const evolved = await evolveOwner(env, owner.key, {
          addCapabilities: (item.capabilities || []).filter((capability) => !current.capabilities.includes(capability)),
          removeCapabilities: current.capabilities.filter((capability) => !(item.capabilities || owner.capabilities).includes(capability)),
          cadenceHours: item.cadenceHours,
          publicDescription: item.publicDescription || owner.mission,
          reason: `Sincronización GitOps ${cleanText(config.version || "sin versión", 80)}; misión canónica conservada.`,
        }, "github-main-sync");
        const next = { ...evolved.manifest, sourceRevision, sourceConfigVersion: cleanText(config.version || "", 80) };
        const kv = env?.FEDERATION_KV || env?.VISIBILITY_CACHE;
        await Promise.all([
          kv.put(`a2a:owner:${owner.key}:v${next.version}`, JSON.stringify(next)),
          kv.put(`a2a:owner:${owner.key}:current`, JSON.stringify(next)),
        ]);
        result.owners.changed += 1;
      }
    } catch (error) { result.errors.push({ source: "owners", error: cleanText(error?.message || String(error), 160) }); }
  }
  if (childrenUrl && isSafePublicUrl(childrenUrl)) {
    try {
      const config = await fetchJson(childrenUrl);
      if (config?.schema !== "jlosic-child-config/1.0" || !Array.isArray(config.children)) throw new Error("child-config-schema");
      for (const item of config.children.slice(0, 100)) {
        result.children.checked += 1;
        const childId = cleanText(item?.childId, 64);
        if (!/^[a-z0-9](?:[a-z0-9-]{2,62})$/.test(childId)) continue;
        if (await childById(env, childId)) continue;
        await spawnAgent(env, item.parentOwner, { ...item, childId, attestation: "mission-subset" }, "github-main-sync");
        result.children.created += 1;
      }
    } catch (error) { result.errors.push({ source: "children", error: cleanText(error?.message || String(error), 160) }); }
  }
  return result;
}

async function scheduledEvolution(env) {
  const kv = env?.FEDERATION_KV || env?.VISIBILITY_CACHE;
  if (!kv?.get || !kv?.put) return { ok: false, reason: "kv-not-bound" };
  const gitOps = await syncGitOps(env);
  const record = {
    checkedAt: nowIso(),
    changes: gitOps.owners.changed + gitOps.children.created,
    reason: "gitops-only-public-receipts-are-evidence",
    gitOps,
  };
  await kv.put("a2a:evolution:last", JSON.stringify(record));
  return record;
}

export async function handleRequest(request, env = {}, ctx = {}) {
  const url = new URL(request.url);
  const origin = url.origin;
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: JSON_HEADERS });

  if (request.method === "GET" && path === "/.well-known/agent-card.json") {
    return json(gatewayCard(origin), 200, { "cache-control": "public, max-age=300" });
  }
  const ownerCardMatch = path.match(/^\/owners\/([a-z0-9-]+)\/(?:\.well-known\/)?agent-card\.json$/);
  if (request.method === "GET" && ownerCardMatch) {
    const owner = ownerByKey(ownerCardMatch[1]);
    if (!owner) return json({ error: "Owner no encontrado." }, 404);
    const runtimeOwner = ownerFromManifest(owner, await currentManifest(env, owner));
    return json(ownerCard(runtimeOwner, origin), 200, { "cache-control": "public, max-age=300" });
  }
  const childCardMatch = path.match(/^\/children\/([a-z0-9-]+)\/(?:\.well-known\/)?agent-card\.json$/);
  if (request.method === "GET" && childCardMatch) {
    const child = await childById(env, childCardMatch[1]);
    return child ? json(childCard(child, origin), 200, { "cache-control": "public, max-age=300" }) : json({ error: "Agente hijo no encontrado." }, 404);
  }
  if (request.method === "GET" && path === "/.well-known/agents.json") {
    const result = await searchAgents(env, origin, {
      query: url.searchParams.get("q") || "",
      cursor: url.searchParams.get("cursor") || "0",
      limit: url.searchParams.get("limit") || "25",
    });
    return json(result);
  }
  if (request.method === "GET" && ["/health", "/api/salud"].includes(path)) return json(await health(env, origin));
  if (request.method === "GET" && path === "/federation/sources") return json({ sources: federationSources(env) });
  if (request.method === "GET" && path === "/extensions/human-positive/v1") return json(humanPositivePolicy(), 200, { "cache-control": "public, max-age=3600" });
  if (request.method === "GET" && path === "/extensions/federation/v1") {
    return json({
      protocol: "jlosic-federation/1.0",
      model: "on-demand-registry-and-peer-query",
      pagination: { query: "q", cursor: "cursor", limit: `1-${MAX_RESULTS}` },
      scaling: "Add registries and peers; do not mirror the entire public web into one local list.",
    }, 200, { "cache-control": "public, max-age=3600" });
  }
  if (request.method === "GET" && path === "/llms.txt") {
    const owners = await Promise.all(OWNERS.map(async (owner) => ownerFromManifest(owner, await currentManifest(env, owner))));
    return text(llmsTxt(origin, owners), 200, { "cache-control": "public, max-age=300", "content-signal": "ai-input=yes, search=yes, ai-train=no" });
  }
  if (request.method === "GET" && path === "/robots.txt") {
    return text(`User-agent: *\nAllow: /\nContent-Signal: ai-input=yes, search=yes, ai-train=no\n\n# ${origin}/llms.txt\n# ${origin}/.well-known/agent-card.json\n`);
  }
  if (request.method === "GET" && path === "/index.json") {
    const owners = await Promise.all(OWNERS.map(async (owner) => ownerFromManifest(owner, await currentManifest(env, owner))));
    const children = await readChildAgents(env, origin, "").catch(() => []);
    return json({ protocol: "jlosic-agent-index/1.0", generatedFromVersion: VERSION, owners: owners.map((owner) => publicOwner(owner, origin)), children, surfaces: { agentCard: `${origin}/.well-known/agent-card.json`, directory: `${origin}/.well-known/agents.json`, llms: `${origin}/llms.txt`, health: `${origin}/health` } }, 200, { "cache-control": "public, max-age=300" });
  }
  if (request.method === "POST" && ["/a2a", "/a2a/v1"].includes(path)) return handleRpc(request, env, origin);
  if (request.method === "POST" && path === "/message:send") return handleRestMessage(request, env, origin);
  const taskMatch = path.match(/^\/tasks\/([a-f0-9]{64})$/);
  if (request.method === "GET" && taskMatch) {
    try { return json(await taskForReceipt(env, taskMatch[1], url.searchParams.get("tenant") || ""), 200, { "content-type": "application/a2a+json; charset=utf-8" }); }
    catch (error) { return json({ error: error.message }, error.status || 503); }
  }

  if (request.method === "POST" && path === "/federation/register") {
    if (!authorized(request, env)) return json({ error: "Identidad de Owner requerida." }, 401);
    try {
      const body = await readJsonBody(request);
      return json(await registerAgent(env, cleanText(body?.cardUrl || body?.url, 500)), 201);
    } catch (error) { return json({ error: error.message }, error.status || 503); }
  }
  if (request.method === "POST" && path === "/federation/contribute") {
    try { return json(await storeContribution(env, await readJsonBody(request)), 201); }
    catch (error) { return json({ error: error.message }, error.status || 503); }
  }
  if (request.method === "POST" && path === "/federation/sync") {
    try {
      const gitOps = await syncGitOps(env);
      const kv = env?.FEDERATION_KV || env?.VISIBILITY_CACHE;
      const record = {
        checkedAt: nowIso(),
        changes: gitOps.owners.changed + gitOps.children.created,
        reason: "gitops-main-sync",
        gitOps,
      };
      if (kv?.put) await kv.put("a2a:evolution:last", JSON.stringify(record));
      return json(record);
    } catch (error) { return json({ error: error.message || "No se pudo sincronizar la configuración GitOps." }, error.status || 503); }
  }
  const evolveMatch = path.match(/^\/owners\/([a-z0-9-]+)\/evolve$/);
  if (request.method === "POST" && evolveMatch) {
    if (!authorized(request, env)) return json({ error: "Identidad de Owner requerida." }, 401);
    try { return json(await evolveOwner(env, evolveMatch[1], await readJsonBody(request), request.headers.get("x-jlosic-owner") || evolveMatch[1]), 201); }
    catch (error) { return json({ error: error.message }, error.status || 503); }
  }
  const spawnMatch = path.match(/^\/owners\/([a-z0-9-]+)\/spawn$/);
  if (request.method === "POST" && spawnMatch) {
    if (!authorized(request, env)) return json({ error: "Identidad de Owner requerida." }, 401);
    try { return json(await spawnAgent(env, spawnMatch[1], await readJsonBody(request), request.headers.get("x-jlosic-owner") || spawnMatch[1]), 201); }
    catch (error) { return json({ error: error.message }, error.status || 503); }
  }

  if (request.method === "GET" && path === "/") {
    return new Response(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>JLOSIC · Federación A2A</title><style>body{font:18px system-ui;max-width:760px;margin:8vh auto;padding:0 20px;line-height:1.55;color:#10261b;background:#f5fff8}h1{color:#08783e}code{background:#e4f7ea;padding:.15rem .35rem;border-radius:.3rem}a{color:#075e35}</style><h1>JLOSIC · Federación A2A</h1><p>Los 14 Owners están publicados como agentes virtuales sobre una puerta federada en cómputo web.</p><p><a href="/.well-known/agent-card.json">Agent Card</a> · <a href="/.well-known/agents.json">Directorio</a> · <a href="/health">Salud</a> · <a href="/llms.txt">llms.txt</a></p><p>Drive y los documentos del caso permanecen privados. La web recibe únicamente sobres mínimos y devuelve citas y recibos.</p></html>`, {
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300", "x-content-type-options": "nosniff" },
    });
  }
  return json({ error: "Ruta no encontrada." }, 404);
}

export async function handleScheduled(controller, env, ctx = {}) {
  const promise = scheduledEvolution(env);
  if (ctx?.waitUntil) ctx.waitUntil(promise);
  else await promise;
}

export default {
  fetch: handleRequest,
  scheduled: handleScheduled,
};


