---
title: CI and the site
description: Both workflows are declared, and a gate fails if the committed YAML drifts.
---

This repo's rule is that its infrastructure is chant. A pipeline is
infrastructure, so both workflows are declared and rendered rather than
written by hand.

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
**silently** while the declaration still looked authoritative. `ci-check` is
the gate that stops it, and it runs in CI as well as locally.

```
  ✓ .github/workflows/ci.yml matches ci/pipeline.ts
  ✓ .github/workflows/pages.yml matches pages/pipeline.ts
```

## Two jobs

**check** is the same `just check` chain you run locally: typecheck, lint,
test, build. Deliberately identical, so the thing people run before pushing
keeps predicting what CI does.

**e2e** is the same `just e2e`, for the same reason.

```bash
just e2e
```

Stands up from nothing and asserts, in order:

| | |
|---|---|
| readiness | `/health/ready` answers `{"database":"ok"}`, so the app reached Postgres, not just booted |
| the master key | re-running `just up` leaves `MASTER_SECRETS_KEY` byte-identical |
| a clean start | the app's `restartCount` is 0, so the Postgres wait has not regressed |
| the backup | taken, then restored into a throwaway and table-matched against live |
| the account path | register over the API, verified (self-verified on pins past v0.4.0; `verify-email` is idempotent either way), headless throughout |
| the first-admin bootstrap | the account ends up admin — in-app on pins past v0.4.0 (`promote-admin` reports it already admin), granted by the release task on older ones |
| the conversation gate | the outcome matches the path taken, either way |
| every seam | `just crds` then `just dry-run`, validated by a real API server |

Then it tears down. On failure it leaves the cluster up so there is something
to look at; CI runs its own teardown regardless.

:::caution[The conversation gate has two legitimate outcomes]
Whether a turn completes is decided by a race, so neither result can be pinned.
The pinned release branches on `sandbox.status`: `ready` reattaches, and
reattach calls `list_sessions`, which spritzer answers `426`, orphaning the
turn. `pending` or `starting` provisions fresh and the turn runs to
`exit_code: 0`.

Machine speed decides which, so a faster machine sees the orphaned turn more
often. Measured with identical image digests: 5 of 5 orphaned on a laptop, 2 of
2 completed on a CI runner.
[The data plane](/fountain-ops/reference/data-plane/) has the detail.

So `just e2e` asserts the **pairing** rather than a result. Reattach implies an
orphaned turn; no reattach implies a completed one. A reattach that succeeds,
or a fresh provision that does not finish, stops the build:

```
✗ reattach ran and did NOT orphan the turn — spritzer#18 may be fixed.
  Re-check #67 and the status page.
```

That holds on any machine and is stricter than asserting provisioning alone.
Which path was taken is printed with the architecture beside it.
:::

Actions are pinned by commit SHA, tools by release version. A tag is a moving
pointer, and whoever controls it controls what runs here.

## This site

Astro and [Starlight](https://starlight.astro.build/), built and deployed by the
`pages` workflow on every push to `main`.

```bash
cd docs-site && npm install && npm run dev
```

The write scopes Pages needs (`pages: write`, `id-token: write`) sit on the
deploy job alone rather than at workflow level, so no other job in the file
holds the credential that publishes.
