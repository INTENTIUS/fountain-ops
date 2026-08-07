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
| `pg-dump` → floci | **Taken and restored, against every postgres mode.** The CronJob dumps, uploads and size-verifies; `just restore-drill` restores the newest object into a throwaway database, matches its table count against live, and drops it. Non-destructive: the live database is untouched and only `fountain` remains afterwards. Exercised against the bundled Postgres (every `just e2e`), the CNPG cluster, and a referenced Postgres in another namespace — the last two once, by hand, after the dump learned to read the same `DATABASE_URL` source the app does (it was silently broken at `cnpg`) |
| `target=kubernetes` on k3d | **Applied and served, twice, against two different ingress controllers.** `postgres=reference` against a Postgres in another namespace that chant never created, `ingress=ingress` in front of a real nginx controller, `/health/ready` answering `{"database":"ok"}` through the Ingress rather than a port-forward. Re-checked by `just e2e-k8s` on a three-node stand-in with k3s's bundled Traefik as the class. Not yet applied to a **managed** cluster ([#23](https://github.com/INTENTIUS/fountain-ops/issues/23)) |
| `postgres=cnpg` | **The operator reconciles a real database.** `just operators`, then `postgres=cnpg`: CNPG reports `Cluster in healthy state`, fountain migrates 23 tables into it, and `/health/ready` answers `{"database":"ok"}` |
| `k3d` + `tier=ha` | **Stands up, as one command.** `just operators`, then the four-parameter `just up` on [Make it durable](/fountain-ops/getting-started/make-it-durable/): two app replicas that form an Erlang cluster (libcluster logs the connect), backed by a CNPG cluster at 2/2 ready, a PDB on each. Serves `/health` through `just verify` and `/health/ready` with the database ok. The app pods wait for the CNPG primary before starting; on a brand-new database one replica may restart once, losing the race to create the migrations table and winning the retry |
| `kubernetes` + `tier=ha` | **Applied and served, on the stand-in.** `just e2e-k8s` on a three-node k3d cluster: two replicas land on different nodes, form an Erlang cluster through the headless Service (libcluster logs the connect), the PodDisruptionBudget applies, and `/health/ready` answers `{"database":"ok"}` through the Traefik Ingress against the referenced Postgres. Applied over a running `light`, so the in-place light→ha upgrade is exercised too. Still never a managed cluster ([#23](https://github.com/INTENTIUS/fountain-ops/issues/23)), and the data plane was never real — `SPRITES_TOKEN` stayed a placeholder |
| Every `target` × `tier` builds, and the refused pairs refuse | Asserted in the unit tests on every push: `kubernetes`+`ha` and both `light`s build on their default seams; `k3d`+`ha` refuses seam by seam (bundled Postgres, then the spritzer emulator, then floci) until all three are overridden, then builds |
| `backups=barman-pitr` | **Taken and restored, repeatably.** With `postgres=cnpg` + `storage=floci` on k3d: `ContinuousArchiving` reports `True`, an on-demand `Backup` through the barman plugin completes (base backup + WAL stream, real objects in the bucket), and `just pitr-drill` bootstraps a throwaway recovery `Cluster` from the ObjectStore, matches its table count against live, and deletes it — the drill is a recipe now, not a one-off. Not proven: the nightly `ScheduledBackup` firing on its own, and any of it against a real S3 bucket |

## Does not work

| | |
|---|---|
| Completing a turn | **Never, against the emulator, as of fountain v0.6.0 — and now by upstream design.** Both arms of the race end short of a completed turn: the reattach path is orphaned by spritzer's `426` on `list_sessions` ([spritzer#18](https://github.com/INTENTIUS/spritzer/issues/18)), and the fresh path is failed `:command_exited` because the emulator's runtime exits before writing a prompt, which v0.6.0 stopped counting as completion (fountain#606 — correct behavior meeting an emulator that echoes and exits). On pins ≤ v0.5.x the fresh path completed with exit 0, and even that was only the echo, never a model ([#67](https://github.com/INTENTIUS/fountain-ops/issues/67) has the race history). A turn that truly completes now requires a real data plane ([#91](https://github.com/INTENTIUS/fountain-ops/issues/91)) |

## Builds, unexercised

| | |
|---|---|
| `monitoring=prometheus-operator` | Builds only. Emitted nothing at all until the `tier.metrics` fix |
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
server. The `target=kubernetes` rows have their own loop: `just e2e-k8s`
stands up a separate three-node stand-in, treats it as foreign, and re-checks
light and ha through a real Ingress — on every merge to main, on demand from
the Actions tab, and on any laptop. The rows neither loop covers are the ones
needing operators or a cluster this repo did not create, and those rows say
so.

The conversation gate is the one row with two legitimate outcomes, so `just
e2e` asserts that the outcome matches the path taken rather than asserting a
result. A reattach that stops orphaning turns fails the build, which is how
this page finds out it has gone stale in the other direction.
