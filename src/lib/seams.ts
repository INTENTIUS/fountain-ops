/**
 * Seams — who provides each dependency.
 *
 * Every mode here is expressible: the k8s lexicon generates the CNPG, Traefik
 * and Infisical CRDs, so nothing is refused for being ungeneratable any more.
 *
 * What is still refused is incoherence — combinations that would build green
 * and mean something other than they say. Those checks live at the bottom of
 * resolveSeams, and each one is a failure that is invisible on the cluster:
 * a "highly available" single Postgres, a WAL archive with no cluster
 * archiving into it, a certificate nothing terminates.
 */

export type PostgresMode = "reference" | "bundled" | "cnpg";
export type SecretsMode = "reference" | "infisical";
export type IngressMode = "omit" | "ingress" | "traefik";
export type TlsMode = "omit" | "cert-manager";
export type BackupsMode = "omit" | "pg-dump" | "barman-pitr";
export type MonitoringMode = "omit" | "prometheus-operator";
/**
 * Where fountain's sandboxes come from.
 *
 * `sprites` is the real Fly Sprites API. `spritzer` is an emulator of it that
 * runs in the cluster, so the seam is a base URL and a token and nothing else
 * — fountain cannot tell the difference, which is the whole reason a local
 * deployment exercises the real control-plane path instead of a stub.
 *
 * What it is not is an agent runtime. See src/data/spritzer.ts.
 */
export type DataPlaneMode = "sprites" | "spritzer";
/**
 * Where the backup seam uploads to.
 *
 * `s3` is any real S3-compatible bucket — S3, R2, Garage — reached at whatever
 * `backupS3Endpoint` says, or AWS's own if that is unset. `floci` is an
 * emulator of it running in the cluster, so the backup path is exercised for
 * real against an emulated bucket rather than being the part nobody runs until
 * a restore.
 *
 * The seam is an endpoint and a bucket, which is the whole reason it can be
 * emulated: the CronJob is the same either way and cannot tell.
 */
export type StorageMode = "s3" | "floci";

export interface Seams {
  postgres: PostgresMode;
  secrets: SecretsMode;
  ingress: IngressMode;
  tls: TlsMode;
  backups: BackupsMode;
  monitoring: MonitoringMode;
  dataPlane: DataPlaneMode;
  storage: StorageMode;
}

/** Explicit seam choices — anything left undefined falls to the tier's default. */
export interface SeamOverrides {
  postgres?: PostgresMode;
  secrets?: SecretsMode;
  ingress?: IngressMode;
  tls?: TlsMode;
  backups?: BackupsMode;
  monitoring?: MonitoringMode;
  dataPlane?: DataPlaneMode;
  storage?: StorageMode;
}

/**
 * Layer explicit choices over the tier's defaults, then validate the result.
 *
 * The tier picks a coherent starting point; an override replaces exactly one
 * seam and leaves the rest alone. Validation runs on the merged set, so an
 * override that breaks a combination is caught the same as an authored one.
 */
