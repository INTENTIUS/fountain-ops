---
title: Operating from behold
description: behold overlays what is running on the declared graph, and only the local environment is bound to a cluster.
---

[behold](https://github.com/INTENTIUS/behold) renders a chant project's graph
and overlays what is live. This repo binds the `local` environment to its k3d
cluster, so behold can read the deployed estate rather than only the source
graph:

```bash
npm run dev -- preview /path/to/fountain-ops --env local   # from the behold repo
```

Every declared resource comes back observed, plus the running pods as runtime
nodes.

**Only `local` is bound.** chant's k8s reader resolves `--env <name>` to the
context named in `chant.config.ts`; with no binding it reads whatever context
happens to be ambient, which is how pointing behold at this repo once had it
attempt to observe against a live EKS cluster in another account. A declared
binding is checked on every read and refuses on mismatch. That is right for a
laptop and wrong for a cluster this repo knows nothing about, which is why
`dev` and everything else stay unbound. Bring your own profile:

```ts
k8s: { profiles: { staging: { context: "your-context" } } }
```

`just` exports `FOUNTAIN_ENV=local`, so a local deploy is owned, labelled and
bound under one name. Without it the ownership marker says `dev` while behold
reads `--env local` and matches nothing.

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
