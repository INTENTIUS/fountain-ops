---
title: Targets and tiers
description: Two separate questions — and why they are not a free grid.
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

## There used to be three

`standard` sat between them and emitted a deployment identical to `light` — same
kinds, same replica count, the same absence of clustering. The only differences
were resource requests and backup retention.

A bigger single pod is not a more durable one. It survives exactly the same set
of failures, which is none of them, so the middle rung held nothing — and
someone picking it believed they had bought something between `light` and `ha`.
They had bought RAM.

Sizing is now its own parameter, which is what it always was:

```bash
just params="--param size=medium" up                          # what `standard` asked for
just params="--param tier=light --param size=large" up
```

`size` defaults to what each tier already carried, so nothing shrank. A test
asserts every tier differs from every other in *shape* rather than only in
size — if that fails again, the ladder has grown an empty rung.

## The PodDisruptionBudget

`ha` emits one; `light` does not, and that is deliberate rather than an
omission. chant's own post-synth check had been reporting the absence at `ha`
for as long as the tier existed:

```
Deployment "fountain" has 2 replicas but no PodDisruptionBudget
```

Without one, a node drain can take both replicas at once — `maxUnavailable: 0`
constrains a *rollout*, and an eviction is not a rollout.

At one replica a PDB is not a smaller safeguard but a worse thing:
`minAvailable: 1` over a single pod means no voluntary eviction can ever
succeed, so `kubectl drain` hangs and the fix is deleting the object that was
supposed to protect you. A single-replica deployment has no availability to
budget.

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

:::note[This claim is a test]
The README once said "any tier runs on any target", which was tested and found
false. It then said "add `postgres=cnpg` and it builds", which was true until the
data plane seam landed and quietly made it false. Both are now asserted in
`test/tiers-and-seams.test.ts`, so the next one to rot fails a build rather than
misleading a reader.
:::

## The replica count is not a free knob

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

Applying it turned up two things that had never run, both of which applied
cleanly and did nothing useful.

### `DATABASE_SSL` was derived, not settable

`postgres=reference` set it to `true` unconditionally — "anything you did not
create serves TLS". That is true of a managed cloud database and false of the
perfectly ordinary case `reference` exists for: a Postgres somebody else
operates in your cluster. Against one, the app crashloops on boot:

```
[error] Postgrex.Protocol failed to connect: ** (Postgrex.Error) ssl not available
```

and no parameter could say otherwise. It is now `--param databaseSsl=false`,
still defaulting to `true` for anything but the bundled Postgres.

### An Ingress with no class is claimed by nobody

`ingressClassName` had no default, so the Ingress carried no class. A cluster
with a default `IngressClass` picks it up; a cluster with two controllers and no
default ignores it — and the second is normal. Tested against a cluster running
both Traefik (k3s ships it) and nginx: the Ingress applied without complaint and
404ed every request.

That is the same shape as the other refusals, so it is one now:

```
ingress="ingress" needs ingressClassName — an Ingress with no class is claimed by
no controller unless the cluster happens to have a default one, and applies
cleanly either way.
```

### The stream timeout was conditional on https

`proxy-read-timeout: 3600` only emitted when `scheme=https`. fountain streams a
conversation over SSE and holds the connection open for up to 60s between
events; nginx's own default read timeout is also 60s, so a plain-http ingress cut
long streams at exactly the boundary where they are most likely to be waiting.
The scheme has nothing to do with how long a stream lives, so it is unconditional
now.

`force-ssl-redirect` really is https-only — forcing a redirect to a scheme
nothing terminates is a loop.
