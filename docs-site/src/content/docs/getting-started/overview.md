---
title: What this is
description: A deployment of fountain you drive from the repo. Targets, tiers and seams, with no shell script doing the interesting parts.
---

Self-hosted [fountain](https://github.com/BinaryBourbon/fountain), deployed by
[chant](https://intentius.io/chant).

You drive it by its `just` targets. You do not need to know chant to use it.

## Targets, tiers, seams

Three words carry the whole repo.

A **target** is where the substrate runs: `k3d` for [the local
loop](/fountain-ops/getting-started/stand-it-up/), `kubernetes` for [a cluster
k3d did not create](/fountain-ops/getting-started/real-cluster/). A **tier** is
how durable the deployment is: `light` is a smaller fountain, `ha` a more
survivable one, and neither changes what the app can do. Separate questions —
a tier does not imply a target.

A **seam** is a dependency with a mode: who provides Postgres, who terminates
TLS, where backups go. There are eight. The target picks defaults that are
coherent on that substrate; setting one explicitly replaces exactly that seam
and leaves the rest alone.

Combinations that would apply cleanly to a cluster and then mean something
other than they say — a "highly available" single Postgres, a certificate
nothing terminates — are refused at build time, with an error naming the seam
that fixes it. [Targets and
tiers](/fountain-ops/reference/targets-and-tiers/) and
[Seams](/fountain-ops/reference/seams/) are the full story.

## What you get

The default build is one `light` deployment on `k3d`: the fountain server, a
single-instance Postgres, a nightly backup job, and an emulated data plane.
There is no ingress and no TLS; you reach it with `just forward`.

The app boots, runs its migrations, and answers `/health/ready` with
`{"status":"ok","checks":{"database":"ok"}}`. You can register, verify, and sign
in. You cannot yet hold a conversation that a model answers. See
[the data plane](/fountain-ops/reference/data-plane/) for how far a conversation
gets and where it stops.

## The layout

```
chant.config.ts    lexicons, params, ownership, lint
justfile           every target you need
ci/pipeline.ts     this repo's own CI, declared
pages/pipeline.ts  the Pages workflow, declared the same way
workflows/shared.ts  pins both workflows share
docs-site/         this site
src/
  params.ts        the one place build params are read
  lib/targets.ts   target -> seam defaults
  lib/tiers.ts     tier -> durability, and the replica refusal
  lib/seams.ts     seam modes, and the combinations that are refused
  app/             Deployment, Service, Namespace, headless Service
  data/            the bundled Postgres, the CNPG cluster, and spritzer
  ingress/         Ingress, Certificate, and the Traefik IngressRoutes
  secrets/         the InfisicalSecret
  backup/          the pg_dump CronJob
  observability/   ServiceMonitor, PrometheusRule
```

## Every input is declared

No resource file reads `process.env`. Every input is a declared build
parameter, so the same parameters produce the same resources.

The one exception is `FOUNTAIN_ENV`, which has to agree with `--param env` or
the ownership marker drifts from the resource labels. Why it exists, the
exact drift, and the chant issue tracking it are in
[Parameters](/fountain-ops/reference/parameters/).
