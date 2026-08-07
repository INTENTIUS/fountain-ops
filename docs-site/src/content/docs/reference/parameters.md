---
title: Build parameters
description: Every parameter this repo declares, its default including the ones that differ per target, and the handful that refuse each other.
---

Every input is a declared build parameter. No resource file reads
`process.env`, so the same parameters produce the same resources, and
`src/params.ts` is the one place any of them is read.

```bash
just params="--param postgres=cnpg --param size=large" up
npx chant build src --param target=kubernetes --param ingressClassName=nginx
```

`just up` is a chain of targets and `just` does not thread arguments through
dependencies, which is why the `params` variable exists rather than trailing
flags.

## Identity and the app

| Parameter | Values | Default | Note |
|---|---|---|---|
| `env` | any string | `dev` | The `app.kubernetes.io/instance` label on every resource. Also reads `FOUNTAIN_ENV` — see below |
| `namespace` | any string | `fountain` | |
| `image` | an image reference | `ghcr.io/binarybourbon/fountain:v0.6.0` | Pinned, not a floating tag |
| `host` | authority, port allowed | `localhost:4000` | `PUBLIC_URL` is `scheme://host`. Any port is stripped for `PHX_HOST`, the Ingress rule and certificate SANs |
| `scheme` | `http` · `https` | `http` | `https` turns on fountain's redirect, HSTS and secure cookies, so whatever terminates TLS must set `X-Forwarded-Proto` |
| `emailDelivery` | `none` · `resend` · `smtp` | `none` | fountain does not boot without a mail decision; `none` is a decision with two edges — see below |
| `registrationEnabled` | `true` · `false` | `true` | Sets `REGISTRATION_ENABLED` |
| `firstUserAdmin` | `true` · `false` | `true` | Sets `FIRST_USER_ADMIN` (fountain ADR 0011): the first verified account on an instance with no admin is promoted, audit-recorded. Ignored by images ≤ v0.4.0. `false` keeps [the manual path](/fountain-ops/reference/promote-admin/) |
| `databaseSsl` | `true` · `false` | derived from the `postgres` seam | `false` for `bundled`, `true` otherwise — see below |
| `otelTraces` | `none` · `otlp` | `none` | `otlp` hands export back to the standard `OTEL_EXPORTER_OTLP_*` variables, which this repo does not model |

## The axes

`target` is where the substrate runs, `tier` is how durable it is, `size` is
how much of the machine it asks for. Separate questions, and not a free grid:
[Targets and tiers](/fountain-ops/reference/targets-and-tiers/) has which
combinations are refused and why.

| Parameter | Values | Default | Note |
|---|---|---|---|
| `target` | `k3d` · `kubernetes` | `k3d` | Picks the seam defaults coherent on that substrate and nothing else. Also reads `FOUNTAIN_TARGET` |
| `tier` | `light` · `ha` | `light` | Replica count, Erlang clustering and backup retention. Also reads `FOUNTAIN_TIER` |
| `replicas` | integer ≥ 1 | the tier's — `1` at `light`, `2` at `ha` | Above one replica at `light` is a build error: the pods must form a cluster or conversation streaming breaks |
| `size` | `small` · `medium` · `large` | `small` at `light`, `large` at `ha` | CPU and memory requests and limits. Changes no shape and refuses no combination |

## Seams

Seams start from the target's defaults; setting one replaces exactly that seam
and leaves the rest alone. The modes themselves, and the reasoning behind each
refusal, are on [Seams](/fountain-ops/reference/seams/).

| Parameter | Values | `k3d` | `kubernetes` | Refuses |
|---|---|---|---|---|
| `postgres` | `reference` · `bundled` · `cnpg` | `bundled` | `reference` | `bundled` at `tier=ha` |
| `secrets` | `reference` · `sops` · `infisical` | `reference` | `reference` | — |
| `ingress` | `omit` · `ingress` · `traefik` | `omit` | `ingress` | `ingress` without `ingressClassName` |
| `tls` | `omit` · `cert-manager` | `omit` | `omit` | `cert-manager` with `ingress=omit` |
| `backups` | `omit` · `pg-dump` · `barman-pitr` | `pg-dump` | `omit` | `barman-pitr` without `postgres=cnpg`; `omit` with `storage=floci` |
| `monitoring` | `omit` · `prometheus-operator` | `omit` | `omit` | — |
| `dataPlane` | `sprites` · `spritzer` | `spritzer` | `sprites` | `spritzer` at `tier=ha` |
| `storage` | `s3` · `floci` | `floci` | `s3` | `floci` at `tier=ha`; `floci` with `backups=omit` |

Which of those refusals fire on the default seams of each target is asserted in
`test/tiers-and-seams.test.ts`, so a seam change that shifts the answer fails a
build rather than making this table quietly wrong.

`monitoring=prometheus-operator`, `ingress=traefik` and `secrets=infisical`
build and a real API server accepts the output, but no controller has
reconciled any of them. [Status](/fountain-ops/status/) is the authority on
what has actually run.

## Seam inputs

