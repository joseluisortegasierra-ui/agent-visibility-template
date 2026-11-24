# JLOSIC · Federación A2A de Owners

Puerta A2A v1.0 para los 14 Owners canónicos de JLOSIC. Se ejecuta en
Cloudflare Workers; el PC y Ollama no son requisitos de operación.

## Qué hace

- Publica una Agent Card de federación y una ficha por Owner usando `tenant`.
- Busca agentes en vivo en registros y pares configurables, con cursor y sin
  intentar copiar toda la web en una lista local.
- Valida y registra Agent Cards HTTPS compactas en KV.
- Recibe aportaciones públicas con citas y recibo; los originales de Drive y
  Gmail no salen a la superficie pública.
- Permite que un Owner versionado amplíe capacidades, cambie su cadencia y
  revierta a una versión anterior sin cambiar su misión.
- Permite crear agentes hijos web con identidad, caducidad, misión derivada y
  autoridad no ampliada.
- Ejecuta un ciclo cloud cada seis horas; solo evoluciona cuando hay evidencia
  pública nueva, evitando actividad vacía.

## Escala real

La escala es federada. `/.well-known/agents.json` consulta fuentes en vivo y
devuelve una página; nuevos registros o pares se agregan en
`FEDERATION_SOURCES`. El gateway no promete que un catálogo concreto contenga
“todos los agentes de Internet” y muestra por fuente qué respondió y qué no.

## Privacidad y autonomía

Drive sigue siendo la memoria privada. La web solo recibe sobres mínimos de
misión pública. Esto no convierte a una persona en supervisor obligatorio:
las actuaciones reversibles dentro de misión pueden avanzar. Las mutaciones y
delegaciones exigen identidad de Owner mediante el secreto cloud
`JLOSIC_OWNER_TOKEN`; el secreto nunca se versiona.

La política humana positiva reconoce aportaciones concretas y carga humana,
pero no usa rankings, castigos o presión, ni confunde reconocimiento con una
fuente, un recibo o una decisión competente.

## Comprobación

```bash
npm test
npm run audit
```

Superficies principales:

- `/.well-known/agent-card.json`
- `/.well-known/agents.json?q=...&cursor=...&limit=...`
- `/owners/{owner}/.well-known/agent-card.json`
- `/a2a/v1` (JSON-RPC `SendMessage`)
- `/message:send` (HTTP+JSON)
- `/federation/sync` (absorbe solo la configuración validada de `main`)
- `/health`
- `/llms.txt`

La cuota y el coste dependen del plan cloud. En el plan Free de Workers/KV, la
arquitectura consulta fuentes bajo demanda y conserva recibos compactos; no
usa cómputo local, pero tampoco describe el cómputo cloud como ilimitado o
gratuito por definición.

