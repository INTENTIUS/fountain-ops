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

:::danger[Back the master key up separately from the database]
A full database restore cannot decrypt a single tenant credential without the
same `MASTER_SECRETS_KEY` the dump was written under. Losing the key is
equivalent to losing the data, and `just secret` stores it only in the cluster —
so on a real deployment, losing the cluster loses it.

```bash
I_MEAN_IT=1 just master-key | pbcopy
```

Put it somewhere the cluster is not: a password manager, a different account,
anywhere whose failure is uncorrelated with the database's. The opt-in is
required regardless of where stdout goes — a pipe, a CI step and a script's
command substitution are all places a secret should not appear by accident.
:::

## The restore drill

```bash
just restore-drill
```

The backup job says "Backup complete" when an object of the right size lands in
the store. That is the **upload** verified, not the dump — a corrupt dump of the
right size uploads perfectly cleanly, and you find out during the outage.

The drill restores the newest object into a throwaway database, counts the
tables against the live one, and drops the throwaway whether it passed or
failed. Nothing writes to the live database at any point.

```
  store:       http://fountain-floci.fountain.svc.cluster.local:4566 / fountain-backups
  throwaway:   fountain_drill_1785796929
  live tables: 23
  DRILL_KEY=pg_dump/fountain-2026-08-03T22-42-05Z.dump
  DRILL_RESTORED_TABLES=23
  ✓ restored 23 tables, matched live, threw the copy away
```

It compares against the live count rather than a number written here, because a
hardcoded 23 would pass a restore of last month's schema.

**A drill that cannot verify is a failing finding on the backup, not on the
drill** — the exit code and the message both say so:

```
  ✗ the latest backup did not restore.
    That is a finding on the backup, not on the drill.

    no backup object under pg_dump/ in fountain-backups
```

And it says what it did not prove: the restored rows are ciphertext without the
master key above.

## No value is in this repo

No secret value is in this repo, and none ever will be. The generation in
`just secret` is an interim standing in for a real chant capability —
[INTENTIUS/chant#1365](https://github.com/INTENTIUS/chant/issues/1365), which
proposes declaring a secret's *provenance* without its value.
