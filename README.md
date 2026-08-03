# fountain-ops

Self-hosted [fountain](https://github.com/BinaryBourbon/fountain), deployed by [chant](https://intentius.io/chant).

You drive this by its `just` targets. You do not need to know chant to use it.

## Getting started

Everything below has been run end to end on a laptop. It takes about five minutes, most of it pulling images.

**You need:** Docker running, plus `k3d`, `kubectl`, `node`, `npm` and `just`. Check all but `just` with:

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

### First login

A deploy that serves `/health` is not yet an instance you can use. Register at `http://localhost:4000/auth/register`, then:

```bash
just verify-email you@example.com
```

This deployment sends no mail — `emailDelivery` defaults to `none`, because without Resend's DNS records mail is silently discarded, so the verification link never arrives and cannot. `just verify-email` is upstream's own escape hatch for exactly that case.

Skip it and nothing says so. Signing in looks like it worked, and then every page inside the app sends you back to the login form, with no message:

| | registered only | after `just verify-email` |
|---|---|---|
| `POST /auth/login` | 302 to onboarding | 302 to onboarding |
| `/onboarding/step_1` | 302 back to login | 200 |
| `/conversations` | 302 back to login | 200 |

Making an account an **admin** needs `Fountain.Release.promote_admin/1`, which is on upstream's `main` and not in the pinned `v0.3.0`. Nothing here exposes it yet ([#31](https://github.com/INTENTIUS/fountain-ops/issues/31)).

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

You can register, verify with `just verify-email`, and sign in. Conversations will not run without a real `SPRITES_TOKEN` — `just secret` writes a placeholder so the app boots.

## The two axes

**Target** — where the substrate runs. **Tier** — how durable it is. Separate questions, so a tier does not imply a target or the reverse.

They are not a free grid, though: `target=k3d tier=ha` is refused, because k3d defaults to the bundled Postgres and one Postgres cannot back an HA deployment. Add `postgres=cnpg` and it builds. The error says so.

```bash
just preview kubernetes standard    # see it without applying anything
```

A tier scales the deployment; it never changes what fountain can do. `light` is not a cut-down fountain, it is a smaller one.

The one thing that is not a free knob is the replica count. Above one replica fountain's pods must form an Erlang cluster, or conversation streaming breaks for whichever pod did not spawn the conversation — quietly, under load, for some users. So `tier=ha` carries that wiring, and asking for two replicas at `light` is a build error rather than a broken deployment.

## Seams

Each dependency has a mode. The target picks defaults that are coherent on that substrate; setting one explicitly replaces exactly that seam.

| Seam | Modes |
|---|---|
| `postgres` | `bundled` · `reference` · `cnpg` |
| `secrets` | `reference` · `infisical` |
| `ingress` | `omit` · `ingress` · `traefik` |
| `tls` | `omit` · `cert-manager` |
| `backups` | `omit` · `pg-dump` · `barman-pitr` |
| `monitoring` | `omit` · `prometheus-operator` |
| `dataPlane` | `sprites` · `spritzer` |

Every mode is expressible. What is still refused is incoherence — a "highly available" single Postgres, a WAL archive with nothing archiving into it, a certificate nothing terminates, an in-memory emulator behind the word "ha".

The operator modes need their operator already installed. chant declares custom resources; it does not install controllers.

## The data plane, and what a local conversation proves

fountain reaches the sandboxes its agents run in through one credential and one base URL. `dataPlane=spritzer` points that URL at an emulator running in the cluster, so the seam is configuration and nothing else — the app is not built differently and cannot tell. That is what makes a local run exercise the real control-plane path instead of a stub of it.

It works further than you might expect. Creating a conversation provisions a sprite, writes the `fountain` skill and a `/home/sprite/.env` into its filesystem, runs a turn, and streams `provision` → `turn` → `output` → done with `exit_code: 0`.

**And the output is an echo.** spritzer answers exec with a small scripted interpreter — `echo`, `cat`, `rm`, and an echo-back default — so the turn returns the runtime's own command line rather than anything a model said:

```
claude --dangerously-skip-permissions --print --verbose --output-format stream-json --session-id ...
```

Three things are absent and no configuration brings them back: **live model reasoning**, **real tool execution** in the sandbox, and **true VM isolation**. So a green local conversation is a plumbing check — it says fountain can provision a sandbox, address it, and stream from it. It says nothing about how an agent behaves, and it is not somewhere to judge sandbox security. Single-node Postgres is likewise not somewhere to benchmark durability.

The consequence worth stating: a deploy gate that only asserts "a conversation streamed" passes against spritzer while proving nothing about the model ([#4](https://github.com/INTENTIUS/fountain-ops/issues/4)).

For real conversations set `dataPlane=sprites` and put a real `SPRITES_TOKEN` in the Secret. That token is a **platform** credential, never a tenant one — it must not reach tenant-visible config, agent Environments or Vaults, or logs.

## Status

**This section is authoritative.** Anywhere else that something is described in the present tense, what is true is what this says.

| | State |
|---|---|
| `target=k3d`, `tier=light` | **Verified** — stood up, serves `/health/ready`, migrations ran |
| Bundled Postgres | **Verified** — 23 tables, app connects |
| Registering and signing in | **Verified** — registered at `/auth/register`, `just verify-email`, reached `/onboarding/step_1` and `/conversations` |
| Holding a conversation | **Streams, against an emulated data plane.** A sprite is provisioned and populated, a turn runs, output streams, the turn exits 0. The output is spritzer's echo, not a model — see below |
| Admin | **Not possible.** `promote_admin/1` is not in the pinned `v0.3.0` — [#31](https://github.com/INTENTIUS/fountain-ops/issues/31) |
| `pg-dump` backup job | **Emitted, never run.** The CronJob applies; no backup has been taken or restored |
| `target=kubernetes` | **Builds only.** Never applied to a real cluster |
| `tier=standard`, `tier=ha` | **Builds only.** The clustering wiring is emitted and unexercised |
| `tls=cert-manager` | **Builds only** |
| `monitoring=prometheus-operator` | **Builds only.** Emitted nothing at all until the `tier.metrics` fix |
| `postgres=cnpg`, `backups=barman-pitr`, `ingress=traefik`, `secrets=infisical` | **Builds, and a real API server accepts the output** (`just crds` then `just dry-run`). No controller has reconciled any of it |
| `ops/` | **Empty.** No Ops exist yet |

A backup nobody has restored is a hypothesis, so the backup row says what it says.

## CI

Declared, not hand-written — `ci/pipeline.ts` renders `.github/workflows/ci.yml`.

```bash
just ci          # render it
just ci-check    # fail if the committed YAML has drifted from the source
```

`ci-check` runs in CI too. GitHub reads YAML from the default branch, so the rendered file has to be committed, which makes hand-editing it possible — and a hand edit would win silently while the declaration still looked authoritative.

Two jobs. **check** is the same `just check` you run locally. **e2e** stands the whole thing up on k3d, proves `/health/ready` reaches the database, re-runs `just up` to confirm the secret is not rotated, and dry-runs every seam against a real API server.

Actions are pinned by commit SHA, tools by release version. A tag is a moving pointer.

## Secrets

`just secret` generates the platform secret and never rotates an existing one. That matters more than it looks: `MASTER_SECRETS_KEY` regenerated over an existing database makes every stored secret unrecoverable, and it looks exactly like a successful deploy.

No secret value is in this repo, and none ever will be. The interim generation in `just secret` is standing in for a real chant capability — [INTENTIUS/chant#1365](https://github.com/INTENTIUS/chant/issues/1365).

## Layout

```
chant.config.ts    lexicons, params, ownership, lint
justfile           every target you need
ci/pipeline.ts     this repo's own CI, declared
src/
  params.ts        the one place build params are read
  lib/targets.ts   target -> seam defaults
  lib/tiers.ts     tier -> durability, and the replica refusal
  lib/seams.ts     seam modes, and the combinations that are refused
  app/             Deployment, Service, Namespace, headless Service
  data/            the bundled Postgres, and the CNPG cluster
  ingress/         Ingress, Certificate, and the Traefik IngressRoutes
  secrets/         the InfisicalSecret
  backup/          the pg_dump CronJob
  observability/   ServiceMonitor, PrometheusRule
```

No resource file reads `process.env` — every input is a declared build parameter, so the same parameters produce the same resources.

One exception, and it is worth knowing: `chant.config.ts` reads `FOUNTAIN_ENV` directly for `ownership.env`, because ownership is config-level and build parameters are not available there. So `--param env=prod` labels resources `prod` while the ownership marker still says `dev` unless `FOUNTAIN_ENV` is set to match. Set both, or neither. [INTENTIUS/chant#1396](https://github.com/INTENTIUS/chant/issues/1396).
