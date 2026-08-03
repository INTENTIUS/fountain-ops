# fountain-ops

Self-hosted [fountain](https://github.com/BinaryBourbon/fountain), deployed by [chant](https://intentius.io/chant).

You drive this by its `just` targets. You do not need to know chant to use it.

**Docs:** [Stand it up](https://intentius.io/fountain-ops/getting-started/stand-it-up/) ·
[First login](https://intentius.io/fountain-ops/getting-started/first-login/) ·
[Seams](https://intentius.io/fountain-ops/reference/seams/) ·
[Status](https://intentius.io/fountain-ops/status/)

## Getting started

About five minutes on a laptop, most of it pulling images.

**You need:** Docker running, plus `k3d`, `kubectl`, `node`, `npm`, `jq` and `just`. Check all but `just` — you have that already or you could not run it — with `just doctor`, which prints the install line for whatever is missing.

```bash
npm install
just up
```

That creates a k3d cluster, mints the platform secret, builds the manifests, applies them, waits for the rollouts, and proves the app serves:

```
GET /health via an in-cluster probe...
{"status":"ok"}
  ✓ /health answered
```

Then `just forward` and open `http://localhost:4000`. `just down` removes everything it created and nothing it did not.

### First login

A deploy that serves `/health` is not yet an instance you can use. Register at `/auth/register`, then:

```bash
just verify-email you@example.com
```

Skip it and nothing tells you: signing in *looks* like it worked, and then every page sends you back to the login form with no message. This deployment sends no mail, so the verification link never arrives and cannot. [Why, and what it does](https://intentius.io/fountain-ops/getting-started/first-login/).

### When it goes wrong

The steps of `just up` are separate targets, because when a deploy fails you want the step, not the whole thing again.

Build parameters go through a `params` variable — `just params="--param postgres=cnpg" up`.

```bash
just status       # everything in the namespace
just logs         # the app, following
just pg-logs      # the database
```

`just up` is safe to re-run. It will not create a second cluster, and it will not mint a second secret over the first.

## The shape of it

**Target** is where the substrate runs (`k3d` · `kubernetes`). **Tier** is how durable it is (`light` · `standard` · `ha`). Separate questions — and not a free grid: five of the six combinations build, and the sixth is refused with an error naming the seam that fixes it.

Each dependency is a **seam** with a mode: `postgres`, `secrets`, `ingress`, `tls`, `backups`, `monitoring`, `dataPlane`. Every mode is expressible. What is refused is incoherence — a "highly available" single Postgres, a WAL archive with nothing archiving into it, a certificate nothing terminates.

→ [Targets and tiers](https://intentius.io/fountain-ops/reference/targets-and-tiers/) · [Seams](https://intentius.io/fountain-ops/reference/seams/) · [The data plane](https://intentius.io/fountain-ops/reference/data-plane/)

## Status

**[The status page](https://intentius.io/fountain-ops/status/) is authoritative.** Anywhere something is described in the present tense, what is true is what that says. In short:

| | |
|---|---|
| **Verified** | `target=k3d tier=light` stands up and serves; bundled Postgres connects; you can register, verify and sign in; a sandbox is provisioned and populated; the backup job dumps and uploads to an emulated S3. With `just operators`: `postgres=cnpg` reconciles a real database the app migrates into, and `k3d tier=ha` stands up two clustered replicas over it |
| **Does not work** | Completing a turn ([spritzer#18](https://github.com/INTENTIUS/spritzer/issues/18)); admin ([#31](https://github.com/INTENTIUS/fountain-ops/issues/31)) |
| **Builds only** | `target=kubernetes`, `tier=standard`, and the seams whose controllers are still not installed — `ingress=traefik`, `secrets=infisical`, `monitoring=prometheus-operator` ([#22](https://github.com/INTENTIUS/fountain-ops/issues/22)) |

A backup nobody has restored is a hypothesis, so the backup row says what it says.

## Layout

```
chant.config.ts      lexicons, params, ownership, lint
justfile             every target you need
ci/pipeline.ts       this repo's own CI, declared
pages/pipeline.ts    the Pages workflow, declared the same way
workflows/shared.ts  the pins both workflows share
docs-site/           the published site — Astro + Starlight
src/
  params.ts          the one place build params are read
  lib/targets.ts     target -> seam defaults
  lib/tiers.ts       tier -> durability, and the replica refusal
  lib/seams.ts       seam modes, and the combinations that are refused
  app/               Deployment, Service, Namespace, headless Service
  data/              the bundled Postgres, the CNPG cluster, and spritzer
  ingress/           Ingress, Certificate, and the Traefik IngressRoutes
  secrets/           the InfisicalSecret
  backup/            the pg_dump CronJob
  observability/     ServiceMonitor, PrometheusRule
```

Both workflows are rendered from TypeScript and `just ci-check` fails if either committed YAML has drifted. The site is `just site`; `just site-dev` serves it locally.

No resource file reads `process.env` — every input is a declared build parameter. One exception, and it is worth knowing: `chant.config.ts` reads `FOUNTAIN_ENV` for `ownership.env`, because ownership is read before build parameters exist. Set both, or neither. [INTENTIUS/chant#1396](https://github.com/INTENTIUS/chant/issues/1396).

## Licence

[Apache 2.0](./LICENSE).
