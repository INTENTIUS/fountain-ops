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
| Bundled Postgres | 49 tables at `fountain v0.21.0`, app connects |
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
| Completing a turn, against the emulated data plane | **The handshake, not the turn.** fountain speaks the [Agent Client Protocol](https://agentclientprotocol.com/) to its runtimes from `v0.9.0` ([fountain#671](https://github.com/BinaryBourbon/fountain/pull/671); [#674](https://github.com/BinaryBourbon/fountain/pull/674) deleted the legacy spawn path, and an agent comes back `acp: true` whatever you post to `/api/agents`). A turn opens `claude-agent-acp` and sends `initialize`. spritzer `0.5.0` echoes command lines and speaks no JSON-RPC, so it answers `-32601 initialize is not supported` and the turn stage ends `failed` — deterministically, not as a race. Everything before it holds and is still asserted on every run: the sandbox is provisioned, the turn is dispatched into it, and the runtime's output streams back. Nothing in this repo closes this. spritzer has to answer `initialize`, and its newest release is the `0.5.0` this deployment already pins |

The evidence that used to sit in **Verified** stands where it was measured and
does not carry: 34 of 34 conversations completed at `fountain v0.6.1` +
`spritzer 0.5.0`, over a spawn path that no longer exists. Moving the image pin
to `v0.16.0` is what surfaced this — nine releases of upstream at once, one of
which changed the protocol. The pin is now `v0.21.0`, and `just e2e` stops at
the same handshake there.
[#67](https://github.com/INTENTIUS/fountain-ops/issues/67) holds the history of
getting this row wrong, and it is now four times.

## Builds, unexercised

| | |
|---|---|
| `monitoring=prometheus-operator` | Builds only. Emitted nothing at all until the `tier.metrics` fix |
| `tls=cert-manager` (issuance) | cert-manager installs and is Available, but no certificate has been issued, because a local cluster has no domain to issue against |
| `ingress=traefik`, `secrets=infisical`, `monitoring=prometheus-operator` | Build, and a real API server accepts the output. No controller has reconciled any of them: Traefik ships with k3s but nothing routes through it here, Infisical needs a server to talk to, and kube-prometheus-stack is not installed ([#22](https://github.com/INTENTIUS/fountain-ops/issues/22)) |
| `dataPlane=wisp` | Wired, and exercised against a spritzer standing in for a wisp host: `SPRITES_BASE_URL` and the token Secret reach the app, a sandbox is provisioned through the endpoint, and the gate holds the turn to exit 0. Never run against a real wisp host ([#121](https://github.com/INTENTIUS/fountain-ops/issues/121)) |
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

The conversation gate is worth a note, because this page has got it wrong
every time it has tried to say something about the ending. It asserted a
result, then a pairing, then gave up and only *observed*, then asserted the
turn completes once spritzer `0.5.0` closed the race — and then the pin moved
nine releases and fountain stopped using the path all of that was measured on.

So the gate asserts what this deployment owns and nothing further: a sandbox is
provisioned, a turn is dispatched into it, output streams back. Past that it
recognises exactly one ending on the emulated plane — the ACP `initialize`
refusal above — and fails on anything else, including the two old regressions
(an orphaned turn, a `:command_exited`), each of which still names the pin that
must have moved. A real data plane is held to exiting 0, and so is the emulator
the day it learns to answer.
