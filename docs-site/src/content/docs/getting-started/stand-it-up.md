---
title: Stand it up locally
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
second terminal.

`up` takes build parameters through a `params` variable, as in
`just params="--param postgres=cnpg" up`. What they are, and why a variable
rather than an argument, is in
[Parameters](/fountain-ops/reference/parameters/).

## First login

Register at `http://localhost:4000/auth/register` and sign in. That is the
whole step: with this deployment's defaults your account self-verifies at
registration — `emailDelivery=none` means no mail is sent here, so a
verification link would never arrive and gates nothing — and the instance's
first account is promoted to admin in-app, audit-recorded like a grant made
from the panel (fountain ADR 0011, both halves).

Register **before** exposing the instance to a network you don't trust —
until an admin exists, the role goes to whoever verifies first. Registration
is open by default for the same reason; close it with
`registrationEnabled=false` once your account exists. You do not need admin
to use the instance.

Scripts and agents register through `POST /api/auth/register`, which does the
same thing; that curl, and the API key the conversation gate authenticates
with, are in [The data plane](/fountain-ops/reference/data-plane/#an-account-and-a-key-headless).
For a second admin, `firstUserAdmin=false`, an older image pin or a lock-out,
the manual path is
[Promoting an admin manually](/fountain-ops/reference/promote-admin/).

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

## What you just stood up

In the words the rest of the docs use: `target=k3d`, `tier=light` — a cluster
this repo created on your machine, one app replica, a single-instance
Postgres, an emulated data plane, a nightly backup to an emulated S3. Every
one of those choices is a parameter with the default you just used;
[What you are deploying](/fountain-ops/getting-started/overview/) names them
all.

Two directions from here:

- [Make it durable](/fountain-ops/getting-started/make-it-durable/) — two
  clustered replicas over a replicated Postgres, on this same laptop
- [Stand it up on a real cluster](/fountain-ops/getting-started/real-cluster/)
  — the same build, aimed at a cluster k3d did not create
