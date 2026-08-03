/**
 * Tiers — how durable the deployment is, and nothing else.
 *
 * A tier scales the same deployment up or down. It never changes what fountain
 * can do: the same API, the same primitives, the same Sprites data plane at
 * every tier. `light` is not a cut-down fountain, it is a smaller one.
 *
 * What it moves is durability — replica count and the clustering that count
 * requires, resource floors, and how long backups are kept.
 *
 * The one thing that is not a free knob is the replica count. fountain routes
 * conversations through per-conversation processes; above one replica the pods
 * must form a real Erlang cluster or they run as isolated islands and
 * conversation streaming breaks for whichever pod did not spawn the
 * conversation. It fails quietly, under load, for some users. So `replicas` and
 * `clustered` are decided together and asking for two replicas at a tier that
 * cannot cluster is a build error.
 *
 * Written as an if-chain over literals: a computed lookup is EVL003, and this
 * module is read from resource files.
 */

export type Tier = "light" | "standard" | "ha";

export interface TierShape {
  replicas: number;
  /** Erlang distribution + headless Service + libcluster DNS discovery. */
  clustered: boolean;
  resources: { cpu: string; memory: string; cpuLimit: string; memoryLimit: string };
  /** Days of backups kept, where the backup seam is on. */
  retentionDays: number;
}

export function tierShape(tier: Tier): TierShape {
  if (tier === "light") {
    return {
      replicas: 1,
      clustered: false,
      resources: { cpu: "100m", memory: "512Mi", cpuLimit: "500m", memoryLimit: "1Gi" },
      retentionDays: 7,
    };
  }
  if (tier === "standard") {
    return {
      replicas: 1,
      clustered: false,
      resources: { cpu: "250m", memory: "1Gi", cpuLimit: "1", memoryLimit: "2Gi" },
      retentionDays: 14,
    };
  }
  return {
    replicas: 2,
    clustered: true,
    resources: { cpu: "500m", memory: "1Gi", cpuLimit: "2", memoryLimit: "2Gi" },
    retentionDays: 30,
  };
}

/**
 * Resolve a tier, honouring a replica override only where the tier can
 * actually support it.
 */
export function resolveTier(tier: Tier, replicaOverride?: number): TierShape {
  const shape = tierShape(tier);
  if (replicaOverride === undefined) return shape;

  if (replicaOverride < 1) {
    throw new Error(`replicas must be at least 1, got ${replicaOverride}`);
  }
  if (replicaOverride > 1 && !shape.clustered) {
    throw new Error(
      `tier "${tier}" cannot run ${replicaOverride} replicas: above one replica the pods must form an Erlang cluster, ` +
        `or conversation streaming breaks for whichever pod did not spawn the conversation. Use tier "ha".`,
    );
  }
  return {
    replicas: replicaOverride,
    clustered: shape.clustered,
    resources: shape.resources,
    retentionDays: shape.retentionDays,
  };
}
