---
title: Targets and tiers
description: Two separate questions — and why they are not a free grid.
---

**Target** is where the substrate runs. **Tier** is how durable it is. Separate
questions, so a tier does not imply a target or the reverse.

| | |
|---|---|
| `target` | `k3d` · `kubernetes` |
| `tier` | `light` · `standard` · `ha` |

A tier scales the deployment; it never changes what fountain can do. `light` is
not a cut-down fountain, it is a smaller one.

## Separate is not a free grid

Five of the six combinations build. `k3d` + `ha` is refused, because two of
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
