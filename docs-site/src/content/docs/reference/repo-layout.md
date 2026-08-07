---
title: The repo
description: Where everything lives, and the one environment variable.
---

For reading or changing the source, not for deploying — nothing in
getting-started needs this page.

## The layout

```
chant.config.ts    lexicons, params, ownership, lint
justfile           every target you need
cluster/           the k3d clusters, declared — local, and the e2e-k8s stand-in
ci/pipeline.ts     this repo's own CI, declared
pages/pipeline.ts  the Pages workflow, declared the same way
workflows/shared.ts  pins both workflows share
ops/               the deploy Op, for behold's Run button
scripts/local/     cluster lifecycle, where behold looks for it
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

## One environment variable

No resource file reads `process.env`. Every input is a declared build
parameter, so the same parameters produce the same resources.

The exception is `chant.config.ts`, which reads `FOUNTAIN_ENV` directly for
`ownership.env`, because ownership is read when the config loads and build
parameters do not exist yet at that point. So `--param env=prod` labels
resources `prod` while the ownership marker still says `dev`, unless
`FOUNTAIN_ENV` is set to match. Set both or neither.
[INTENTIUS/chant#1396](https://github.com/INTENTIUS/chant/issues/1396) tracks
it.
