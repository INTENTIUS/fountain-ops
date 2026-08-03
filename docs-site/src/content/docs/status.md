---
title: Status
description: Authoritative. Anywhere else something is described in the present tense, what is true is what this says.
---

**This page is authoritative.** Anywhere else that something is described in the
present tense — including the README — what is true is what this says.

## Verified

Stood up and exercised, not reasoned about.

| | |
|---|---|
| `target=k3d`, `tier=light` | Stood up, serves `/health/ready`, migrations ran |
| Bundled Postgres | 23 tables, app connects |
| Registering and signing in | Registered at `/auth/register`, `just verify-email`, reached `/onboarding/step_1` and `/conversations` |
| Provisioning a sandbox | Against the emulated data plane: a sprite is created and populated — the fountain skill and a `/home/sprite/.env` written into its filesystem |

## Does not work

| | |
|---|---|
| Completing a turn | The turn starts and is orphaned. fountain's reattach calls exec over plain HTTP; spritzer answers `426` — [spritzer#18](https://github.com/INTENTIUS/spritzer/issues/18) |
| Admin | `promote_admin/1` is not in the pinned `v0.3.0` — [#31](https://github.com/INTENTIUS/fountain-ops/issues/31) |

## Builds, unexercised

| | |
|---|---|
| `pg-dump` backup job | **Emitted, never run.** The CronJob applies; no backup has been taken or restored |
| `target=kubernetes` | Never applied to a real cluster. `postgres=reference` has never connected to anything — [#23](https://github.com/INTENTIUS/fountain-ops/issues/23) |
| `tier=standard`, `tier=ha` | The clustering wiring is emitted and unexercised. `standard` currently emits the same deployment as `light` — [#21](https://github.com/INTENTIUS/fountain-ops/issues/21) |
| `tls=cert-manager` | Builds only |
| `monitoring=prometheus-operator` | Builds only. Emitted nothing at all until the `tier.metrics` fix |
| `postgres=cnpg`, `backups=barman-pitr`, `ingress=traefik`, `secrets=infisical` | Build, and a real API server accepts the output (`just crds` then `just dry-run`). **No controller has reconciled any of it** — [#22](https://github.com/INTENTIUS/fountain-ops/issues/22) |
| `ops/` | Empty. No Ops exist yet |

## Why the table reads like this

A backup nobody has restored is a hypothesis, so the backup row says what it
says.

Three claims in this repo's docs have been tested and found false, twice by
building the thing rather than reading it: "nothing reads `process.env`", "any
tier runs on any target", and "add `postgres=cnpg` and `k3d + ha` builds". The
last one was true when it was written and was quietly falsified by a later seam.

That is why the specific claims here are asserted in tests where they can be,
and why this page prefers **Builds only** to a word that sounds better.
