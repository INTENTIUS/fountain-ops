---
title: Secrets
description: One key, and why regenerating it looks exactly like a successful deploy.
---

`just secret` generates the platform secret and **never rotates an existing
one**.

That matters more than it looks. `MASTER_SECRETS_KEY` regenerated over an
existing database makes every stored secret unrecoverable — every tenant's
inference credentials are encrypted under it — and the deploy that does it looks
exactly like a successful deploy.

So the recipe reads before it writes, and leaves an existing secret alone:

```
secret fountain-secrets already exists — leaving it alone
```

CI asserts that: it stands the deployment up, re-runs `just up`, and compares
`MASTER_SECRETS_KEY` byte for byte.

## Two layers, and only one of them is this repo's

**Platform secrets** — `MASTER_SECRETS_KEY`, `SECRET_KEY_BASE`, `DATABASE_URL`,
`SPRITES_TOKEN`. Held in a secret store, injected into the release at start.
These are the operator's.

**Per-tenant credentials** — each tenant's own inference keys, encrypted
AES-256-GCM under `MASTER_SECRETS_KEY` and stored in fountain's Postgres. These
are the tenants'. fountain manages them; fountain-ops never touches them, it
only provisions the key that protects them.

The connection is the whole reason the first layer matters: it holds the key
that makes the second readable.

:::caution[Back the master key up separately from the database]
A full database restore cannot decrypt a single tenant credential without the
same `MASTER_SECRETS_KEY` the dump was written under. Losing the key is
equivalent to losing the data, and today `just secret` stores it only in the
cluster — so losing the cluster loses it.
:::

## No value is in this repo

No secret value is in this repo, and none ever will be. The generation in
`just secret` is an interim standing in for a real chant capability —
[INTENTIUS/chant#1365](https://github.com/INTENTIUS/chant/issues/1365), which
proposes declaring a secret's *provenance* without its value.