| Parameter | Values | Default | Note |
|---|---|---|---|
| `secretName` | any string | `fountain-secrets` | The Secret the app reads its environment from, whatever produced it |
| `pgStorageSize` | a quantity | `10Gi` | The volume for `postgres=bundled` and `postgres=cnpg` |
| `pgImage` | an image reference | `postgres:16` | The bundled Postgres, and the client the app's readiness wait uses |
| `pgStorageClass` | any string | unset | Unset means the cluster's default StorageClass, which is right on k3d. `postgres=cnpg` |
| `cnpgImage` | an image reference | `ghcr.io/cloudnative-pg/postgresql:16.4` | `postgres=cnpg` |
| `clusterIssuer` | any string | `letsencrypt-production` | The `ClusterIssuer` the Certificate references. `tls=cert-manager` |
| `ingressClassName` | any string | unset | Required when `ingress=ingress`; an Ingress with no class is claimed by no controller and applies cleanly anyway |
| `traefikMiddlewareNamespace` | any string | the deployment's `namespace` | Where the HTTPS-redirect middleware lives. `ingress=traefik` |
| `backupSchedule` | five-field cron | `17 3 * * *` | The `pg_dump` CronJob. `backups=pg-dump` |
| `pitrSchedule` | **six**-field cron | `0 47 2 * * *` | The CNPG base backup. A five-field value is refused — see below |
| `backupRetentionDays` | integer | the tier's — `7` at `light`, `30` at `ha` | Retention is durability, so it comes from the tier rather than the seam |
| `backupBucket` | any string | `fountain-backups` | |
| `backupSecretName` | any string | `fountain-backup-s3-credentials` | The S3 credentials the backup path reads |
| `backupS3Endpoint` | a URL | floci's in-cluster Service when `storage=floci`, otherwise unset | Unset means the AWS default endpoint — see below |
| `flociImage` | an image reference | `floci/floci:1.5.34` | Pinned. `storage=floci` |
| `spritzerImage` | an image reference | `ghcr.io/intentius/spritzer:0.4.1` | Pinned, because the emulator decides what a local conversation does. `dataPlane=spritzer` |

### Infisical

All seven apply only at `secrets=infisical`.

| Parameter | Values | Default | Note |
|---|---|---|---|
| `infisicalHostApi` | a URL | `http://infisical.infisical.svc.cluster.local:8080` | |
| `infisicalProjectSlug` | any string | empty | Nothing refuses an empty value |
| `infisicalIdentityId` | any string | empty | Nothing refuses an empty value |
| `infisicalEnvSlug` | any string | `prod` | |
| `infisicalSecretsPath` | any string | `/` | |
| `infisicalServiceAccount` | any string | `fountain-infisical` | The ServiceAccount the operator authenticates as |
| `infisicalResyncSeconds` | integer | `60` | |

## `emailDelivery=none` is a decision with two edges

Under `none` the app **self-verifies accounts at registration** (fountain ADR
0011): a verification link that can never be delivered gates nothing, so the
app stopped pretending otherwise. The other edge is that password-reset mail
cannot be delivered either — a forgotten password is not recoverable in-app.
For an instance whose accounts matter, configure real mail
(`emailDelivery=resend|smtp`) or prefer OAuth sign-in.

## `databaseSsl` is derived, and settable

Unset, it follows the `postgres` seam: `false` for `bundled`, which serves no
TLS, and `true` for everything else. That default is right for a managed cloud
database and wrong for a Postgres somebody else operates in your cluster, which
is exactly the case `postgres=reference` exists for. Against one of those the
app crashloops with `(Postgrex.Error) ssl not available`, so `--param
databaseSsl=false` is how you say otherwise.
[Targets and tiers](/fountain-ops/reference/targets-and-tiers/) has the longer
version.

## `pitrSchedule` and `backupSchedule` are different dialects

CNPG cron is six fields, leading with seconds. A Kubernetes `CronJob` takes
five. Both are accepted by the cluster and mean different times, so the two
schedules are separate parameters and `pitrSchedule` is checked for its field
count at build time. `47 2 * * *` reads as 02:47 to every other cron and as
second 47 of every minute 2 to CNPG — 24 base backups a day, with no error
anywhere. The check and its message are on
[Seams](/fountain-ops/reference/seams/).

## `backupS3Endpoint` resolves from inside a pod

The only thing that reads it is the upload container, so the endpoint has to
resolve from the cluster. At `storage=floci` it defaults to floci's Service
name, which does. A laptop-style `http://localhost:4566` leaves the container
talking to itself: inside a pod, `localhost` is the pod. Unset at
`storage=s3` means the AWS default endpoint, which is what a real bucket wants;
point it at R2 or Garage to use one of those instead.

## `env` and `FOUNTAIN_ENV` have to agree

`env` labels the resources. `chant.config.ts` reads `FOUNTAIN_ENV` from the
process for `ownership.env`, because ownership is resolved when the config
loads and build parameters do not exist yet at that point. So `--param
env=prod` labels resources `prod` while the ownership marker still says `dev`
unless `FOUNTAIN_ENV` says `prod` too. Set both or neither.
[INTENTIUS/chant#1396](https://github.com/INTENTIUS/chant/issues/1396) tracks
it. The justfile exports `FOUNTAIN_ENV=local`, so a local deploy is labelled,
owned and bound under one name.

`target` and `tier` take the same treatment through `FOUNTAIN_TARGET` and
`FOUNTAIN_TIER`, but those are ordinary parameter env mappings with nothing
reading them behind the build's back.

## `otelTraces` is off, and says so

`none` is the default and the emitted value. fountain v0.4.0 exports traces
only when an export target is configured, so this is an explicit statement of
what would happen anyway — kept because "off" being visible in the pod spec is
worth one line, and because the parameter is how an operator turns export on.

Setting `otlp` hands the decision back to `OTEL_EXPORTER_OTLP_ENDPOINT` and
`OTEL_EXPORTER_OTLP_HEADERS`, which are yours to supply; nothing here models
them.
