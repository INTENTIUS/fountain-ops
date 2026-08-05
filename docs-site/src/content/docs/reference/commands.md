---
title: The just targets
description: Every recipe in the justfile, what it actually does, and which ones refuse to run without an opt-in.
---

The justfile is the driving surface for this repo. `just up` is the whole loop,
and every other target is a step of it you can run on its own, because when a
deploy goes wrong you want the step and not the whole thing again.

Bare `just` lists every recipe with its one-line description. `just doctor`
checks the machine has what those recipes need, and prints an install line for
whatever it does not find.

## Build parameters go through a variable

```bash
just params="--param postgres=cnpg" up
```

`params` is a justfile variable rather than a recipe argument because `up` is a
chain of targets, and just does not thread arguments through dependencies. As a
variable it reaches `build`, `apply` and `storage-init` alike, so every step of
one `up` sees the same parameters.

Two targets are deliberately outside that: `preview` takes positional
arguments, and `dry-run` forwards everything after the target name. Setting
`params=` in front of either has no effect on them.

## The cluster guard

Every recipe that reaches for a cluster first checks that `kubectl`'s current
context is `k3d-fountain-local`, and refuses otherwise. A kube context is
global state that anything on the machine can change — creating any other k3d
cluster switches it, silently, mid-session — and a wrong answer that looks like
a real finding is worse than an error.

```
  ✗ kubectl context is "k3d-other", not "k3d-fountain-local".
```

`cluster-up` is exempt because it sets the context; `check`, `build`, `lint`
and `test` never touch a cluster at all. Everything else honours
`ALLOW_FOREIGN_CLUSTER=1` when you mean it, which running `just dry-run`
against a real cluster is a legitimate reason to. The guard itself is an
internal recipe, `_require-cluster`; targets whose names start with `_` are
implementation detail and are not listed here.

## Lifecycle

| target | what it does |
|---|---|
| `doctor` | Reports whether `docker`, `k3d`, `kubectl`, `node`, `npm` and `jq` are present, whether the Docker daemon is running, and how to install anything missing on this platform. `sops` and `age` are reported but never required — they are only needed for `secrets=sops`. Exits non-zero if a required tool is absent |
| `up` | Runs `cluster-up`, `secret`, `build`, `apply`, `wait`, `storage-init` and `verify`, in that order. Safe to re-run: it will not create a second cluster and will not mint a second secret over the first. See [Stand it up locally](/fountain-ops/getting-started/stand-it-up/) |
| `down` | Deletes the k3d cluster, which is everything this created and nothing it did not |
| `cluster-up` | Creates the `fountain-local` k3d cluster if it does not exist, switches `kubectl` to its context, then polls `/readyz` for up to two minutes. Idempotent |
| `cluster-down` | Deletes the k3d cluster. What `down` delegates to |

:::caution[`down` deletes a cluster, not a deployment]
`down` removes the k3d cluster named `fountain-local`. Against a cluster this
repo did not create — anything you reached with `ALLOW_FOREIGN_CLUSTER=1` — it
finds no such k3d cluster, removes nothing, and does not fail. Tearing that
deployment down is `kubectl delete -f dist/fountain.yaml`, or behold's Op with
its owned-only prune.

Deleting the cluster also takes `MASTER_SECRETS_KEY` with it, because
`just secret` stores it nowhere else. Read
[Secrets](/fountain-ops/reference/secrets/) before you do this to anything that
holds data you want back.
:::

## Reaching it

| target | what it does |
|---|---|
| `forward` | Holds `kubectl port-forward` open on `svc/fountain`, so the app answers on `http://localhost:4000` until you interrupt it |
| `status` | `kubectl get all,pvc,cronjob` in the `fountain` namespace |
| `logs` | The app's last 100 log lines, following |
| `pg-logs` | The bundled database's last 50 log lines, not following. Only exists at `postgres=bundled` — `cnpg` and `reference` put Postgres somewhere this does not look |

## Accounts

Both take an email address, validate its shape before doing anything, and run
the release task in a throwaway pod whose spec is lifted from the live
Deployment, so the eval gets exactly the environment the app runs with. The
full story is in [First login](/fountain-ops/getting-started/first-login/).

| target | what it does |
|---|---|
| `verify-email EMAIL` | Marks a registered account's email verified without any mail. An escape hatch since fountain ADR 0011 (accounts self-verify at registration under `emailDelivery=none`): needed only on pins ≤ v0.4.0 — where skipping it bounced every authenticated page back to the login form with nothing on screen saying why — or when a real mail provider is broken |
| `promote-admin EMAIL` | Grants an account the admin role, audit-recorded as `admin.role.granted`. The manual path: with the default `firstUserAdmin=true` the first verified account is promoted in-app (fountain ADR 0011) and this reports it already admin. Already-an-admin is success. There is no revoke target — that is done from the panel, by an admin |

Both report a missing account as a failure with the register-first instruction,
rather than trusting the exit code: the release task prints its complaint and
returns an error tuple that sets no exit status.

## Verification

| target | what it does |
|---|---|
| `verify` | `GET /health` from a curl pod inside the cluster, so no port-forward is needed. Proves the release booted and nothing more |
| `verify-conversation EMAIL [MODE]` | Makes a throwaway agent, opens one conversation, asserts the event stream, and tears both down even when an assertion fails. `MODE` is `plumbing` (default) or `strict`; `strict` refuses to run against `dataPlane=spritzer`. Needs a verified account and `$FOUNTAIN_PASSWORD` in the environment rather than on the command line. See [The data plane](/fountain-ops/reference/data-plane/) |
| `e2e` | Stands up from nothing, asserts every documented claim, tears down. This is the whole of CI's e2e job, runnable on a laptop. On failure it leaves the cluster up on purpose so there is something to look at. See [CI and the site](/fountain-ops/reference/ci/) |

