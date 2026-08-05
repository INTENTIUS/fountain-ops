---
title: Stand it up
description: Five minutes on a laptop, most of it pulling images.
---

## What you need

Docker running, plus `k3d`, `kubectl`, `node`, `npm`, `jq` and `just`. Once
`just` is installed, it can check the rest for you:

```bash
just doctor
```

For each missing tool it prints the install line for your platform, not just
the word `missing`.

## Up

```bash
npm install
just up
```

The first run takes about five minutes, most of it pulling images. It creates
a k3d cluster, mints the platform secret, builds the manifests, applies them,
waits for the rollouts, and proves the app serves. The last line tells you it
worked:

```
GET /health via an in-cluster probe...
{"status":"ok"}
  ✓ /health answered
```

Then reach it:

```bash
just forward      # http://localhost:4000
```

`forward` holds the port open until you ctrl-c it, so the next step wants a
second terminal. Registering and signing in needs one more step:
[First login](/fountain-ops/getting-started/first-login/).

`up` takes build parameters through a `params` variable, as in
`just params="--param postgres=cnpg" up`. What they are, and why a variable
rather than an argument, is in
[Parameters](/fountain-ops/reference/parameters/).

## Down

```bash
just down
```

Removes everything it created and nothing it did not.

## When it goes wrong

The steps of `just up` are separate targets, because when a deploy fails you
want the step, not the whole thing again.

```bash
just status       # everything in the namespace
just logs         # the app, following
just pg-logs      # the database
```

`just up` is safe to re-run. It will not create a second cluster, and it will
not mint a second secret over the first. Why the second half matters is
covered in [Secrets](/fountain-ops/reference/secrets/).

:::note[Tracing is off unless you ask for it]
fountain's runtime config hardcodes an OTLP exporter aimed at `api.honeycomb.io`,
so an instance that has never heard of Honeycomb retries a 401 against it every
five seconds, forever. That is twelve lines a minute in `just logs`, saying
`error` and `401`, on top of whatever you came to read.

`OTEL_TRACES_EXPORTER` is set to `none` by default, which stops it. Exporting
traces somewhere real is the `otelTraces` parameter, in
[Parameters](/fountain-ops/reference/parameters/).
:::
