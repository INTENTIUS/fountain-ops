# fountain-ops

Run your own [fountain](https://github.com/BinaryBourbon/fountain). One command stands it up on a laptop; the same build, with a handful of parameters, is how it goes everywhere else. You drive all of it with `just`.

**Docs:** [Stand it up](https://intentius.io/fountain-ops/getting-started/stand-it-up/) ·
[Make it durable](https://intentius.io/fountain-ops/getting-started/make-it-durable/) ·
[Real cluster](https://intentius.io/fountain-ops/getting-started/real-cluster/) ·
[Status](https://intentius.io/fountain-ops/status/)

## On a laptop

About five minutes, most of it pulling images.

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

Register at `/auth/register` — or `POST /api/auth/register`, if you are not driving a browser — and sign in. That is the whole step: with this deployment's defaults your account self-verifies at registration (no mail is sent here, so a verification link would never arrive), and the instance's first account is promoted to admin, audit-recorded like a grant made from the panel (fountain ADR 0011). Register before exposing the instance — until an admin exists, the role goes to whoever verifies first.

`just verify-email` and `just promote-admin` remain for older image pins (≤ v0.4.0, which ignore these switches), broken mail providers, second admins, and `firstUserAdmin=false`: [Promoting an admin manually](https://intentius.io/fountain-ops/reference/promote-admin/) has them, and what runs underneath. You do not need admin to use the instance.

## Durable

Two app replicas that join into one Erlang cluster, over a Postgres the CNPG operator runs replicated — still on the laptop, so the first `ha` you stand up is not on a cluster that matters:

```bash
just operators
just params="--param tier=ha --param postgres=cnpg --param dataPlane=sprites --param storage=s3" up
```

`tier=ha` is the decision; the other three parameters exist because the laptop defaults are emulators and `ha` refuses to stand on an emulator — leave one off and the error hands you the next. What comes up, what stays placeholder, and why: [Make it durable](https://intentius.io/fountain-ops/getting-started/make-it-durable/).

## On a real cluster

The same build, aimed at a cluster k3d did not create. You bring the database, the Secret, the ingress class and the hostname; each is one `--param`, and [Stand it up on a real cluster](https://intentius.io/fountain-ops/getting-started/real-cluster/) takes the decisions in order. `just preview kubernetes ha` shows the manifests without touching anything, and `just e2e-k8s` re-checks the whole path — light, then ha over it — on a three-node stand-in it creates and deletes itself.

## When it goes wrong

The steps of `just up` are separate targets, because when a deploy fails you want the step, not the whole thing again.

```bash
just status       # everything in the namespace
just logs         # the app, following
just pg-logs      # the database
```

`just up` is safe to re-run. It will not create a second cluster, and it will not mint a second secret over the first.

## Status

**[The status page](https://intentius.io/fountain-ops/status/) is authoritative.** Anywhere something is described in the present tense, what is true is what that says. In short:

| | |
|---|---|
| **Verified** | `target=k3d tier=light` stands up and serves; bundled Postgres connects; you can register, sign in and end up with the first admin; a sandbox is provisioned and populated; the backup job dumps and uploads to an emulated S3. With `just operators`: `postgres=cnpg` reconciles a real database the app migrates into, and `k3d tier=ha` stands up two clustered replicas over it. `just e2e-k8s` applies `target=kubernetes` — `light`, then `ha` over it — to a three-node stand-in and serves both through a real Ingress |
| **Does not work** | Completing a turn — sometimes, and it is a race that a faster machine loses more often ([#67](https://github.com/INTENTIUS/fountain-ops/issues/67), [spritzer#18](https://github.com/INTENTIUS/spritzer/issues/18)) |
| **Builds only** | The seams whose controllers are still not installed — `ingress=traefik`, `secrets=infisical`, `monitoring=prometheus-operator` ([#22](https://github.com/INTENTIUS/fountain-ops/issues/22)) — and everything on a **managed** cluster ([#23](https://github.com/INTENTIUS/fountain-ops/issues/23)) |

A backup nobody has restored is a hypothesis, so the backup row says what it says.

## The shape of it, in four words

**Target** is where it runs (`k3d` · `kubernetes`). **Tier** is how durable (`light` · `ha`). **Size** (`small` · `medium` · `large`) is how much machine one pod asks for — orthogonal, because a bigger pod is not a more durable one. Every dependency is a **seam** with a mode — `postgres`, `secrets`, `ingress`, `tls`, `backups`, `monitoring`, `dataPlane`, `storage` — and the target picks defaults that make sense where it runs. Combinations that would apply cleanly and mean something other than they say are refused with an error naming the parameter that fixes it.

→ [Targets and tiers](https://intentius.io/fountain-ops/reference/targets-and-tiers/) · [Seams](https://intentius.io/fountain-ops/reference/seams/) · [Build parameters](https://intentius.io/fountain-ops/reference/parameters/)

## Layout

The manifests are compiled from TypeScript by [chant](https://intentius.io/chant) — that is why the same parameters always produce the same resources, and why incoherent combinations are refused at build time. You never invoke it directly.

```
chant.config.ts      lexicons, params, ownership, lint
justfile             every target you need
ci/pipeline.ts       this repo's own CI, declared
pages/pipeline.ts    the Pages workflow, declared the same way
workflows/shared.ts  the pins both workflows share
ops/                 the deploy Op, for behold's Run button
scripts/local/       cluster lifecycle, where behold looks for it
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

`just check` is what CI's check job runs and `just e2e` is what its e2e job runs — both literally, so what you run locally is what gates the branch. `just e2e` stands up from nothing, asserts every claim above including the backup restore and the conversation gate, and tears down.

Both workflows are rendered from TypeScript and `just ci-check` fails if either committed YAML has drifted. The site is `just site`; `just site-dev` serves it locally.

No resource file reads `process.env` — every input is a declared build parameter. One exception, and it is worth knowing: `chant.config.ts` reads `FOUNTAIN_ENV` for `ownership.env`, because ownership is read before build parameters exist. Set both, or neither. [INTENTIUS/chant#1396](https://github.com/INTENTIUS/chant/issues/1396).

## Licence

[Apache 2.0](./LICENSE).
