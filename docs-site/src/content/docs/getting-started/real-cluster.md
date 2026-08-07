---
title: Stand it up on a real cluster
description: The order of operations for target=kubernetes — what you need, the decisions in order, and the commands.
---

This is the same build as the laptop loop, aimed at a cluster k3d did not
create. What changes is who provides the pieces: the laptop loop mints and
emulates everything, and here the database, the Secret, the ingress class and
the hostname are yours to bring.

## What you need

- **A cluster and a kubectl context** that reaches it. Any Kubernetes; the
  ingress and TLS decisions below adapt to what it runs.
- **A Postgres** — managed, or run by someone in the cluster — *or* the CNPG
  operator, if this deployment should run its own.
- **An ingress class** the cluster answers to: `kubectl get ingressclass`.
- **A hostname** that resolves to that ingress.
- **A place the platform Secret comes from** — created by hand, synced from
  this repo with sops, or reconciled by an operator.

Each of those is one decision below, and each decision is one `--param`.

## Preview first

```bash
just preview kubernetes ha
```

Prints the manifests and touches no cluster. `preview` takes target, tier and
ingress class positionally and already defaults to `kubernetes ha nginx`, so
bare `just preview` is the same command. It is the fastest way to see what a
set of decisions produces before any of them are yours to keep.

