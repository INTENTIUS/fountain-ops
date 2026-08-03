# fountain-ops

Self-hosted [fountain](https://github.com/BinaryBourbon/fountain), deployed by [chant](https://github.com/INTENTIUS/chant).

Two axes decide what this emits:

- **tier** — how much fountain you are running
- **seams** — who provides each dependency

Nothing here is a template you fill in. `chant build` emits the manifests, `chant lint` gates them, and the same source targets a laptop k3d cluster or a real one by changing parameters.

## Quick start

```bash
npm install

# what a laptop gets: one replica, your own Postgres, plain Ingress
chant build src -o dist/fountain.yaml --format yaml
kubectl apply -f dist/fountain.yaml
```

The Secret is **not** declared here and never will be. Create it out of band:

```bash
kubectl create secret generic fountain-secrets -n fountain \
  --from-literal=SECRET_KEY_BASE="$(openssl rand -base64 48 | tr -d '\n')" \
  --from-literal=MASTER_SECRETS_KEY="$(openssl rand 32 | base64 | tr '+/' '-_' | tr -d '=\n')" \
  --from-literal=DATABASE_URL="postgres://user:pass@your-postgres:5432/fountain" \
  --from-literal=SPRITES_TOKEN="your-sprites-token"
```

`MASTER_SECRETS_KEY` encrypts every stored secret. Lose it and they are unrecoverable, so back it up somewhere that is not this cluster. A database backup alone cannot decrypt itself.

## Tiers

| Tier | Replicas | What you get |
|---|---|---|
| `light` | 1 | Bring your own Postgres. No backups, no metrics. |
| `production` | 1 | Backups, metrics, TLS. |
| `production-ha` | 2+ | Erlang clustering, WAL archiving. |

The replica count is not a free knob. Above one replica fountain's pods must form a real Erlang cluster — headless Service, `RELEASE_NODE`, a pinned distribution port — or they run as isolated islands and conversation streaming breaks for whichever pod did not spawn the conversation. It fails quietly, under load, for some users. So the tier carries the wiring, and `--param tier=light --param replicas=2` is a build error rather than a broken cluster.

## Seams

Every seam has a mode that works with the k8s lexicon as it ships today.

| Seam | Modes | Default |
|---|---|---|
| `postgres` | `reference` · `cnpg`* | `reference` |
| `secrets` | `reference` · `infisical`* | `reference` |
| `ingress` | `omit` · `ingress` · `traefik`* | `ingress` |
| `tls` | `omit` · `cert-manager` | `omit` |
| `backups` | `omit` · `pg-dump` · `barman-pitr`* | `omit` |
| `monitoring` | `omit` · `prometheus-operator` | `omit` |

\* needs a CRD chant does not generate yet. Asking for one is a build error naming the issue that lands it — [#1319](https://github.com/INTENTIUS/chant/issues/1319) CNPG, [#1320](https://github.com/INTENTIUS/chant/issues/1320) Traefik, [#1321](https://github.com/INTENTIUS/chant/issues/1321) Infisical.

Refusing beats emitting. An IngressRoute assembled by hand as an untyped blob would build green and fail at the cluster, which is the failure mode chant exists to remove.

```bash
# a real deployment, once the operators are installed
chant build src --format yaml \
  --param tier=production \
  --param host=fountain.example.com \
  --param scheme=https \
  --param tls=cert-manager \
  --param monitoring=prometheus-operator
```

## Why host and scheme, not a URL

`PUBLIC_URL` is derived from `host` + `scheme`, not declared whole. The host on its own is what the ingress rule and the certificate SAN need, and splitting a URL back apart in source is a function call, which nothing can fold.

`scheme=https` is not cosmetic: it turns on fountain's HTTPS redirect, HSTS and secure cookies, so whatever terminates TLS **must** set `X-Forwarded-Proto` or every request looks like http and redirect-loops.

## Probes

Read the comment in `src/app/deployment.ts` before changing them. Liveness deliberately checks only the process — pointing it at the database restarts every pod at once during a Postgres blip, which does nothing to fix Postgres.

## Layout

```
chant.config.ts        lexicons, params, ownership, lint
src/
  params.ts            the one place build params are read
  lib/tiers.ts         tier -> shape, and the replica refusal
  lib/seams.ts         seam validation and the CRD refusals
  app/                 Deployment, Service, Namespace, headless Service
  ingress/             Ingress, Certificate
  observability/       ServiceMonitor, PrometheusRule
ops/                   deploy / watch / reconcile
```

Nothing reads `process.env`. Every input is a declared build parameter, so the same source produces the same manifests given the same parameters.
