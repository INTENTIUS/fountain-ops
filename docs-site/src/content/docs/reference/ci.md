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

**e2e** — stands the whole deployment up on k3d and asserts what the docs claim:
`just up` from nothing, `/health/ready` actually reaching Postgres, re-running
`just up` leaving `MASTER_SECRETS_KEY` byte-identical, and `just crds` then
`just dry-run` with every seam on so a real API server validates the CNPG,
Traefik, Infisical, cert-manager and Prometheus resources.

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