`e2e` calls `just up` and `just down` itself, so it wants no cluster
beforehand and leaves none behind on success.

## Build and preview

| target | what it does |
|---|---|
| `build` | Renders the manifests to `dist/fountain.yaml`. Honours `params` |
| `apply` | `build`, then `kubectl apply -f dist/fountain.yaml` |
| `wait` | Waits for both rollouts: 120s for Postgres, 300s for the app, which migrates at boot |
| `check` | `typecheck`, `lint`, `test`, `build`. Touches no cluster, and is deliberately the same chain CI's check job runs |
| `typecheck` | `tsc --noEmit`. Its own step because `chant build` executes the source, so a property that does not exist reads as `undefined` instead of failing |
| `lint` | `chant lint src` |
| `test` | `vitest run` |
| `preview TARGET TIER CLASS` | Prints the manifests for a different substrate to stdout without applying anything. Defaults are `kubernetes`, `ha`, `nginx`, so bare `just preview` shows the far end from the local one. Ignores `params`; the three arguments are the parameters |
| `dry-run *ARGS` | Builds to a temporary file and asks a real API server to validate it with `--dry-run=server`. Nothing is created. Everything after the target name is passed to `chant build`, so this is where `--param` goes directly. Needs the CRDs for whichever seams are on |

`check` answers "does this build"; `dry-run` answers "would a cluster accept
it", which is a different question and the one that catches a field chant is
happy to serialize and Kubernetes rejects.

```bash
just crds
just dry-run --param postgres=cnpg --param backups=barman-pitr
```

## Secrets

| target | what it does |
|---|---|
| `secret` | Creates the namespace, then mints `fountain-secrets` with generated values — once. It reads before it writes and leaves an existing secret alone |
| `secrets-sync` | Decrypts `secrets/platform.enc.yaml` straight into the cluster Secret for `secrets=sops`. Nothing decrypted is written to disk, and it looks for your age identity in both places sops might keep it |
| `master-key` | Prints `MASTER_SECRETS_KEY` to stdout, so it can be kept somewhere the cluster is not |

Why `secret` refusing to rotate matters, and why the master key needs a home
outside the database it protects, are both in
[Secrets](/fountain-ops/reference/secrets/).

:::danger[`master-key` requires an explicit opt-in]
```bash
I_MEAN_IT=1 just master-key | pbcopy
```

Without `I_MEAN_IT=1` it prints instructions and exits 2. The opt-in is not
conditional on stdout being a terminal, because a pipe, a CI step, a script's
command substitution and an agent's tool output are all not-a-terminal and all
places a secret should not appear by accident.
:::

## Backups

| target | what it does |
|---|---|
| `backup-now` | Creates a Job from `cronjob/fountain-pg-backup` so the backup runs now instead of on its schedule. Needs `backups=pg-dump`, which is the k3d default |
| `restore-drill` | Restores the newest backup object into a throwaway database, counts its tables against the live one, and drops the throwaway either way. Nothing writes to the live database. A drill that cannot verify is a failing finding **on the backup** |
| `storage-init` | Creates the backup bucket when the storage seam is the emulator, and prints "storage is not emulated" and exits 0 when it is not. Part of `up` |

`storage-init` exists because floci starts empty, and `aws s3 cp` to a bucket
that does not exist fails the way a missing credential does: late, in the
upload container, after a good dump has already been taken. A real bucket is
yours to create; this only ever touches the emulator, and an existing bucket
counts as success so re-running `up` stays a no-op.

## Operators and CRDs

| target | what it does |
|---|---|
| `crds` | Installs the CRD schemas every operator seam declares against — CNPG, barman, Traefik, Infisical, Prometheus, cert-manager. Manifests validate; no controller runs, so nothing is reconciled |
| `operators` | Installs cert-manager, CNPG and the barman-cloud plugin, and waits for each to become Available. After it, `postgres=cnpg` produces a database that accepts connections |

The split is deliberate: installing controllers into a cluster is a much bigger
action than installing schemas, and the two should not become one command by
accident. `operators` is not part of `up` for the same reason, and it refuses a
kube context it does not recognise, because on a cluster you did not create the
teardown is not free. Both versions come from the same pins at the top of the
justfile, so the schemas and the controllers cannot drift apart.
[Seams](/fountain-ops/reference/seams/) has the rest, including the three seams
that still have no controller.

## CI and the site

| target | what it does |
|---|---|
| `ci` | Renders both GitHub workflows from their TypeScript declarations — `ci/` to `.github/workflows/ci.yml`, `pages/` to `pages.yml`. Two commands because `chant build <dir>` collects a directory into one file |
| `ci-check` | Diffs each committed workflow against what its declaration renders, and fails with the diff if they disagree. The gate that keeps the TypeScript authoritative |
| `site` | Builds the docs site the way CI does, using `npm ci` when there is a lockfile, so what gets published is what you previewed |
| `site-dev` | `npm install` and the Astro dev server, with hot reload |

Why a pipeline is declared rather than written is in
[CI and the site](/fountain-ops/reference/ci/).
