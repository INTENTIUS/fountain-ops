---
title: Stand it up
description: Five minutes on a laptop, most of it pulling images.
---

Everything here has been run end to end on a laptop.

## What you need

Docker running, plus `k3d`, `kubectl`, `node`, `npm`, `jq` and `just`. Check all
but `just` — you already have that, or you could not run this — with:

```bash
just doctor
```

A missing tool prints the install line for your platform rather than the word
`missing` and nothing else.

## Up

```bash
npm install
just up
```

That creates a k3d cluster, mints the platform secret, builds the manifests,
applies them, waits for the rollouts, and proves the app serves. The last line
tells you it worked:

```
GET /health via an in-cluster probe...
{"status":"ok"}
  ✓ /health answered
```

Then reach it:

```bash
just forward      # http://localhost:4000
```

Registering and signing in needs one more step —
[First login](/fountain-ops/getting-started/first-login/).

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
not mint a second secret over the first — which matters more than it looks, and
is covered in [Secrets](/fountain-ops/reference/secrets/).

:::caution[A honeycomb 401 every five seconds]
`just logs` on a default deployment is dominated by
`!missing 'x-honeycomb-team' header`, twelve lines a minute, saying `error` and
`401`. That is fountain's OTLP exporter reaching for a collector you have not
configured. It is noise, not your problem, and it is
[#35](https://github.com/INTENTIUS/fountain-ops/issues/35).
:::
