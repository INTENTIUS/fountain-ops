---
title: What this is
description: A deployment of fountain you drive from the repo — targets, tiers and seams, with no shell script doing the interesting parts.
---

Self-hosted [fountain](https://github.com/BinaryBourbon/fountain), deployed by
[chant](https://intentius.io/chant).

You drive it by its `just` targets. You do not need to know chant to use it.

## What you get

One `light` deployment on k3d: the fountain server, a single-instance Postgres,
a nightly backup job, and an emulated data plane. No ingress and no TLS — you
reach it with `just forward`.

The app boots, runs its migrations, and answers `/health/ready` with
`{"status":"ok","checks":{"database":"ok"}}`. You can register, verify, and sign
in. What you cannot yet do is hold a conversation that a model answers — see
[the data plane](/fountain-ops/reference/data-plane/) for exactly how far it gets
and where it stops.

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

## One environment variable, and it is a known wart

No resource file reads `process.env` — every input is a declared build
parameter, so the same parameters produce the same resources.

One exception, and it is worth knowing: `chant.config.ts` reads `FOUNTAIN_ENV`
directly for `ownership.env`, because ownership is read when the config loads and
build parameters do not exist yet at that point. So `--param env=prod` labels
resources `prod` while the ownership marker still says `dev` unless
`FOUNTAIN_ENV` is set to match.

Set both, or neither.
[INTENTIUS/chant#1396](https://github.com/INTENTIUS/chant/issues/1396).
