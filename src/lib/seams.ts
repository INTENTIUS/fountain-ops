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

export interface Seams {
  postgres: PostgresMode;
  secrets: SecretsMode;
  ingress: IngressMode;
  tls: TlsMode;
  backups: BackupsMode;
  monitoring: MonitoringMode;
}

/** Explicit seam choices — anything left undefined falls to the tier's default. */
export interface SeamOverrides {
  postgres?: PostgresMode;
  secrets?: SecretsMode;
  ingress?: IngressMode;
  tls?: TlsMode;
  backups?: BackupsMode;
  monitoring?: MonitoringMode;
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
