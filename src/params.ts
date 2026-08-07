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
import { resolveTier, sizeShape, defaultSize, type Tier, type Size } from "./lib/tiers";
import { targetShape, type Target } from "./lib/targets";
import { resolveSeams, assertSixFieldSchedule, assertIngressClass, type Seams } from "./lib/seams";

export const env = (params.env as string | undefined) ?? "dev";
export const namespace = (params.namespace as string | undefined) ?? "fountain";
export const image = (params.image as string | undefined) ?? "ghcr.io/binarybourbon/fountain:v0.6.1";

/**
 * The externally-visible authority, port included where there is one.
 *
 * This is the value PUBLIC_URL is built from, and the only one of the two that
 * wants a port. Everything that needs a *hostname* uses `hostname` below.
 */
export const host = (params.host as string | undefined) ?? "localhost:4000";
export const scheme = (params.scheme as string | undefined) ?? "http";

/** Derived, not declared — splitting a URL apart in source is a call nothing folds. */
export const publicUrl = `${scheme}://${host}`;

/**
 * The same value with any port removed.
 *
 * `host` means two things and only one of them takes a port. PHX_HOST is
 * Phoenix's `url: [host: ...]`, an Ingress rule's `host` and a Certificate's
 * `dnsNames` are all hostnames, and a port in any of them is wrong — Phoenix
 * says so on every boot, and a SAN with a port in it is not a SAN.
 *
 * It was invisible for a while because the default target omits ingress
 * entirely, so only PHX_HOST was actually wrong, and it was wrong on every
 * local deployment. A `:` in a hostname is asserted against in the tests.
 */
export const hostname = host.split(":")[0];

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
 * How much of the machine to ask for. Orthogonal to the tier, which is the
 * whole point of it existing — it used to be half of what a tier meant, and a
 * bigger single pod is not a more durable one.
 *
 * Defaults to what the tier would have carried, so nothing shrank when the
 * middle tier went away.
 */
export const sizeName = (params.size as Size | undefined) ?? defaultSize(tierName);
export const size = sizeShape(sizeName);

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
    dataPlane: params.dataPlane as Seams["dataPlane"] | undefined,
    storage: params.storage as Seams["storage"] | undefined,
  },
  tier.clustered,
);

// ── seam inputs ────────────────────────────────────────────────────────────
export const secretName = (params.secretName as string | undefined) ?? "fountain-secrets";
/** "none" is a deliberate answer, not a missing one — fountain will not boot without it. */
export const emailDelivery = (params.emailDelivery as string | undefined) ?? "none";
/**
 * Trace export, off by default.
 *
 * On v0.3.0 this was a load-bearing workaround: the runtime config hardcoded
 * `traces_exporter: :otlp` with api.honeycomb.io as the default endpoint, so
 * an instance that had never heard of Honeycomb retried a 401 against it every
 * five seconds for the life of the pod — twelve lines a minute in `just logs`,
 * on top of whatever signal someone was actually there for. v0.4.0 fixed that
 * upstream (BinaryBourbon/fountain#317): export is off unless an export target
 * is configured. So this is now an explicit statement of the same default,
 * kept because "off" being visible in the pod spec is worth one line — and
 * because the param is how an operator switches it on.
 *
 * "otlp" hands it back to the standard OTEL_EXPORTER_OTLP_* variables, which
 * are the operator's to supply; this repo does not model them.
 */
export const otelTraces = (params.otelTraces as string | undefined) ?? "none";
/**
 * Whether the database connection requires TLS.
 *
 * Derived by default and settable, which it was not: the bundled Postgres
 * serves no TLS so it must be false there, and everything else was *assumed*
 * to. A referenced Postgres that does not serve TLS then crashloops on boot
 * with
 *
 *   (Postgrex.Error) ssl not available
 *
 * and no parameter could say otherwise. "Anything you did not create serves
 * TLS" is true of a managed cloud database and false of the perfectly ordinary
 * case of an in-cluster Postgres somebody else operates — which is exactly what
 * `reference` is for.
 *
 * CNPG serves TLS, so it keeps the same default as before.
 */
export const databaseSsl =
  (params.databaseSsl as string | undefined) ?? (seams.postgres === "bundled" ? "false" : "true");

export const registrationEnabled = (params.registrationEnabled as string | undefined) ?? "true";
/**
 * Upstream's in-app first-admin bootstrap (fountain ADR 0011, in releases
 * after v0.4.0; earlier images ignore the variable): while the instance has
 * no admin, the first account to become verified is promoted, audit-recorded.
 * On by default here for the same reason upstream's compose file defaults it
 * on — this repo stands up single-operator instances, and the operator
 * registering first *is* the first login. Set "false" to keep the manual
 * `just promote-admin` path instead.
 */
export const firstUserAdmin = (params.firstUserAdmin as string | undefined) ?? "true";
export const clusterIssuer = (params.clusterIssuer as string | undefined) ?? "letsencrypt-production";
export const ingressClassName = params.ingressClassName as string | undefined;
assertIngressClass(seams, ingressClassName);
export const pgStorageSize = (params.pgStorageSize as string | undefined) ?? "10Gi";
export const pgImage = (params.pgImage as string | undefined) ?? "postgres:16";
export const backupSchedule = (params.backupSchedule as string | undefined) ?? "17 3 * * *";
/** Retention comes from the tier — it is durability, not a seam input. */
export const backupRetentionDays = (params.backupRetentionDays as number | undefined) ?? tier.retentionDays;
export const backupBucket = (params.backupBucket as string | undefined) ?? "fountain-backups";
/**
 * Where the backup job uploads.
 *
 * Explicit wins; otherwise the storage seam decides. Unset means the AWS
 * default endpoint, which is what `storage="s3"` against a real bucket wants.
 *
 * It is deliberately NOT a target property any more. It used to default to
 * `http://localhost:4566` on k3d to match a floci on the host, which from
 * inside a pod is the pod — an endpoint that could never have worked from the
 * one place that uses it.
 */
export const backupS3Endpoint =
  (params.backupS3Endpoint as string | undefined) ??
  (seams.storage === "floci"
    ? `http://fountain-floci.${namespace}.svc.cluster.local:4566`
    : undefined);

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

// ── storage seam ───────────────────────────────────────────────────────────
/** Pinned for the same reason spritzer is: it decides what a green run means. */
export const flociImage = (params.flociImage as string | undefined) ?? "floci/floci:1.5.34";

// ── data plane seam ────────────────────────────────────────────────────────
/**
 * Pinned, not `latest`. The emulator decides what a local conversation does,
 * so a floating tag would change the meaning of a green run without anything
 * in this repo changing.
 */
export const spritzerImage =
  (params.spritzerImage as string | undefined) ?? "ghcr.io/intentius/spritzer:0.5.0";

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

/** The emulated bucket — its own component, its own selector. */
export const flociLabels = {
  "app.kubernetes.io/name": "fountain",
  "app.kubernetes.io/instance": env,
  "app.kubernetes.io/component": "floci",
};

/** The emulated data plane, likewise — its own component, its own selector. */
export const spritzerLabels = {
  "app.kubernetes.io/name": "fountain",
  "app.kubernetes.io/instance": env,
  "app.kubernetes.io/component": "spritzer",
};

/** The bundled Postgres gets its own identity so selectors do not collide. */
export const pgLabels = {
  "app.kubernetes.io/name": "fountain",
  "app.kubernetes.io/instance": env,
  "app.kubernetes.io/component": "postgres",
};
