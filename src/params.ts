/**
 * The one place build-time parameters are read.
 *
 * Nothing in this project reads `process.env` — an ambient read depends on
 * whatever process happens to be running the build, which is exactly what
 * chant's fold engine cannot reduce to a value. Everything here is declared in
 * ../chant.config.ts's `buildParams` and supplied with `--param` /
 * `--params-file`, or the env mapping the declaration opts into.
 *
 * The `?? default` on each line mirrors the declared default. Redundant under
 * a real `chant build`, and a real safety net for anything importing this
 * outside the build pipeline (a unit test, a script) where `params` is still
 * its initial empty object.
 */

import { params } from "@intentius/chant/params";
import { resolveTier, type Tier } from "./lib/tiers";
import { resolveSeams, type Seams } from "./lib/seams";

export const env = (params.env as string | undefined) ?? "dev";
export const namespace = (params.namespace as string | undefined) ?? "fountain";
export const image = (params.image as string | undefined) ?? "ghcr.io/binarybourbon/fountain:v0.3.0";

/** The externally-visible host — the ingress rule and the certificate SAN. */
export const host = (params.host as string | undefined) ?? "localhost:4000";
export const scheme = (params.scheme as string | undefined) ?? "http";

/** Derived, not declared — see chant.config.ts for why this direction. */
export const publicUrl = `${scheme}://${host}`;

/** https is what turns on fountain's redirect, HSTS and secure cookies. */
export const httpsPublicUrl = scheme === "https";

export const tier = resolveTier(
  (params.tier as Tier | undefined) ?? "light",
  params.replicas as number | undefined,
);

export const seams: Seams = resolveSeams({
  postgres: (params.postgres as Seams["postgres"] | undefined) ?? "reference",
  secrets: (params.secrets as Seams["secrets"] | undefined) ?? "reference",
  ingress: (params.ingress as Seams["ingress"] | undefined) ?? "ingress",
  tls: (params.tls as Seams["tls"] | undefined) ?? "omit",
  backups: (params.backups as Seams["backups"] | undefined) ?? "omit",
  monitoring: (params.monitoring as Seams["monitoring"] | undefined) ?? "omit",
});

// ── seam inputs ────────────────────────────────────────────────────────────
export const secretName = (params.secretName as string | undefined) ?? "fountain-secrets";
export const clusterIssuer = (params.clusterIssuer as string | undefined) ?? "letsencrypt-production";
export const ingressClassName = params.ingressClassName as string | undefined;
export const pgStorageClass = params.pgStorageClass as string | undefined;
export const pgStorageSize = (params.pgStorageSize as string | undefined) ?? "10Gi";
export const backupSchedule = (params.backupSchedule as string | undefined) ?? "17 3 * * *";
export const backupRetentionDays = (params.backupRetentionDays as number | undefined) ?? 14;
export const backupBucket = params.backupBucket as string | undefined;
export const backupS3Endpoint = params.backupS3Endpoint as string | undefined;

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
