---
title: Make it durable
description: tier=ha on the laptop cluster — two clustered app replicas over a replicated Postgres, before you need it anywhere real.
---

`light` is one app replica and a single-instance database. `ha` is two app
replicas that join into one Erlang cluster — so a conversation streaming from
either pod survives — over a Postgres the CNPG operator runs replicated at
2/2. This page stands that up on the same laptop cluster as
[Stand it up locally](/fountain-ops/getting-started/stand-it-up/), so the
first time you run the durable shape is not on a cluster that matters.

## Install the operators, once

The replicated database is run by an operator, and operators are the one
thing the build does not create:

```bash
just operators
```

That installs cert-manager, CNPG and the barman-cloud plugin into the
cluster, cluster-wide. On k3d this is free to undo — `just down` deletes the
whole cluster.

## Up

```bash
just params="--param tier=ha --param postgres=cnpg --param dataPlane=sprites --param storage=s3" up
```

One command, four parameters. `tier=ha` is the one you wanted; the other
three exist because the laptop defaults are emulators, and `ha` refuses to
stand on an emulator. Leave one off and the build stops and tells you, one at
a time:

- `postgres=bundled` is a single instance and cannot back an `ha` deployment
  → `postgres=cnpg`
- `dataPlane=spritzer` is an in-memory emulator in a single pod →
  `dataPlane=sprites`
- `storage=floci` is an emulator whose buckets do not survive a restart, and
  cannot hold the backups of an `ha` deployment → `storage=s3`

The errors are the documentation here: you can start from
`just params="--param tier=ha" up` and let each refusal hand you the next
parameter.

First boot takes a little longer than `light`: the app pods start while CNPG
is still bringing up the primary, restart once or twice against a database
that is not there yet, and settle as soon as it is.

## What you get

```bash
kubectl get pods -n fountain
```

```
NAME                        READY   STATUS    RESTARTS   AGE
fountain-6996f4fc85-8pzrl   1/1     Running   2          81s
fountain-6996f4fc85-v7c6v   1/1     Running   3          81s
fountain-pg-1               1/1     Running   0          65s
fountain-pg-2               1/1     Running   0          27s
```

Two app replicas, and a two-instance Postgres named `fountain-pg`. The
replicas find each other through a headless Service and form one Erlang
cluster — the proof is in the logs:

```bash
kubectl logs deploy/fountain -n fountain | grep "connected to"
# [libcluster:fountain] connected to :"fountain_server@10.42.0.14"
```

Only the replica that initiated the connection logs it, so an empty grep on
one pod means try the other, not that the cluster failed to form.

A PodDisruptionBudget (`kubectl get pdb -n fountain`) keeps at least one
replica up through node drains. Reaching it, registering and the first admin
are unchanged from [the light
walkthrough](/fountain-ops/getting-started/stand-it-up/#first-login):
`just forward`, then `http://localhost:4000`.

## What is still not real

Two of the four parameters name things this laptop does not have, and the
stand-up works anyway because the placeholders are only exercised later:

- `dataPlane=sprites` points at the real Sprites API, but the token in the
  platform Secret is still `local-dev-not-a-real-token`. The app boots and
  serves; starting a conversation is what needs the real
  [`SPRITES_TOKEN`](/fountain-ops/reference/data-plane/).
- `storage=s3` means backups upload to a real bucket with the AWS credentials
  in the Secret — which are also placeholders, so the nightly backup job will
  dump and then fail to upload until you put real ones there.
  [Backups and restore](/fountain-ops/reference/backups/) covers both halves.

That is the honest shape of `ha` on a laptop: the durability is real, the
outside services are not yet. Putting real values in the Secret is the same
step it would be on a real cluster —
[Secrets](/fountain-ops/reference/secrets/).

## Down

```bash
just down
```

Deletes the cluster, operators and all.
