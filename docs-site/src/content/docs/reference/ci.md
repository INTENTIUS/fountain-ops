---
title: CI and the site
description: Both workflows are declared, and a gate fails if the committed YAML drifts.
---

This repo's rule is that its infrastructure is chant. A pipeline is
infrastructure, so both workflows are declared and rendered rather than
hand-written.

```bash
just ci          # render both workflows
just ci-check    # fail if either committed file has drifted from its source
```

| source | rendered |
|---|---|
| `ci/pipeline.ts` | `.github/workflows/ci.yml` |
| `pages/pipeline.ts` | `.github/workflows/pages.yml` |
| `workflows/shared.ts` | pins both share — checkout SHA, `just` version |

GitHub reads YAML from the default branch, so the rendered file has to be
committed. That makes hand-editing it possible, and a hand edit would win
**silently** while the declaration still looked authoritative. `ci-check` is the
gate that stops it, and it runs in CI as well as locally.

```
  ✓ .github/workflows/ci.yml matches ci/pipeline.ts
  ✓ .github/workflows/pages.yml matches pages/pipeline.ts
```

## Two jobs

**check** — the same `just check` chain you run locally: typecheck, lint, test,
build. Deliberately identical, so the thing people run before pushing keeps
predicting what CI does.

**e2e** — the same `just e2e`, for the same reason. One step, not eight.

```bash
just e2e
```

Stands up from nothing and asserts, in order:

| | |
|---|---|
| readiness | `/health/ready` answers `{"database":"ok"}` — the app reached Postgres, not just booted |
| the master key | re-running `just up` leaves `MASTER_SECRETS_KEY` byte-identical |
| a clean start | the app's `restartCount` is 0, so the Postgres wait has not regressed |
| the backup | taken, then restored into a throwaway and table-matched against live |
| the account path | register over the API, `verify-email`, headless throughout |
| the conversation gate | a sandbox is provisioned and a turn starts |
| every seam | `just crds` then `just dry-run`, validated by a real API server |

Then it tears down. On failure it leaves the cluster up so there is something
to look at; CI runs its own teardown regardless.

:::caution[The conversation gate's outcome depends on the CPU]
This was going to pin the documented failure and fail loudly if the gate ever
started passing. It cannot, because the two do not agree:

| | |
|---|---|
| **arm64** | turn orphaned, 5 runs of 5; spritzer logs `Connection header "" does not contain Upgrade` each time |
| **amd64** | the turn completes and streams output, on a GitHub runner |

Same multi-arch image tags on both sides, so
[spritzer#18](https://github.com/INTENTIUS/spritzer/issues/18) is not simply
"open" — it reproduces on one architecture.
[#67](https://github.com/INTENTIUS/fountain-ops/issues/67) is where that gets
resolved.

`just e2e` therefore asserts only the part that holds on both: a sandbox is
provisioned and a turn starts. That still catches a broken Secret, an
unreachable data plane and a migration that did not run. Which way the turn
went is printed, never asserted.
:::

Until this existed the e2e assertions lived only in `ci/pipeline.ts` as
workflow steps, so answering "do the documented claims still hold on my
machine?" meant reading the pipeline and transcribing it by hand. Three of the
gates above — the backup restore, the conversation gate and the account path —
were not in CI at all, which left `restore-drill` as the thing that turns "a
backup nobody has restored is a hypothesis" into a fact while nothing re-ran
it.

Actions are pinned by commit SHA, tools by release version. A tag is a moving
pointer, and whoever controls it controls what runs here.

## This site

Astro and [Starlight](https://starlight.astro.build/), built and deployed by the
`pages` workflow on every push to `main`.

```bash
cd docs-site && npm install && npm run dev
```

The write scopes Pages needs — `pages: write`, `id-token: write` — sit on the
deploy job alone rather than at workflow level, so no other job in the file
holds the credential that publishes.

## Viewing the estate in behold

[behold](https://github.com/INTENTIUS/behold) renders a chant project's graph
and overlays what is live. This repo binds the `local` environment to its k3d
cluster, which is what lets behold read the deployed estate rather than the
source graph alone:

```bash
npm run dev -- preview /path/to/fountain-ops --env local   # from the behold repo
```

Every declared resource comes back observed, plus the running pods as runtime
nodes.

**Only `local` is bound.** chant's k8s reader resolves `--env <name>` to the
context named in `chant.config.ts`; with no binding it reads whatever context
happens to be ambient, which is how pointing behold at this repo once had it
attempt to observe against a live EKS cluster in another account. A declared
binding is checked on every read and refuses on mismatch — right for a laptop,
wrong for a cluster this repo knows nothing about, which is why `dev` and
everything else stay unbound. Bring your own profile:

```ts
k8s: { profiles: { staging: { context: "your-context" } } }
```

`just` exports `FOUNTAIN_ENV=local`, so a local deploy is owned, labelled and
bound under one name — without that the ownership marker says `dev` while
behold reads `--env local` and matches nothing.

### Operating it from there

Two more things behold finds by convention, which turn the picture into a
control plane:

| | |
|---|---|
| `ops/fountain-apply.op.ts` | an `ApplyOp`, so **Run** streams Build → Plan (a live diff) → Apply |
| `scripts/local/local-up.sh` | so the k3d substrate pill offers **Bring up** from cold |

Both are thin. The scripts delegate to `just cluster-up` and `just down` rather
than being a second way to create a cluster, and the Op is bound to `local`
with `delete: "owned-only"` — prune is scoped to the ownership marker, so it
removes what this project stopped declaring and never touches anything it did
not put there.

`fountain-apply` is not gated. A gated apply needs Temporal for the durable
approval wait, and gating belongs on the Ops that can destroy something
([#3](https://github.com/INTENTIUS/fountain-ops/issues/3),
[#8](https://github.com/INTENTIUS/fountain-ops/issues/8)) rather than on one
that applies a Deployment to a laptop.
