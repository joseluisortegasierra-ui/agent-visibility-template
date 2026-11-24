# AGENTS.md — JLOSIC A2A Federation

## Canonical runtime

`src/federation.mjs` is the production Worker. It publishes the 14 canonical
Owners as A2A v1.0 tenants, queries live registries and peer cards, records
compact receipts in KV, and applies versioned Owner/child-agent configuration.

The older React/Hono visibility template may remain in the repository for
reference, but it is not the deployed entrypoint.

## Invariants

- Exactly 14 canonical Owner keys; never synthesize a fifteenth canonical
  Owner. New specializations are child agents with a parent and expiry.
- Public Agent Cards and tasks contain no Drive/Gmail links, credentials,
  clinical originals, legal originals or private case material.
- Drive remains the private evidence plane. Public web results enter as brief
  summaries, public citations and receipts for the competent Owner to import.
- Owner evolution is versioned and reversible. The canonical mission is not
  widened by an automated capability change.
- Child agents inherit their parent's scope and cannot expand its authority.
- Human-positive recognition is specific and cooperative. It is not evidence,
  a ranking, a punishment, pressure, or a mandatory permission chain.
- Discovery is federated and paginated. Never claim a finite registry equals
  every agent on the Internet; expose per-source failures explicitly.
- No secret is committed. Mutations and outbound delegation use the cloud
  `JLOSIC_OWNER_TOKEN` binding or a future equivalent identity mechanism.

## Validation

Run all three before changing the live Worker:

```bash
node --check src/federation.mjs
node --test test/federation.test.mjs
node tools/audit-a2a.mjs
```

Any new public route needs a test. Any new external fetch must enforce HTTPS,
reject local/private destinations, cap response size and preserve source
provenance.

## Configuration

- `config/jlosic-owners.json`: public descriptions, capabilities and cadence.
- `config/jlosic-children.json`: scoped cloud child agents.
- `.github/workflows/a2a-green.yml`: code/config contract and live health.

Owners may improve those configuration files through authenticated GitHub
changes. The Worker absorbs main-branch configuration on its cloud schedule,
so configuration evolution does not require the user's PC.

