/**
 * The one place build-time parameters are read.
 *
 * Nothing in this project reads `process.env`. Everything here is declared in
 * ../chant.config.ts's `buildParams` and supplied with `--param` /
 * `--params-file`, or the env mapping the declaration opts into.
 *
 * The `?? default` on each line mirrors the declared default — redundant under
 * a real `chant build`, and a safety net for anything importing this outside
 * the build pipeline (a unit test, a script) where `params` is still empty.
 */

import { params } from "@intentius/chant/params";
import { resolveTier, type Tier } from "./lib/tiers";
import { targetShape, type Target } from "./lib/targets";
import { resolveSeams, assertSixFieldSchedule, type Seams } from "./lib/seams";

export const env = (params.env as string | undefined) ?? "dev";
export const namespace = (params.namespace as string | undefined) ?? "fountain";
export const image = (params.image as string | undefined) ?? "ghcr.io/binarybourbon/fountain:v0.3.0";

/** The externally-visible host — the ingress rule and the certificate SAN. */
export const host = (params.host as string | undefined) ?? "localhost:4000";
export const scheme = (params.scheme as string | undefined) ?? "http";

/** Derived, not declared — splitting a URL apart in source is a call nothing folds. */
export const publicUrl = `${scheme}://${host}`;

/** https is what turns on fountain's redirect, HSTS and secure cookies. */
export const httpsPublicUrl = scheme === "https";

// ── the two axes ───────────────────────────────────────────────────────────
// target = where the substrate runs. tier = how durable it is. Separate
// questions, but not every pair builds — resolveSeams refuses the ones whose
// merged seams are incoherent. See lib/targets.ts.
export const targetName = (params.target as Target | undefined) ?? "k3d";
export const target = targetShape(targetName);
export const tierName = (params.tier as Tier | undefined) ?? "light";
export const tier = resolveTier(tierName, params.replicas as number | undefined);

/**
 * Seams start from the target's defaults — what is coherent on that substrate —
 * and an explicit choice replaces exactly one, leaving the rest alone.
 */
export const seams: Seams = resolveSeams(
  target.seams,
  {
    postgres: params.postgres as Seams["postgres"] | undefined,
    secrets: params.secrets as Seams["secrets"] | undefined,
    ingress: params.ingress as Seams["ingress"] | undefined,
    tls: params.tls as Seams["tls"] | undefined,
    backups: params.backups as Seams["backups"] | undefined,
    monitoring: params.monitoring as Seams["monitoring"] | undefined,
  },
  tier.clustered,
);

// ── seam inputs ────────────────────────────────────────────────────────────
export const secretName = (params.secretName as string | undefined) ?? "fountain-secrets";
/** "none" is a deliberate answer, not a missing one — fountain will not boot without it. */
export const emailDelivery = (params.emailDelivery as string | undefined) ?? "none";
export const registrationEnabled = (params.registrationEnabled as string | undefined) ?? "true";
export const clusterIssuer = (params.clusterIssuer as string | undefined) ?? "letsencrypt-production";
export const ingressClassName = params.ingressClassName as string | undefined;
export const pgStorageSize = (params.pgStorageSize as string | undefined) ?? "10Gi";
export const pgImage = (params.pgImage as string | undefined) ?? "postgres:16";
export const backupSchedule = (params.backupSchedule as string | undefined) ?? "17 3 * * *";
/** Retention comes from the tier — it is durability, not a seam input. */
export const backupRetentionDays = (params.backupRetentionDays as number | undefined) ?? tier.retentionDays;
export const backupBucket = (params.backupBucket as string | undefined) ?? "fountain-backups";
export const backupS3Endpoint = (params.backupS3Endpoint as string | undefined) ?? target.s3Endpoint;

// ── cnpg seam ──────────────────────────────────────────────────────────────
export const cnpgImage =
  (params.cnpgImage as string | undefined) ?? "ghcr.io/cloudnative-pg/postgresql:16.4";
/** undefined means the cluster's default StorageClass, which is right on k3d. */
export const pgStorageClass = params.pgStorageClass as string | undefined;
export const backupSecretName =
  (params.backupSecretName as string | undefined) ?? "fountain-backup-s3-credentials";
/**
 * The CNPG base-backup schedule. Deliberately NOT `backupSchedule`.
 *
 * CNPG cron is six fields, leading with seconds; the pg_dump CronJob above
 * takes the five Kubernetes uses. Sharing one parameter would mean whichever
 * seam was off got a schedule in the wrong dialect the moment it was switched
 * on — accepted by both, meaning something different in each.
 */
export const pitrSchedule = (params.pitrSchedule as string | undefined) ?? "0 47 2 * * *";
assertSixFieldSchedule(pitrSchedule);

// ── traefik seam ───────────────────────────────────────────────────────────
/** Where the redirect middleware lives. Same namespace unless told otherwise. */
export const traefikMiddlewareNamespace =
  (params.traefikMiddlewareNamespace as string | undefined) ?? namespace;

// ── infisical seam ─────────────────────────────────────────────────────────
export const infisicalHostApi =
  (params.infisicalHostApi as string | undefined) ?? "http://infisical.infisical.svc.cluster.local:8080";
export const infisicalIdentityId = (params.infisicalIdentityId as string | undefined) ?? "";
export const infisicalProjectSlug = (params.infisicalProjectSlug as string | undefined) ?? "";
export const infisicalEnvSlug = (params.infisicalEnvSlug as string | undefined) ?? "prod";
export const infisicalSecretsPath = (params.infisicalSecretsPath as string | undefined) ?? "/";
export const infisicalServiceAccount =
  (params.infisicalServiceAccount as string | undefined) ?? "fountain-infisical";
export const infisicalResyncSeconds = (params.infisicalResyncSeconds as number | undefined) ?? 60;

/** Labels every resource carries, so a human and `--owned` agree on what this is. */
export const labels = {
  "app.kubernetes.io/name": "fountain",
  "app.kubernetes.io/instance": env,
  "app.kubernetes.io/component": "server",
};

/**
 * The Service carries one extra label so the ServiceMonitor can select on it
 * and never bind a target with no metrics port. Composed here, where `labels`
 * is a local const — spreading an imported binding is EVL004.
 */
export const serviceLabels = { ...labels, monitoring: "fountain-web" };

/** The bundled Postgres gets its own identity so selectors do not collide. */
export const pgLabels = {
  "app.kubernetes.io/name": "fountain",
  "app.kubernetes.io/instance": env,
  "app.kubernetes.io/component": "postgres",
};
