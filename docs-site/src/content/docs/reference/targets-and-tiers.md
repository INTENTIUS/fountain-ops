---
title: Targets and tiers
description: Two separate questions, and why they are not a free grid.
---

**Target** is where the substrate runs. **Tier** is how durable it is. Separate
questions, so a tier does not imply a target or the reverse.

| | |
|---|---|
| `target` | `k3d` · `kubernetes` |
| `tier` | `light` · `ha` |
| `size` | `small` · `medium` · `large` — resources only, orthogonal to both |

A tier scales the deployment; it never changes what fountain can do. `light` is
not a cut-down fountain, it is a smaller one.

## Size is not a tier

A bigger single pod is not a more durable one; it survives exactly the same
set of failures. So sizing is its own parameter rather than a rung between
`light` and `ha`:

```bash
just params="--param tier=light --param size=large" up
```

`size` defaults to `small` at `light` and `large` at `ha`. A test asserts
every tier differs from every other in *shape*, not only in size, so a tier
that buys nothing but RAM cannot appear.

## The PodDisruptionBudget

`ha` emits one; `light` deliberately does not. chant's own post-synth check
had been reporting the absence at `ha` for as long as the tier existed:

```
Deployment "fountain" has 2 replicas but no PodDisruptionBudget
```

Without one, a node drain can take both replicas at once: `maxUnavailable: 0`
constrains a *rollout*, and an eviction is not a rollout.

At one replica a PDB is actively harmful. `minAvailable: 1` over a single pod
means no voluntary eviction can ever succeed, so `kubectl drain` hangs and the
fix is deleting the object that was supposed to protect you. A single-replica
deployment has no availability to budget.

## Separate is not a free grid

Three of the four combinations build. `k3d` + `ha` is refused, because two of
k3d's defaults are single-pod stand-ins and neither can carry an HA deployment:
the bundled Postgres, and the emulated data plane.

```bash
just preview k3d ha    # refused, and the error names the seam
```

The refusals surface **one at a time**, so naming `postgres` alone gets you the
next error rather than a build:

```bash
npx chant build src --param target=k3d --param tier=ha \
  --param postgres=cnpg --param dataPlane=sprites
```

Which combinations build and which are refused is asserted in
`test/tiers-and-seams.test.ts`, so if a seam change shifts the answer, a build
fails rather than this page going quietly wrong.

## Replicas and clustering are one decision

Above one replica, fountain's pods must form a real Erlang cluster or they run
as isolated islands, and conversation streaming breaks for whichever pod did not
spawn the conversation. It fails quietly, under load, for some users.

So `replicas` and `clustered` are decided together: `tier=ha` carries that
wiring, and asking for two replicas at `light` is a build error rather than a
broken deployment.

```
tier "light" cannot run 2 replicas: above one replica the pods must form an
Erlang cluster, or conversation streaming breaks for whichever pod did not
spawn the conversation. Use tier "ha".
```

## `target=kubernetes`, and what it takes

The two targets differ on four of six seam defaults, so most of what `kubernetes`
does is not what `k3d` exercises:

| seam | `k3d` | `kubernetes` |
|---|---|---|
| `postgres` | `bundled` | `reference` |
| `ingress` | `omit` | `ingress` |
| `backups` | `pg-dump` | `omit` |
| `dataPlane` | `spritzer` | `sprites` |

Applying it turned up three things that had never actually run.

### `DATABASE_SSL` was derived, not settable

`postgres=reference` set it to `true` unconditionally: "anything you did not
create serves TLS". That is true of a managed cloud database and false of the
perfectly ordinary case `reference` exists for, a Postgres somebody else
operates in your cluster. Against one, the app crashloops on boot:

```
[error] Postgrex.Protocol failed to connect: ** (Postgrex.Error) ssl not available
```

and no parameter could say otherwise. It is now `--param databaseSsl=false`,
still defaulting to `true` for anything but the bundled Postgres.

### An Ingress with no class is claimed by nobody

`ingressClassName` had no default, so the Ingress carried no class. A cluster
with a default `IngressClass` picks it up; a cluster with two controllers and
no default ignores it, and the second case is normal. Tested against a cluster
running both Traefik (k3s ships it) and nginx: the Ingress applied without
complaint and 404ed every request.

That is the same shape as the other refusals, so it is one now:

```
ingress="ingress" needs ingressClassName — an Ingress with no class is claimed by
no controller unless the cluster happens to have a default one, and applies
cleanly either way.
```

### The stream timeout was conditional on https

`proxy-read-timeout: 3600` only emitted when `scheme=https`. fountain streams a
conversation over SSE and holds the connection open for up to 60s between
events; nginx's own default read timeout is also 60s, so a plain-http ingress
cut long streams at exactly the boundary where they are most likely to be
waiting. The scheme has nothing to do with how long a stream lives, so it is
unconditional now.

`force-ssl-redirect` really is https-only: forcing a redirect to a scheme
nothing terminates is a loop.


## What `target` will and will not ever mean

`target` answers **which cluster**, not **what kind of thing runs this**. Decided
in [#25](https://github.com/INTENTIUS/fountain-ops/issues/25).

A managed cluster (EKS, GKE, AKS) is `target=kubernetes` with different seam
defaults: a cloud LoadBalancer, cloud DNS, a managed Postgres behind
`postgres=reference`. Not a new value.

Anything without a Kubernetes API is **not** a third value either. Every
resource module here emits `K8s::*`, and a Task Definition is not a Deployment
with different field names: the unit of scheduling, the health check contract,
the service discovery mechanism and the secret injection path are all
different shapes. Adding an enum value would advertise a config change and
mean a rewrite.

chant is not the constraint; it ships `aws`, `fly`, `gcp` and `azure` lexicons.
This repo's emitters are.

### What does generalise

The seam model:

| seam | on a non-Kubernetes runtime |
|---|---|
| `postgres` | `reference` against RDS or Fly Postgres |
| `secrets` | Secrets Manager, SSM, Fly secrets |
| `ingress` | an ALB, or nothing at all where the platform routes |
| `tls` | ACM, or platform-provided |
| `backups` | the same `pg_dump`, on a different scheduler |
| `dataPlane` | **unchanged** |
| `storage` | **unchanged** |

The last two do not change because an HTTP API and an S3 bucket do not care
what schedules the caller. The axes were right; only the emitters are
Kubernetes-shaped.

If a second emitter tree ever lands ([#54](https://github.com/INTENTIUS/fountain-ops/issues/54),
[#55](https://github.com/INTENTIUS/fountain-ops/issues/55)), `target` is the
wrong name for what selects between them; the honest move is a new axis above
it rather than stretching this one. It is written down here so there is
something to hold that decision to.