How much of this path has been exercised, and where the verified ground
stops, is [Status](/fountain-ops/status/)'s job — the short version is that
`light` and `ha` both apply and serve on a multi-node stand-in
(`just e2e-k8s` re-checks that), no managed cluster has ever been used
([#23](https://github.com/INTENTIUS/fountain-ops/issues/23)), and the steps
below call out the things that have never run anywhere — a cert-manager
issuance, an Infisical reconcile, a real `SPRITES_TOKEN` — as you reach
them.

## The foreign-cluster guard

Every recipe that reaches for a cluster depends on a guard that refuses a
kubectl context it does not recognise:

```
  ✗ kubectl context is "my-cluster", not "k3d-fountain-local".
```

That covers `apply`, `secret`, `secrets-sync`, `dry-run`, `operators`, `verify`,
`verify-email`, `promote-admin`, `verify-conversation`, `master-key`,
`restore-drill` and the rest. It exists because a kubectl context is global
state anything on the machine can change — creating any k3d cluster switches it
mid-session — and acting on the wrong cluster is worse than an error.

Deploying somewhere real is exactly the case where you mean it:

```bash
export ALLOW_FOREIGN_CLUSTER=1
```

The rest of this page assumes that is exported.

:::caution[`just up` is not the entry point here]
`up` begins with `cluster-up`, which creates the k3d cluster and switches your
kubectl context to it. On a real cluster you run its steps yourself; the
sequence is at the bottom of this page.
:::

## The decisions, in order

Where each seam starts on `kubernetes`:

| seam | default | the decision |
|---|---|---|
| `postgres` | `reference` | who runs the database |
| `secrets` | `reference` | what puts the Secret in the cluster |
| `ingress` | `ingress` | needs `ingressClassName`, always |
| `tls` | `omit` | `cert-manager` builds; it has never issued |
| `backups` | `omit` | `pg-dump` needs a bucket that resolves in-cluster |
| `monitoring` | `omit` | `prometheus-operator` builds only |
| `dataPlane` | `sprites` | needs a real `SPRITES_TOKEN` |
| `storage` | `s3` | a real bucket, which is yours to create |

Setting one replaces exactly that seam and leaves the rest alone. The full mode
list is in [Seams](/fountain-ops/reference/seams/).

### `postgres`

`reference` says "it already exists, here is how to reach it" — a managed
database, or one somebody else operates in the cluster. Nothing about it is
declared here: `DATABASE_URL` lives in the Secret, because a connection string
with a password in it is not config.

`cnpg` means the cluster runs the database, and that needs a controller. chant
declares custom resources; it does not install them:

```bash
just operators
```

That installs **cert-manager**, **CNPG** and the **barman-cloud plugin**,
cluster-wide. On k3d that is free to undo because `just down` deletes the
cluster; on a cluster you did not create it is not, and uninstalling an operator
from under running workloads is its own problem. The guard above is what makes
you say so out loud. CNPG reconciling a real database, migrating 23 tables and
answering `{"database":"ok"}` is verified — on k3d.

### `databaseSsl`

Defaults to `true` for anything but the bundled Postgres. True of a managed
cloud database; false of the ordinary case `reference` exists for, a Postgres
somebody else runs in your cluster. Against one of those the app crashloops on
boot with `(Postgrex.Error) ssl not available`, so:

```bash
--param databaseSsl=false
```

### `secrets`

`just secret` is a laptop convenience and the wrong secret for this cluster.
Four of the eight values it mints are local stand-ins: `DATABASE_URL` points at
`fountain-postgres.<namespace>.svc.cluster.local`, which `postgres=reference`
never creates; `SPRITES_TOKEN` is the literal string
`local-dev-not-a-real-token`; both AWS credentials are placeholders.

| mode | source of truth |
|---|---|
| `reference` | the cluster. Something else put the Secret there — your platform's secret manager, a sealed-secrets controller, `kubectl create secret` — and this repo reads it by name |
| `sops` | this repo, as ciphertext in `secrets/platform.enc.yaml`, decrypted into the cluster by `just secrets-sync`. This is the one that carries to a second machine and a second operator |
| `infisical` | an Infisical server. Builds; no operator has reconciled it |

Whichever you pick, `POSTGRES_PASSWORD` and `DATABASE_URL` must agree and
nothing checks it — a mismatch reads like a bad credential rather than like two
credentials that were never the same one. That and the age-key path trap are in
[Secrets](/fountain-ops/reference/secrets/).

### `host` and `scheme`

`host` defaults to `localhost:4000`, which as an Ingress rule matches nothing:

```bash
--param host=fountain.example.com --param scheme=https
```

`scheme=https` is not cosmetic. It turns on fountain's HTTPS redirect, HSTS and
secure cookies, so whatever terminates TLS must set `X-Forwarded-Proto` or every
request looks like http and redirect-loops. The port is stripped for anything
that wants a hostname — the Ingress rule, `PHX_HOST`, a certificate SAN — so
`PUBLIC_URL` keeps it and those do not.

### `ingress` and `ingressClassName`

`ingressClassName` has no default and the build refuses without it:

```
ingress="ingress" needs ingressClassName — an Ingress with no class is claimed by
no controller unless the cluster happens to have a default one, and applies
cleanly either way.
```

`kubectl get ingressclass` lists what your cluster will answer to. The refusal
exists because the failure it replaces is invisible: tested against a cluster
running both Traefik and nginx with no default, the classless Ingress applied
without complaint and 404ed every request.

### `tls`

```bash
--param tls=cert-manager --param clusterIssuer=letsencrypt-production
```

:::caution[This is where the verified ground stops]
cert-manager installs, is Available, and the `Certificate` this emits is
accepted by a real API server. **No certificate has ever been issued through
it**, because a local cluster has no domain to issue against. The first real
issuance — DNS resolving to your ingress, the solver reachable, the order
completing — is unexercised here. Treat a green build as a green build.
:::

`tls=cert-manager` with `ingress=omit` is refused: a certificate nothing
terminates is an unused Secret that looks like the deployment serves HTTPS.

### `dataPlane`

`kubernetes` already defaults to `sprites`, the real Fly Sprites API. What it
does not have is a token — put a real `SPRITES_TOKEN` in the Secret.

:::danger[The token is a platform credential]
`SPRITES_TOKEN` is a **platform** credential, never a tenant one. It must not
reach tenant-visible config, agent Environments or Vaults, or logs. And a Fly
platform token is **not** a Sprites token: a credential `api.fly.io/graphql`
accepts is rejected by `api.sprites.dev` with `401 authentication failed`.
:::

What the emulator can and cannot prove, and why a completed turn against it is
plumbing rather than a reply, is in
[The data plane](/fountain-ops/reference/data-plane/).

### `backups`

`omit` on this target, deliberately — a backup destination is not something to
assume about a cluster.

`pg-dump` dumps over `DATABASE_URL` and uploads with the AWS credentials in the
platform Secret, so it works against any Postgres the app can reach, managed or
not. Two things are yours: the bucket exists or the upload fails late, in the
upload container, after a good dump has been taken; and `backupS3Endpoint` must
resolve **from inside the cluster**. Unset means AWS's own endpoint, which is
what a real S3 bucket wants. A laptop-style `localhost:4566` leaves the upload
container talking to itself. `just storage-init` only ever creates the emulated
bucket and no-ops here.

`just restore-drill` execs `deploy/fountain-postgres` for its live table count,
so it runs against the bundled Postgres only. There is no drill for a referenced
database yet, which means on this target the backup is unverified in exactly the
way the drill exists to fix.

`barman-pitr` needs `postgres=cnpg` — WAL archiving is a property of the CNPG
cluster, and there is nothing to archive from a Postgres chant does not manage.
It has been taken and restored once, against the emulated store on k3d —
[Backups](/fountain-ops/reference/backups/#barman-pitr--taken-and-restored-on-the-emulated-store)
has what that run proved, including the credentials Secret that is yours to
create. **No real S3 bucket has ever held the archive.** Its schedule is six
fields leading with seconds, not five; `pitrSchedule` is validated for that
because the cluster accepts either and the wrong one means 24 base backups a
day with no error anywhere.

## Build, validate, apply

Collect the parameters once so the three commands cannot disagree:

```bash
P="--param target=kubernetes \
   --param host=fountain.example.com --param scheme=https \
   --param ingressClassName=nginx \
   --param databaseSsl=false"
```

```bash
just params="$P" build      # renders dist/fountain.yaml, touches no cluster
just dry-run $P             # a real API server validates it; creates nothing
just params="$P" apply
```

`dry-run` is worth the extra step: `build` proves the manifests render, and this
proves the API server validates them against the actual CRD schemas — a
different question, and the one that catches a field chant will serialize
happily and the cluster rejects. For seams with custom resources it needs their
schemas, which is `just crds`.

`just wait` waits for whichever database is actually in the cluster — the
bundled Deployment, or the CNPG `Cluster` — and skips straight to the app for
a referenced Postgres, which is not its to wait for. The equivalent by hand:

```bash
kubectl rollout status deployment/fountain -n fountain --timeout=300s
```

Everything `just` builds carries `FOUNTAIN_ENV=local`, because the justfile
exports it. The ownership marker and the `app.kubernetes.io/instance` label
therefore say `local` on a cluster that is not, and those are what `--owned`
filtering, drift and the owned-only prune key on.

## Verify

Three checks, each proving more than the last.

```bash
just verify                                        # GET /health, from inside the cluster
curl -fsS https://fountain.example.com/health/ready # {"database":"ok"}, through the Ingress
```

The second one is the interesting one. `/health` says the release booted;
`/health/ready` says it reached its database, and reaching it through the
Ingress rather than a port-forward is what proves the class, the rule and the
controller agree. That specific check is what the k3d stand-in run asserted.

Then the account path at your host instead of `localhost:4000` — register and
you have a verified admin account, exactly as
[on a laptop](/fountain-ops/getting-started/stand-it-up/#first-login). Register
**before** the instance is exposed: until an admin exists, the role goes to
whoever verifies first, and on this target that window is public. The manual
recipes (`verify-email`, `promote-admin`) lift their pod spec from the live
Deployment, so they carry over to any cluster unchanged —
[Promoting an admin manually](/fountain-ops/reference/promote-admin/) has
them, including the raw `kubectl` shape for a machine without the justfile.

```bash
export FOUNTAIN_PASSWORD=...        # not on the command line
just verify-conversation you@example.com strict
```

`strict` asserts a model actually replied, and refuses to run against
`dataPlane=spritzer` because the emulator satisfies every plumbing assertion
with no model in the loop. Only the refusal has been observed: nothing in this
repo has run `strict` green against the real Sprites API, so its passing path is
written down and untried.

## Back up the master key before you care about the data

```bash
I_MEAN_IT=1 just master-key | pbcopy
```

`MASTER_SECRETS_KEY` encrypts every tenant's inference credentials. A full
database restore without it returns ciphertext — the rows come back, the tables
count, the drill passes, and not one credential can be read. `just secret`
stores it only in the cluster, so on a real deployment losing the cluster loses
the key. Put it somewhere whose failure is uncorrelated with the database's, and
see [Secrets](/fountain-ops/reference/secrets/) for why the opt-in is required
no matter where stdout goes.

## What to watch

Applying `target=kubernetes` for the first time turned up three things that had
never run, all now fixed, all worth recognising if you see them:

| | |
|---|---|
| `DATABASE_SSL` | was derived and unsettable; a referenced Postgres serving no TLS crashlooped with no parameter that could say otherwise |
| The Ingress class | no default, so the Ingress carried no class, and a cluster with two controllers and no default ignored it |
| The stream timeout | `proxy-read-timeout: 3600` only emitted at `scheme=https`, so a plain-http ingress cut SSE streams at nginx's 60s default |

The full account of each is in
[Targets and tiers](/fountain-ops/reference/targets-and-tiers/). They are the
shape of what is still out there: a seam that applies cleanly and means
something other than it says.
