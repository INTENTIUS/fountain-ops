---
title: Operating from behold
description: behold overlays what is running on the declared graph, and only the local environment is bound to a cluster.
---

[behold](https://github.com/INTENTIUS/behold) renders a chant project's graph
and overlays what is live. This repo binds the `local` environment to its k3d
cluster, so behold can read the deployed estate rather than only the source
graph:

From the behold repo, with this project already up (`just up`):

```bash
kubectl config use-context k3d-fountain-local
FOUNTAIN_ENV=local npm run dev -- serve /path/to/fountain-ops --env local
```

Every declared resource comes back observed, plus the running pods as runtime
nodes. On a clean `just up` that is eleven `good` and four `runtime`:

```
/api/overlay → nodes: 11  _status: {"good":11}
   good  Apps::Deployment  flociDeployment
   good  Core::Service     flociService
```

`serve` is the command, not `preview`. `preview` renders the declared source
graph; `serve` is the one that adds the live overlay, `/api/ops` and the
substrate strip.

:::caution[Both lines above are load-bearing]
**`FOUNTAIN_ENV=local`.** behold shells this project's own chant, and chant
reads `FOUNTAIN_ENV` for `ownership.env`. `just` exports it; behold is not run
through `just`, so nothing sets it for you. Without it the graph is built with
`env=dev` while the cluster holds `env=local` resources, and every node comes
back unmatched.

**The kubectl context.** `chant.config.ts` binds `local` to
`k3d-fountain-local`, and that binding is currently **not** honoured: the k8s
reader talks to whatever context is ambient. Any k3d cluster created by
anything else on the machine takes that context silently, and the estate then
paints entirely grey with `read-failed` as the only explanation. Reproduced on
chant 0.38 and 0.41 and filed as
[chant#1488](https://github.com/INTENTIUS/chant/issues/1488). Until it lands,
set the context yourself.

The `just` targets are unaffected: `_require-cluster` refuses to act on a
context it does not recognise. It is reads through chant that have no such
guard.
:::

**Only `local` is bound.** `dev` and everything else stay unbound on purpose,
so nothing here can point a read at a cluster this repo knows nothing about.
Bring your own profile:

```ts
k8s: { profiles: { staging: { context: "your-context" } } }
```

## Operating it from there

Two more things behold finds by convention, which turn the picture into a
control plane:

| | |
|---|---|
| `ops/fountain-apply.op.ts` | an `ApplyOp`, so **Run** streams Build → Plan (a live diff) → Apply |
| `scripts/local/local-up.sh` | so the k3d substrate pill offers **Bring up** from cold |

Both are thin. The scripts delegate to `just cluster-up` and `just down`
rather than being a second way to create a cluster, and the Op is bound to
`local` with `delete: "owned-only"`: prune is scoped to the ownership marker,
so it removes what this project stopped declaring and never touches anything
it did not put there.

`fountain-apply` is not gated. A gated apply needs Temporal for the durable
approval wait, and gating belongs on the Ops that can destroy something
([#3](https://github.com/INTENTIUS/fountain-ops/issues/3),
[#8](https://github.com/INTENTIUS/fountain-ops/issues/8)) rather than on one
that applies a Deployment to a laptop.
