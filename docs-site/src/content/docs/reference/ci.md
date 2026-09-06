---
title: CI and the site
description: Every workflow is declared, and a gate fails if the committed YAML drifts.
---

This repo's rule is that its infrastructure is chant. A pipeline is
infrastructure, so every workflow is declared and rendered rather than
written by hand.

```bash
just ci          # render every workflow
just ci-check    # fail if any committed file has drifted from its source
```

| source | rendered |
|---|---|
| `ci/pipeline.ts` | `.github/workflows/ci.yml` |
| `pages/pipeline.ts` | `.github/workflows/pages.yml` |
| `e2e-k8s/pipeline.ts` | `.github/workflows/e2e-k8s.yml` |
| `image-pin/pipeline.ts` | `.github/workflows/image-pin.yml` |
| `workflows/shared.ts` | pins they share — checkout SHA, `just` and k3d versions |

GitHub reads YAML from the default branch, so the rendered file has to be
committed. That makes hand-editing it possible, and a hand edit would win
**silently** while the declaration still looked authoritative. `ci-check` is
the gate that stops it, and it runs in CI as well as locally.

```
  ✓ .github/workflows/ci.yml matches ci/pipeline.ts
  ✓ .github/workflows/pages.yml matches pages/pipeline.ts
  ✓ .github/workflows/e2e-k8s.yml matches e2e-k8s/pipeline.ts
  ✓ .github/workflows/image-pin.yml matches image-pin/pipeline.ts
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
| the conversation gate | a sandbox is provisioned, the turn is dispatched into it and its output streams back, against the emulated data plane |
| every seam | `just crds` then `just dry-run`, validated by a real API server |

Then it tears down. On failure it leaves the cluster up so there is something
to look at; CI runs its own teardown regardless.

:::caution[The conversation gate stops at the ACP handshake]
It asserts the sandbox, the dispatch and the stream, and then one recognised
ending rather than a completed turn.

fountain speaks the Agent Client Protocol to its runtimes from `v0.9.0`
([fountain#671](https://github.com/BinaryBourbon/fountain/pull/671),
[#674](https://github.com/BinaryBourbon/fountain/pull/674)), so a turn opens
`claude-agent-acp` and sends `initialize`. spritzer `0.5.0` echoes command
lines and speaks no JSON-RPC, so it answers `-32601` and the turn ends
`failed`. Deterministic, and nothing here can close it — spritzer has to
answer, and `0.5.0` is its newest release. The gate says so out loud rather
than going red every run:

```
✓ plumbing: sandbox provisioned, turn dispatched, output streamed
  the turn then failed the ACP handshake, which is as far as
  spritzer 0.5.0 goes against a fountain that speaks ACP
```

Any other ending still fails, including the two this gate was built around,
each of which names the pin that must have moved:

```
✗ the turn was orphaned behind a reattach — fountain#603 or spritzer#19
  regressed, or the pin rolled back
✗ the runtime exited before the prompt was written — spritzer#20 regressed,
  or spritzerImage rolled back below 0.5.0
```

A real data plane is still held to a turn that exits 0, and so is the emulator
the day it answers `initialize`. [The data plane](/fountain-ops/reference/data-plane/)
has the mechanism, and the history of describing this row wrong four times.
:::

Actions are pinned by commit SHA, tools by release version. A tag is a moving
pointer, and whoever controls it controls what runs here.

## The image pin

`image` defaults to a pinned fountain release, and the version is written in
exactly one place: `FOUNTAIN_VERSION` in `src/lib/fountain-image.ts`, which
both `chant.config.ts`'s declared default and `src/params.ts`'s fallback read.

It used to be spelled out in both files, with nothing reading either one, and
it stopped at `v0.7.0` for nine upstream releases — long enough that `just up`
was standing up an instance with no team roster, no teammate schedules, no
webhook endpoints and no sandboxes routes, against docs that describe all four
([#119](https://github.com/INTENTIUS/fountain-ops/issues/119)). Every other pin
here has something that would notice it moving. This one now does too:

```
Monday 06:17 UTC, or whenever the button is pressed

  read FOUNTAIN_VERSION, ask GitHub for fountain's latest release
  same             -> nothing
  behind           -> one PR on image-pin/<tag>, moving that one line
  branch exists    -> nothing, so a declined bump stays declined
```

The pull request is the prompt, not the work. Taking a bump means reading
what changed upstream between the two releases and running `just e2e` against
the new image, the way the `v0.6.1 -> v0.7.0` bump did — a pin move is a
deploy-path change, and that is this repo's bar for one. The PR body lists the
files that still name the old version, because the pin is quoted in prose that
a `sed` would wreck.

It arrives with no CI run on it. That is GitHub's rule, not a
misconfiguration: pushes made with `GITHUB_TOKEN` do not start workflow runs.
Close and reopen the PR, or push to the branch, to get one.

## This site

Astro and [Starlight](https://starlight.astro.build/), built and deployed by the
`pages` workflow on every push to `main`.

```bash
cd docs-site && npm install && npm run dev
```

The write scopes Pages needs (`pages: write`, `id-token: write`) sit on the
deploy job alone rather than at workflow level, so no other job in the file
holds the credential that publishes.
