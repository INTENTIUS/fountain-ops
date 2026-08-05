---
title: Backups and restore
description: A backup nobody has restored is a hypothesis.
---

The `backups` seam has three modes: `omit`, `pg-dump` and `barman-pitr`.
`pg-dump` is the k3d default and the one that has been taken and restored.
`barman-pitr` applies and its plugin runs, but nothing has been backed up
through it yet — see [below](#barman-pitr-applies-nothing-has-run-through-it).

## The CronJob

`backups=pg-dump` declares `fountain-pg-backup`, whose order is the whole
point: **dump → upload → verify → prune**.

That is two containers rather than one script. The dump runs to completion as
an init container and refuses to hand over anything under 10 KiB; the upload
container copies it, compares the remote object's size against the local
file's, and only then deletes anything older than the retention window. A
failed run therefore cannot delete a good backup or leave a truncated one
looking valid. A truncated dump that uploads cleanly is worse than a failed
job, because it looks like a backup.

| parameter | default |
|---|---|
| `backupSchedule` | `17 3 * * *` — five fields, Kubernetes cron |
| `backupRetentionDays` | the tier's: 7 on `light`, 30 on `ha` |
| `backupBucket` | `fountain-backups` |
| `backupS3Endpoint` | floci's in-cluster Service when `storage=floci`, otherwise unset (the AWS default endpoint) |

Retention comes from the tier rather than the seam because it is a durability
property, not a question of who provides the store.

## Where it uploads

On k3d the `storage` seam defaults to `floci`, an in-cluster S3-compatible
bucket, so the job runs its real dump → upload → verify → prune path against
an emulated store instead of being the part nobody exercises until a restore.
The other emulated seam is the data plane; both are described in
[Seams](/fountain-ops/reference/seams/#the-emulated-pair).

`backupS3Endpoint` defaults to floci's in-cluster Service name, which resolves
from where the job actually runs.

:::caution[From inside a pod, `localhost` is the pod]
If you override the endpoint, mind that a laptop-style `localhost:4566` leaves
the upload container talking to itself. It used to be the k3d default, matching
a floci on the host — an endpoint that could never have worked from the one
place that uses it.
:::

floci starts empty, and `aws s3 cp` to a bucket that does not exist fails the
way a missing credential does: late, in the upload container, after a good
dump has already been taken. `just up` runs `just storage-init` for that
reason. It creates the bucket only when the endpoint is the emulator's, and an
already-existing bucket is success, so a re-run stays a no-op. A real bucket
is yours to create.

## Running one now

```bash
just backup-now
```

Creates a Job from the CronJob rather than waiting for 03:17, so the run is
the scheduled path and not a second code path that only resembles it.

## The restore drill

```bash
just restore-drill
```

The backup job says "Backup complete" when an object of the right size lands
in the store. That verifies the **upload**, not the dump: a corrupt dump of
the right size uploads cleanly, and you find out during the outage.

The drill restores the newest object into a throwaway database, counts the
tables against the live one, and drops the throwaway whether it passed or
failed. Nothing writes to the live database at any point.

```
  store:       http://fountain-floci.fountain.svc.cluster.local:4566 / fountain-backups
  throwaway:   fountain_drill_1785796929
  live tables: 23
  DRILL_KEY=pg_dump/fountain-2026-08-03T22-42-05Z.dump
  DRILL_RESTORED_TABLES=23
  ✓ restored 23 tables, matched live, threw the copy away
```

It compares against the live count rather than a number written here, because
a hardcoded 23 would pass a restore of last month's schema.

**A drill that cannot verify is a failing finding on the backup, not on the
drill.** The exit code and the message both say so:

```
  ✗ the latest backup did not restore.
    That is a finding on the backup, not on the drill.

    no backup object under pg_dump/ in fountain-backups
```

## What a restore does not give you back

The drill also says what it did not prove: the restored rows are ciphertext.
Every tenant's inference credentials are encrypted AES-256-GCM under
`MASTER_SECRETS_KEY`, so a full database restore decrypts nothing without the
same key the dump was written under. Losing the key is equivalent to losing
the data, and on a real deployment losing the cluster loses the key —
[Secrets](/fountain-ops/reference/secrets/) has the full warning and how to
get a copy out.

## `barman-pitr` applies, nothing has run through it

`backups=barman-pitr` declares a CNPG `ObjectStore` and a `ScheduledBackup`
against the barman-cloud plugin, and requires `postgres=cnpg` — a WAL archive
with nothing archiving into it is refused at build time. After `just
operators` the manifests apply and the plugin is running, but **no backup has
been taken or restored through it**. [Status](/fountain-ops/status/) is
authoritative on that.

Its schedule is `pitrSchedule`, deliberately a separate parameter from
`backupSchedule`: CNPG cron is six fields, leading with seconds, and
Kubernetes `CronJob` takes five. Both dialects are accepted by the cluster and
mean different times. [Seams](/fountain-ops/reference/seams/#the-cron-field-count)
explains what the build refuses and why.

## What CI asserts

`just e2e` takes a backup and restores it: `just backup-now`, wait for the job,
then `just restore-drill`, which fails the run if the newest object does not
come back with a table count matching live. It is one of the gates listed in
[CI and the site](/fountain-ops/reference/ci/).
