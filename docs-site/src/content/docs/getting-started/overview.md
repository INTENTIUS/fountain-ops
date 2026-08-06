---
title: What you are deploying
description: The pieces of a fountain deployment, the four shapes it comes in, and the four words the rest of the docs lean on.
---

[fountain](https://github.com/BinaryBourbon/fountain) is a server: you run it,
people register accounts on it, and it runs agent conversations in sandboxes.
This repo deploys it to Kubernetes and proves the deployment works. You drive
everything with `just` commands.

## The pieces

Every deployment is the same few parts, whatever shape it takes:

| part | what it is |
|---|---|
| the app | the fountain server itself — accounts, conversations, the web UI |
| a Postgres | where everything is stored. Bundled locally; yours, or operator-run, elsewhere |
| a platform Secret | the master key, the database URL, the data-plane token. One Kubernetes Secret |
| the data plane | where sandboxes run. An in-cluster emulator locally; the real Sprites API with a real token |
| a backup job | a nightly `pg_dump` to an S3 bucket — emulated locally, yours elsewhere |

## The four shapes

Two questions pick the shape. **Where does it run** (`target`): a k3d cluster
this repo creates on your machine, or a `kubernetes` cluster you already have.
**How durable is it** (`tier`): `light` is one replica and a single-instance
database; `ha` is two clustered app replicas over a replicated database.

| | how you get it |
|---|---|
| laptop, `light` | `just up` — [Stand it up locally](/fountain-ops/getting-started/stand-it-up/) |
| laptop, `ha` | `just operators`, then one `just up` with four parameters — [Make it durable](/fountain-ops/getting-started/make-it-durable/) |
| real cluster, `light` | build, dry-run, apply — [Stand it up on a real cluster](/fountain-ops/getting-started/real-cluster/) |
| real cluster, `ha` | the same page; `ha` is the default it previews |

Not every corner cuts every way: the laptop defaults are emulators, and `ha`
refuses to stand on an emulator. When a combination is refused, the error
names the parameter that fixes it — [Make it
durable](/fountain-ops/getting-started/make-it-durable/) walks through the
three you hit.

## Four words the docs lean on

**Target** — where the substrate runs: `k3d` or `kubernetes`.

**Tier** — how durable it is: `light` or `ha`. Orthogonal to `size`
(`small` · `medium` · `large`), which is how much of the machine one pod asks
for — a bigger pod is not a more durable one.

**Seam** — a dependency with a mode. `postgres` can be `bundled`, `cnpg` or
`reference`; `ingress` can be `omit`, `ingress` or `traefik`; there are eight.
The target picks defaults that make sense on that substrate, and setting one
replaces exactly that seam. The full list is in
[Seams](/fountain-ops/reference/seams/).

**Parameter** — how you say any of the above:
`just params="--param tier=ha" up`. Every input is a declared parameter with a
default; [Build parameters](/fountain-ops/reference/parameters/) is the whole
table.

## The part you can ignore

The manifests are compiled from TypeScript by
[chant](https://intentius.io/chant). That is why the same parameters always
produce the same resources, and why incoherent combinations are refused at
build time rather than discovered in the cluster — but you never invoke it
directly, and no page in the getting-started section needs you to know more
than this paragraph.

## What is true

[Status](/fountain-ops/status/) records what has actually been stood up and
exercised, what only builds, and what does not work yet. It is authoritative:
where any other page disagrees with it, including this one, status is right.