export function resolveSeams(defaults: Seams, over: SeamOverrides = {}, ha = false): Seams {
  const s: Seams = {
    postgres: over.postgres ?? defaults.postgres,
    secrets: over.secrets ?? defaults.secrets,
    ingress: over.ingress ?? defaults.ingress,
    tls: over.tls ?? defaults.tls,
    backups: over.backups ?? defaults.backups,
    monitoring: over.monitoring ?? defaults.monitoring,
    dataPlane: over.dataPlane ?? defaults.dataPlane,
    storage: over.storage ?? defaults.storage,
  };

  // A bundled Postgres is a single pod with a volume. Saying "highly available"
  // about it would be a lie the tier cannot make true, so refuse rather than
  // emit something that looks redundant and is not.
  if (s.postgres === "bundled" && ha) {
    throw new Error(
      `postgres="bundled" is a single instance and cannot back an "ha" deployment — ` +
        `use postgres="cnpg" for a replicated database, or a managed one with postgres="reference".`,
    );
  }

  // spritzer keeps every sprite, filesystem and checkpoint in memory in one
  // pod. Calling that arrangement "highly available" is the same lie as a
  // single Postgres backing an "ha" deployment: it applies cleanly, and the
  // first pod restart takes every running sandbox with it.
  if (s.dataPlane === "spritzer" && ha) {
    throw new Error(
      `dataPlane="spritzer" is an in-memory emulator in a single pod and cannot back an "ha" deployment — ` +
        `use dataPlane="sprites" with a real SPRITES_TOKEN, or a non-ha tier for local work.`,
    );
  }

  // floci keeps its buckets in one pod with no volume, so a restart loses every
  // backup in it. Calling that the backup destination for an "ha" deployment is
  // the same lie as the two above: it applies cleanly, and the thing you would
  // reach for in an outage is gone.
  if (s.storage === "floci" && ha) {
    throw new Error(
      `storage="floci" is an in-cluster emulator whose buckets do not survive a restart, and cannot hold the backups of an "ha" deployment — ` +
        `use storage="s3" with a real bucket, or a non-ha tier for local work.`,
    );
  }

  // A backup that uploads nowhere is not a backup. floci is a destination;
  // "omit" backups with floci on would emit an emulator nothing writes to.
  if (s.storage === "floci" && s.backups === "omit") {
    throw new Error(
      `storage="floci" with backups="omit" emits an emulator nothing uploads to — ` +
        `set backups="pg-dump" (or "barman-pitr" with postgres="cnpg"), or storage="s3".`,
    );
  }

  // PITR is a CNPG feature — it archives WAL from the cluster the operator
  // runs. There is nothing to archive from a Postgres chant does not manage.
  if (s.backups === "barman-pitr" && s.postgres !== "cnpg") {
    throw new Error(
      `backups="barman-pitr" needs postgres="cnpg" — WAL archiving is a property of the CNPG cluster. ` +
        `For an external Postgres use backups="pg-dump", which dumps over the connection string.`,
    );
  }

  // A certificate with nothing terminating TLS is an unused Secret and a
  // misleading one: it looks like the deployment serves HTTPS.
  if (s.tls === "cert-manager" && s.ingress === "omit") {
    throw new Error(`tls="cert-manager" needs an ingress to terminate it — set ingress="ingress" or "traefik", or tls="omit".`);
  }

  return s;
}

/** True when the app's DATABASE_URL comes from a cluster chant declares. */
export function postgresIsManaged(s: Seams): boolean {
  return s.postgres === "cnpg";
}

/**
 * CNPG schedules are six fields, leading with seconds. Kubernetes CronJob
 * takes five.
 *
 * Nothing else catches this. The CRD types the field as a plain string, the
 * cluster accepts either, and the five-field form written out of habit means
 * something entirely different: "47 2 * * *" reads to a human as 02:47 and to
 * CNPG as second 47 of minute 2 of every hour. The symptom is 24 base backups
 * a day and no error anywhere.
 */
export function assertSixFieldSchedule(schedule: string): void {
  const fields = schedule.trim().split(/\s+/).length;
  if (fields === 6) return;
  throw new Error(
    `pitrSchedule "${schedule}" has ${fields} fields; CNPG needs six, leading with seconds. ` +
      `A five-field cron is accepted by the cluster and means a different time — ` +
      `"47 2 * * *" is 02:47 to every other cron and second 47 of every minute-2 to CNPG. ` +
      `Prefix the seconds: "0 47 2 * * *".`,
  );
}

/**
 * An Ingress no controller claims applies cleanly and does nothing.
 *
 * `ingressClassName` is how a controller decides an Ingress is its to serve.
 * With it unset, a cluster that has a default IngressClass will quietly pick
 * one up and a cluster that does not will ignore it — and the second is the
 * normal case anywhere more than one controller is installed. k3s ships Traefik
 * and this repo was tested against nginx: two classes, no default, and an
 * Ingress that applied without complaint and 404ed every request.
 *
 * That is the same failure the other refusals here exist for: it applies
 * cleanly and means something other than it says.
 */
export function assertIngressClass(s: Seams, ingressClassName?: string): void {
  if (s.ingress !== "ingress") return;
  if (ingressClassName) return;
  throw new Error(
    `ingress="ingress" needs ingressClassName — an Ingress with no class is claimed by no controller unless the cluster ` +
      `happens to have a default one, and applies cleanly either way. Set --param ingressClassName=nginx (or traefik, or ` +
      `whatever \`kubectl get ingressclass\` lists), or use ingress="omit".`,
  );
}
