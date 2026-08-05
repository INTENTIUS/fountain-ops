---
title: Status
description: What is verified, what does not work, and what only builds. This page wins any disagreement with the rest of the docs.
---

**This page is authoritative.** Anywhere else that something is described in the
present tense, including the README, this page is the one that is right.

## Verified

Everything in this table has been stood up and exercised, not just reasoned
about.

| | |
|---|---|
| `target=k3d`, `tier=light` | Stood up, serves `/health/ready`, migrations ran |
| Bundled Postgres | 23 tables, app connects |
| Registering and signing in | Registered at `/auth/register`, self-verified at registration (fountain ADR 0011; `just verify-email` remains the escape hatch), reached `/onboarding/step_1` and `/conversations` |
| The first admin | The first verified account is promoted in-app (`FIRST_USER_ADMIN=true`, fountain ADR 0011), audit-recorded as `admin.role.granted`. E2e-asserted via `just promote-admin` reporting it already admin; the admin pages themselves have not been driven by anything here |
| Provisioning a sandbox | Against the emulated data plane: a sprite is created and populated with the fountain skill and a `/home/sprite/.env` written into its filesystem |
| `pg-dump` → floci | **Taken and restored.** The CronJob dumps, uploads and size-verifies; `just restore-drill` restores the newest object into a throwaway database, matches its table count against live, and drops it. Non-destructive: the live database is untouched and only `fountain` remains afterwards |
| `target=kubernetes` on k3d | **Applied and served.** `postgres=reference` against a Postgres in another namespace that chant never created, `ingress=ingress` in front of a real nginx controller, `/health/ready` answering `{"database":"ok"}` through the Ingress rather than a port-forward. Not yet applied to a **managed** cluster ([#23](https://github.com/INTENTIUS/fountain-ops/issues/23)) |
| `postgres=cnpg` | **The operator reconciles a real database.** `just operators`, then `postgres=cnpg`: CNPG reports `Cluster in healthy state`, fountain migrates 23 tables into it, and `/health/ready` answers `{"database":"ok"}` |
| `k3d` + `tier=ha` | **Stands up.** Two app replicas that form an Erlang cluster (libcluster logs the connect, and there are no failures between the live pods), backed by a CNPG cluster at 2/2 ready. Serves `/health/ready` |

## Does not work

| | |
|---|---|
| Completing a turn | **Sometimes, and it is a race.** If the sandbox reaches `ready` before fountain dispatches, it takes the reattach path, whose `list_sessions` call spritzer answers `426`, and the turn is orphaned ([spritzer#18](https://github.com/INTENTIUS/spritzer/issues/18)). If dispatch wins, the turn completes. A faster machine loses more often: 5 of 5 orphaned on a laptop, 2 of 2 completed on a CI runner ([#67](https://github.com/INTENTIUS/fountain-ops/issues/67)). A completed turn is still only spritzer echoing the command back, never a model |

## Builds, unexercised

| | |
|---|---|
| `monitoring=prometheus-operator` | Builds only. Emitted nothing at all until the `tier.metrics` fix |
| `backups=barman-pitr` | The `ObjectStore` and `ScheduledBackup` apply and the barman plugin is running after `just operators`, but **no backup has been taken or restored through it** |
| `tls=cert-manager` (issuance) | cert-manager installs and is Available, but no certificate has been issued, because a local cluster has no domain to issue against |
| `ingress=traefik`, `secrets=infisical`, `monitoring=prometheus-operator` | Build, and a real API server accepts the output. No controller has reconciled any of them: Traefik ships with k3s but nothing routes through it here, Infisical needs a server to talk to, and kube-prometheus-stack is not installed ([#22](https://github.com/INTENTIUS/fountain-ops/issues/22)) |
| `ops/` | One Op: `fountain-apply`. behold discovers it and offers Run. The other eleven verbs in [#3](https://github.com/INTENTIUS/fountain-ops/issues/3) do not exist |

## Why the table reads like this

A documented claim rots the moment nothing re-checks it. So the specific
claims here are asserted in tests where they can be, and this page prefers
**Builds only** to a word that sounds better. The backup row in particular
says "taken and restored" only because a restore has actually run; an
unrestored backup is a hypothesis.

Most of the **Verified** table is re-asserted on every push, not just true at
the time it was written. `just e2e`, which is the whole of CI's e2e job and
runnable on a laptop, stands up from nothing and checks readiness through to
the database, the master key surviving a re-run, the backup restoring and
matching live, the account path end to end, and every seam against a real API
server. The rows it does not cover are the ones needing operators or a cluster
this repo did not create, and those rows say so.

The conversation gate is the one row with two legitimate outcomes, so `just
e2e` asserts that the outcome matches the path taken rather than asserting a
result. A reattach that stops orphaning turns fails the build, which is how
this page finds out it has gone stale in the other direction.
