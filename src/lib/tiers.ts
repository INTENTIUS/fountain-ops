/**
 * What a tier actually changes.
 *
 * A tier is not a size label — it decides whether the deployment carries the
 * wiring its replica count requires. fountain routes conversations through
 * per-conversation processes; above one replica the pods must form a real
 * Erlang cluster or they run as isolated islands and conversation streaming
 * breaks for whichever pod did not spawn the conversation. It fails quietly,
 * under load, for some users.
 *
 * So `replicas` and `clustered` are decided together here rather than left as
 * independent knobs. Asking for two replicas at `light` is a build error, not
 * a silent island.
 *
 * Written as an if-chain over literals rather than a keyed table: a computed
 * lookup is EVL003, and this module is read by resource files.
 */

export type Tier = "light" | "production" | "production-ha";

export interface TierShape {
  replicas: number;
  /** Erlang distribution + headless Service + libcluster DNS discovery. */
  clustered: boolean;
  /** Whether metrics wiring is emitted when the monitoring seam allows it. */
  metrics: boolean;
  resources: { cpu: string; memory: string; cpuLimit: string; memoryLimit: string };
}

function shapeFor(tier: Tier): TierShape {
  if (tier === "light") {
    return {
      replicas: 1,
      clustered: false,
      metrics: false,
      resources: { cpu: "100m", memory: "512Mi", cpuLimit: "500m", memoryLimit: "1Gi" },
    };
  }
  if (tier === "production") {
    return {
      replicas: 1,
      clustered: false,
      metrics: true,
      resources: { cpu: "250m", memory: "1Gi", cpuLimit: "1", memoryLimit: "2Gi" },
    };
  }
  return {
    replicas: 2,
    clustered: true,
    metrics: true,
    resources: { cpu: "500m", memory: "1Gi", cpuLimit: "2", memoryLimit: "2Gi" },
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
    resources: shape.resources,
  };
}
