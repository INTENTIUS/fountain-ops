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
| the conversation gate | a turn **completes** on a spritzer pod: fountain's ACP fixture runtime is enabled for the e2e account, a persistent agent writes an artifact, the turn ends `end_turn`, and the artifact is read back out of the sprite pod with `kubectl exec` |
| every seam | `just crds` then `just dry-run`, validated by a real API server |

Then it tears down. On failure it leaves the cluster up so there is something
to look at; CI runs its own teardown regardless.

:::note[The conversation gate asserts a completed turn]
For the `v0.16.0` and `v0.21.0` pins against spritzer `0.5.0` it could not:
fountain speaks the Agent Client Protocol to its runtimes from `v0.9.0`, and an
interpreter that echoes command lines answers `initialize` with `-32601`, so
the gate asserted the plumbing and named that refusal
([#91](https://github.com/INTENTIUS/fountain-ops/issues/91)).

Two upstream releases gave the ending back. spritzer `0.6.0`'s container mode
([spritzer#22](https://github.com/INTENTIUS/spritzer/issues/22)) makes every
sprite a pod and runs the real command in it, and fountain `v0.21.0` ships a
deterministic ACP fixture runtime that needs no model and no inference
credential. The gate enables the fixture for the account it just registered
(`--param acpFixtureUserId`), and asserts:

```
✓ fixture: a turn completed (end_turn) on spritzer pod sprite-fountain-…,
  under a limited environment (empty allowlist, not enforced by spritzer),
  and its artifact reads back from the pod. ACP end to end, no model.
```

The fixture is not a model, so this still says nothing about a reply; that is
`verify-conversation … strict` against a data plane with an inference
credential. `spritzerExec=interpreter` keeps the old gate's recognised
handshake refusal for anyone pinning spritzer below `0.6.0`.
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
