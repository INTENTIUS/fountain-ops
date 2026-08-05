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
| the account path | register over the API, `verify-email`, headless throughout |
| the first-admin bootstrap | `promote-admin` grants the role, audit-recorded |
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
"open": it reproduces on one architecture and not the other.
[#67](https://github.com/INTENTIUS/fountain-ops/issues/67) is where that gets
resolved.

`just e2e` therefore asserts only the part that holds on both: a sandbox is
provisioned and a turn starts. That still catches a broken Secret, an
unreachable data plane and a migration that did not run. Which way the turn
went is printed, never asserted.
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
