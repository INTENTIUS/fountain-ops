---
title: Seams
description: Who provides each dependency, and which combinations are refused.
---

Each dependency has a mode. The target picks defaults that are coherent on that
substrate; setting one explicitly replaces exactly that seam and leaves the rest
alone.

| Seam | Modes |
|---|---|
| `postgres` | `bundled` · `reference` · `cnpg` |
| `secrets` | `reference` · `sops` · `infisical` |
| `ingress` | `omit` · `ingress` · `traefik` |
| `tls` | `omit` · `cert-manager` |
| `backups` | `omit` · `pg-dump` · `barman-pitr` |
| `monitoring` | `omit` · `prometheus-operator` |
| `dataPlane` | `sprites` · `spritzer` |
| `storage` | `s3` · `floci` |

`reference` means "it already exists, here is how to reach it". `omit` means
"this deployment does not have one".

## The emulated pair

`k3d` defaults two seams to in-cluster emulators, and both are the same idea:
the seam is a URL, so it can point somewhere fake without the thing on the
other side being built differently.

`dataPlane=spritzer` is the Sprites API. `storage=floci` is an S3-compatible
bucket, so the backup job runs its real dump → upload → verify → prune path
against an emulated store instead of being the part nobody exercises until a
restore.

`backupS3Endpoint` used to default to `http://localhost:4566`, matching a floci
on your laptop. From inside a pod `localhost` is the pod, so that endpoint could
never reach it — the upload container was talking to itself. In the cluster the
address is a Service name that resolves from where the job actually runs.

## What is refused

Every mode is expressible. What is refused is **incoherence** — combinations
that apply perfectly cleanly to a cluster and then mean something other than
they say:

- a "highly available" single Postgres
- a WAL archive with nothing archiving into it
- a certificate nothing terminates
- an in-memory emulator behind the word `ha`

Each of those is a failure that is invisible on the cluster, which is why it is
a build error instead.

## The one that has no other guard

CNPG cron is six fields, leading with seconds. Kubernetes `CronJob` takes five.
Nothing else catches the difference: the CRD types the field as a plain string
and the cluster accepts either.

```
pitrSchedule "47 2 * * *" has 5 fields; CNPG needs six, leading with seconds.
A five-field cron is accepted by the cluster and means a different time —
"47 2 * * *" is 02:47 to every other cron and second 47 of every minute-2 to
CNPG. Prefix the seconds: "0 47 2 * * *".
```

The symptom without that check is 24 base backups a day and no error anywhere,
which is why `pitrSchedule` is a separate parameter from `backupSchedule`
rather than one shared between two seams that read it differently.

## Operators

chant declares custom resources; it does not install controllers. Two targets,
and the split between them is deliberate.

```bash
just crds        # schemas only — manifests validate, nothing runs
just operators   # the controllers that reconcile them
```

`just crds` is enough to check that a real API server accepts what this repo
emits, without putting a controller anywhere:

```bash
just crds
just dry-run --param postgres=cnpg --param backups=barman-pitr
```

`just operators` installs **cert-manager**, **CNPG** and the **barman-cloud
plugin** — cert-manager first because the barman plugin declares an `Issuer` and
a `Certificate` and will not start without one. After it, `postgres=cnpg`
produces a database that actually accepts connections:

```bash
just operators
just params="--param postgres=cnpg" up
```

It refuses to run against a kube context it does not recognise. Installing
cluster-scoped controllers is free to undo on a throwaway k3d cluster, because
`just down` deletes the lot; on a cluster you did not create it is not, and
uninstalling an operator from under running workloads is its own problem. Pass
`ALLOW_FOREIGN_CLUSTER=1` if you meant it.

Three seams are still not installed, for reasons rather than by omission:
Traefik already ships with k3s but nothing routes through it here, Infisical
needs an Infisical server to talk to, and kube-prometheus-stack is a lot of
laptop for a `ServiceMonitor`.
