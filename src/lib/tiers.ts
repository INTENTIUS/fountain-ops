/**
 * A tier is a deployment profile: where this runs, how much of it there is, and
 * which seam defaults make sense there. Seams stay overridable — the tier picks
 * a coherent starting point, it does not lock anything.
 *
 *   local          k3d + floci. Everything emulated, no cloud account, no DNS.
 *   light          a real cluster, one replica, bring your own Postgres.
 *   minimal-cloud  the smallest real cloud footprint that is actually usable.
 *   production     backups, metrics, TLS, a Postgres chant manages.
 *   production-ha  the above, clustered, with WAL archiving.
 *
 * `replicas` and `clustered` are decided together, not left as independent
 * knobs. fountain routes conversations through per-conversation processes;
 * above one replica the pods must form a real Erlang cluster or they run as
 * isolated islands and conversation streaming breaks for whichever pod did not
 * spawn the conversation. It fails quietly, under load, for some users. So
 * asking for two replicas at a tier that cannot cluster is a build error.
 *
 * Written as if-chains over literals rather than keyed tables: a computed
 * lookup is EVL003, and this module is read from resource files.
 */

import type { Seams } from "./seams";

export type Tier = "local" | "light" | "minimal-cloud" | "production" | "production-ha";

export interface TierShape {
  replicas: number;
  /** Erlang distribution + headless Service + libcluster DNS discovery. */
  clustered: boolean;
  /** Whether metrics wiring is emitted when the monitoring seam allows it. */
  metrics: boolean;
  /** True when this tier targets emulators rather than anything real. */
  emulated: boolean;
  resources: { cpu: string; memory: string; cpuLimit: string; memoryLimit: string };
  /** Where each seam starts for this tier. Every one is overridable. */
  seams: Seams;
}

export function shapeFor(tier: Tier): TierShape {
  if (tier === "local") {
    return {
      replicas: 1,
      clustered: false,
      metrics: false,
      emulated: true,
      // Small on purpose: this is meant to fit alongside everything else on a
      // laptop, including the emulator containers.
      resources: { cpu: "50m", memory: "256Mi", cpuLimit: "500m", memoryLimit: "1Gi" },
      seams: {
        postgres: "reference",
        secrets: "reference",
        // No ingress controller and no DNS on a throwaway local cluster —
        // reach it with `kubectl port-forward`. An Ingress that resolves
        // nowhere is worse than no Ingress: it looks like it should work.
        ingress: "omit",
        tls: "omit",
        // The one thing worth exercising locally. Floci speaks S3, so the
        // backup path runs for real against an emulated bucket rather than
        // being the part nobody tests until a restore.
        backups: "pg-dump",
        monitoring: "omit",
      },
    };
  }

  if (tier === "light") {
    return {
      replicas: 1,
      clustered: false,
      metrics: false,
      emulated: false,
      resources: { cpu: "100m", memory: "512Mi", cpuLimit: "500m", memoryLimit: "1Gi" },
      seams: {
        postgres: "reference",
        secrets: "reference",
        ingress: "ingress",
        tls: "omit",
        backups: "omit",
        monitoring: "omit",
      },
    };
  }

  if (tier === "minimal-cloud") {
    return {
      replicas: 1,
      clustered: false,
      // Off deliberately. This tier is the cheapest thing that is genuinely
      // usable, and a Prometheus stack is usually the largest line item next
      // to the database. Turn it on with --param monitoring=prometheus-operator
      // once you have somewhere to send it.
      metrics: false,
      emulated: false,
      resources: { cpu: "100m", memory: "512Mi", cpuLimit: "1", memoryLimit: "1Gi" },
      seams: {
        // A managed database (RDS, Cloud SQL, Neon) referenced by URL. Running
        // your own Postgres is not the cheap option at this size, and it is
        // the thing you least want to operate.
        postgres: "reference",
        secrets: "reference",
        ingress: "ingress",
        // A public deployment without TLS is not a deployment. cert-manager is
        // free and this is the tier where the cost argument would otherwise
        // tempt someone to skip it.
        tls: "cert-manager",
        // Nightly dump to object storage. Cheap, and the difference between
        // an outage and losing the tenant.
        backups: "pg-dump",
        monitoring: "omit",
      },
    };
  }

  if (tier === "production") {
    return {
      replicas: 1,
      clustered: false,
      metrics: true,
      emulated: false,
      resources: { cpu: "250m", memory: "1Gi", cpuLimit: "1", memoryLimit: "2Gi" },
      seams: {
        postgres: "cnpg",
        secrets: "reference",
        ingress: "ingress",
        tls: "cert-manager",
        backups: "pg-dump",
        monitoring: "prometheus-operator",
      },
    };
  }

  return {
    replicas: 2,
    clustered: true,
    metrics: true,
    emulated: false,
    resources: { cpu: "500m", memory: "1Gi", cpuLimit: "2", memoryLimit: "2Gi" },
    seams: {
      postgres: "cnpg",
      secrets: "reference",
      ingress: "ingress",
      tls: "cert-manager",
      // Point-in-time recovery, which is the reason to run CNPG at all.
      backups: "barman-pitr",
      monitoring: "prometheus-operator",
    },
  };
}

/**
 * Resolve a tier to its shape, honouring a replica override only where the
 * tier can actually support it.
 */
export function resolveTier(tier: Tier, replicaOverride?: number): TierShape {
  const shape = shapeFor(tier);
  if (replicaOverride === undefined) return shape;

  if (replicaOverride < 1) {
    throw new Error(`replicas must be at least 1, got ${replicaOverride}`);
  }
  if (replicaOverride > 1 && !shape.clustered) {
    throw new Error(
      `tier "${tier}" cannot run ${replicaOverride} replicas: above one replica the pods must form an Erlang cluster, ` +
        `or conversation streaming breaks for whichever pod did not spawn the conversation. Use tier "production-ha".`,
    );
  }
  return {
    replicas: replicaOverride,
    clustered: shape.clustered,
    metrics: shape.metrics,
    emulated: shape.emulated,
    resources: shape.resources,
    seams: shape.seams,
  };
}
