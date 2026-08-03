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
| `secrets` | `reference` · `infisical` |
| `ingress` | `omit` · `ingress` · `traefik` |
| `tls` | `omit` · `cert-manager` |
| `backups` | `omit` · `pg-dump` · `barman-pitr` |
| `monitoring` | `omit` · `prometheus-operator` |
| `dataPlane` | `sprites` · `spritzer` |

`reference` means "it already exists, here is how to reach it". `omit` means
"this deployment does not have one".

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

## Operators are not installed

The operator modes need their operator already installed. chant declares custom
resources; it does not install controllers.

`just crds` installs the CRDs those seams declare against, deliberately without
the operators — enough to validate manifests against a real API server, and
nothing reconciles. That gap is
[#22](https://github.com/INTENTIUS/fountain-ops/issues/22), and it is the
keystone for most of the "builds only" rows in
[Status](/fountain-ops/status/).

```bash
just crds
just dry-run --param postgres=cnpg --param backups=barman-pitr
```
