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
| `pg-dump` → floci | **Taken and restored.** The CronJob dumps, uploads and size-verifies; `just restore-drill` restores the newest object into a throwaway database, matches its table count against live, and drops it. Non-destructive — the live database is untouched and only `fountain` remains afterwards |
| `target=kubernetes` on k3d | **Applied and served.** `postgres=reference` against a Postgres in another namespace that chant never created, `ingress=ingress` in front of a real nginx controller, `/health/ready` answering `{"database":"ok"}` through the Ingress rather than a port-forward. Not yet applied to a **managed** cluster — [#23](https://github.com/INTENTIUS/fountain-ops/issues/23) |
| `postgres=cnpg` | **The operator reconciles a real database.** `just operators`, then `postgres=cnpg`: CNPG reports `Cluster in healthy state`, fountain migrates 23 tables into it, and `/health/ready` answers `{"database":"ok"}` |
| `k3d` + `tier=ha` | **Stands up.** Two app replicas that form an Erlang cluster (libcluster logs the connect, and there are no failures between the live pods), backed by a CNPG cluster at 2/2 ready. Serves `/health/ready` |

## Does not work

| | |
|---|---|
| Completing a turn | The turn starts and is orphaned. fountain's reattach calls exec over plain HTTP; spritzer answers `426` — [spritzer#18](https://github.com/INTENTIUS/spritzer/issues/18) |
| Admin | `promote_admin/1` is not in the pinned `v0.3.0` — [#31](https://github.com/INTENTIUS/fountain-ops/issues/31) |

## Builds, unexercised

| | |
|---|---|
| `monitoring=prometheus-operator` | Builds only. Emitted nothing at all until the `tier.metrics` fix |
| `backups=barman-pitr` | The `ObjectStore` and `ScheduledBackup` apply and the barman plugin is running after `just operators`, but **no backup has been taken or restored through it** |
| `tls=cert-manager` (issuance) | cert-manager installs and is Available, but no certificate has been issued — a local cluster has no domain to issue against |
| `ingress=traefik`, `secrets=infisical`, `monitoring=prometheus-operator` | Build, and a real API server accepts the output. No controller has reconciled any of them: Traefik ships with k3s but nothing routes through it here, Infisical needs a server to talk to, and kube-prometheus-stack is not installed — [#22](https://github.com/INTENTIUS/fountain-ops/issues/22) |
| `ops/` | One Op: `fountain-apply`. behold discovers it and offers Run. The other eleven verbs in [#3](https://github.com/INTENTIUS/fountain-ops/issues/3) do not exist |

## Why the table reads like this

A backup nobody has restored is a hypothesis, so the backup row says what it
says.

Three claims in this repo's docs have been tested and found false, twice by
building the thing rather than reading it: "nothing reads `process.env`", "any
tier runs on any target", and "add `postgres=cnpg` and `k3d + ha` builds". The
last one was true when it was written and was quietly falsified by a later seam.

That is why the specific claims here are asserted in tests where they can be,
and why this page prefers **Builds only** to a word that sounds better.

Most of the **Verified** table is now re-asserted on every push rather than
having been true once. `just e2e` — the whole of CI's e2e job, and runnable on
a laptop — stands up from nothing and checks readiness through to the database,
the master key surviving a re-run, the backup restoring and matching live, the
account path end to end, and every seam against a real API server. The rows it
does not cover are the ones needing operators or a cluster this repo did not
create, and they are the rows that still say so.

It also pins the conversation gate to its *failure*, so
[spritzer#18](https://github.com/INTENTIUS/spritzer/issues/18) landing breaks
the build instead of quietly making this page wrong in the other direction.
