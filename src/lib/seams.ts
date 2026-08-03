/**
 * Seams — who provides each dependency.
 *
 * Every seam has at least one mode that works with the k8s lexicon as it ships
 * today. The modes that need CRDs chant does not generate yet are declared
 * here anyway and refused at build time with the issue that unblocks them, so
 * the gap is a named error rather than a manifest that will not apply.
 *
 * Refusing beats emitting: a Traefik IngressRoute assembled by hand as an
 * untyped blob would build green and then fail at the cluster, which is the
 * failure mode chant exists to remove.
 */

export type PostgresMode = "reference" | "bundled" | "cnpg";
export type SecretsMode = "reference" | "infisical";
export type IngressMode = "omit" | "ingress" | "traefik";
export type TlsMode = "omit" | "cert-manager";
export type BackupsMode = "omit" | "pg-dump" | "barman-pitr";
export type MonitoringMode = "omit" | "prometheus-operator";

/**
 * A mode that needs a CRD chant cannot generate yet, and the issue that lands
 * it. Written as an if-chain rather than a keyed table because a computed
 * lookup is EVL003 and this module is read from resource files.
 */
function blockedBy(seam: string, mode: string): { needs: string; issue: string } | undefined {
  if (seam === "postgres" && mode === "cnpg") {
    return { needs: "postgresql.cnpg.io Cluster", issue: "INTENTIUS/chant#1319" };
  }
  if (seam === "backups" && mode === "barman-pitr") {
    return { needs: "barmancloud.cnpg.io ObjectStore + CNPG ScheduledBackup", issue: "INTENTIUS/chant#1319" };
  }
  if (seam === "ingress" && mode === "traefik") {
    return { needs: "traefik.io IngressRoute", issue: "INTENTIUS/chant#1320" };
  }
  if (seam === "secrets" && mode === "infisical") {
    return { needs: "secrets.infisical.com InfisicalSecret", issue: "INTENTIUS/chant#1321" };
  }
  return undefined;
}

function check(seam: string, mode: string): void {
  const blocked = blockedBy(seam, mode);
  if (!blocked) return;
  throw new Error(
    `seam ${seam}="${mode}" needs ${blocked.needs}, which the k8s lexicon does not generate yet (${blocked.issue}). ` +
      `Until it lands, use a mode that is available and provision this dependency outside chant.`,
  );
}

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

  check("postgres", s.postgres);
  check("secrets", s.secrets);
  check("ingress", s.ingress);
  check("backups", s.backups);

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
