# fountain-ops

Self-hosted [fountain](https://github.com/BinaryBourbon/fountain), deployed by [chant](https://intentius.io/chant).

You drive this by its `just` targets. You do not need to know chant to use it.

## Getting started

Everything below has been run end to end on a laptop. It takes about five minutes, most of it pulling images.

**You need:** Docker running, plus `k3d`, `kubectl`, `node` and `just`. Check with:

```bash
just doctor
```

**Stand it up:**

```bash
npm install
just up
```

That creates a k3d cluster, mints the platform secret, builds the manifests, applies them, waits for both rollouts, and proves the app serves. The last line tells you it worked:

```
GET /health via an in-cluster probe...
{"status":"ok"}
  ✓ /health answered
```

**Look at it:**

```bash
just forward      # http://localhost:4000
```

**Tear it down:**

```bash
just down
```

### If something goes wrong

The steps of `just up` are separate targets, because when a deploy fails you want the step, not the whole thing again.

```bash
just status       # everything in the namespace
just logs         # the app, following
just pg-logs      # the database
```

`just up` is safe to re-run. It will not create a second cluster, and it will not mint a second secret over the first.

## What you get

One `light` deployment on k3d: the fountain server, a single-instance Postgres, and a nightly backup job. No ingress and no TLS — you reach it with `just forward`.

Verified working: the app boots, runs its migrations, and answers `/health/ready` with `{"status":"ok","checks":{"database":"ok"}}`.

Conversations will not run without a real `SPRITES_TOKEN` — `just secret` writes a placeholder so the app boots. Everything else works.

## The two axes

**Target** — where the substrate runs. **Tier** — how durable it is. They are independent: any tier runs on any target.

```bash
just preview kubernetes standard    # see it without applying anything
```

A tier scales the deployment; it never changes what fountain can do. `light` is not a cut-down fountain, it is a smaller one.

The one thing that is not a free knob is the replica count. Above one replica fountain's pods must form an Erlang cluster, or conversation streaming breaks for whichever pod did not spawn the conversation — quietly, under load, for some users. So `tier=ha` carries that wiring, and asking for two replicas at `light` is a build error rather than a broken deployment.

## Seams

Each dependency has a mode. The target picks defaults that are coherent on that substrate; setting one explicitly replaces exactly that seam.

| Seam | Modes |
|---|---|
| `postgres` | `bundled` · `reference` · `cnpg`\* |
| `secrets` | `reference` · `infisical`\* |
| `ingress` | `omit` · `ingress` · `traefik`\* |
| `tls` | `omit` · `cert-manager` |
| `backups` | `omit` · `pg-dump` · `barman-pitr`\* |
| `monitoring` | `omit` · `prometheus-operator` |

\* needs a CRD chant does not generate yet. Asking for one is a build error naming the issue that lands it.

## Status

**This section is authoritative.** Anywhere else that something is described in the present tense, what is true is what this says.

| | State |
|---|---|
| `target=k3d`, `tier=light` | **Verified** — stood up, serves `/health/ready`, migrations ran |
| Bundled Postgres | **Verified** — 23 tables, app connects |
| `pg-dump` backup job | **Emitted, never run.** The CronJob applies; no backup has been taken or restored |
| `target=kubernetes` | **Builds only.** Never applied to a real cluster |
| `tier=standard`, `tier=ha` | **Builds only.** The clustering wiring is emitted and unexercised |
| `tls=cert-manager` | **Builds only** |
| `monitoring=prometheus-operator` | **Builds only.** Emitted nothing at all until the `tier.metrics` fix |
| `postgres=cnpg`, `ingress=traefik`, `secrets=infisical` | **Refused at build.** Blocked on chant CRD work |
| `ops/` | **Empty.** No Ops exist yet |

A backup nobody has restored is a hypothesis, so the backup row says what it says.

## Secrets

`just secret` generates the platform secret and never rotates an existing one. That matters more than it looks: `MASTER_SECRETS_KEY` regenerated over an existing database makes every stored secret unrecoverable, and it looks exactly like a successful deploy.

No secret value is in this repo, and none ever will be. The interim generation in `just secret` is standing in for a real chant capability — [INTENTIUS/chant#1365](https://github.com/INTENTIUS/chant/issues/1365).

## Layout

```
chant.config.ts    lexicons, params, ownership, lint
justfile           every target you need
src/
  params.ts        the one place build params are read
  lib/targets.ts   target -> seam defaults
  lib/tiers.ts     tier -> durability, and the replica refusal
  lib/seams.ts     seam validation and the CRD refusals
  app/             Deployment, Service, Namespace, headless Service
  data/            the bundled Postgres
  ingress/         Ingress, Certificate
  backup/          the pg_dump CronJob
  observability/   ServiceMonitor, PrometheusRule
```

Nothing reads `process.env`. Every input is a declared build parameter, so the same parameters produce the same manifests.
