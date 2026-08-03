/**
 * Tiers — how durable the deployment is, and nothing else.
 *
 * Two of them, because two is how many structurally distinct shapes there are.
 * There used to be three, and the middle one emitted a deployment identical to
 * `light`: same kinds, same replica count, the same absence of clustering. The
 * only differences were resource requests and backup retention, and a bigger
 * single pod is not more durable than a smaller single pod — it survives
 * exactly the same set of failures, which is none of them.
 *
 * A three-rung ladder with nothing on the middle rung is worse than two rungs,
 * because someone picking the middle one believes they bought something. See
 * #21.
 *
 * A tier never changes what fountain can do: the same API, the same primitives,
 * the same data plane at both. `light` is not a cut-down fountain, it is a
 * smaller one. What it moves is durability — replica count, the clustering that
 * count requires, and how long backups are kept.
 *
 * Resource sizing moved to `Size` below, which is what it always was: an
 * orthogonal knob rather than a step on this ladder.
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

export type Tier = "light" | "ha";

export interface TierShape {
  replicas: number;
  /** Erlang distribution + headless Service + libcluster DNS discovery. */
  clustered: boolean;
  /** Days of backups kept, where the backup seam is on. */
  retentionDays: number;
}

export function tierShape(tier: Tier): TierShape {
  if (tier === "light") {
    return { replicas: 1, clustered: false, retentionDays: 7 };
  }
  return { replicas: 2, clustered: true, retentionDays: 30 };
}

/**
 * Size — how much of the machine it asks for, and nothing else.
 *
 * Deliberately not a tier. It changes no shape, refuses no combination and
 * survives no additional failure. It is the RAM knob that used to masquerade as
 * a durability step.
 *
 * `small` and `large` are what `light` and `ha` already carried, so collapsing
 * the tiers changed no deployment that was not already identical to another
 * one. `medium` is what `standard` was, still reachable as `--param
 * size=medium` — a sizing choice, which is all it ever was.
 */
export type Size = "small" | "medium" | "large";

export interface SizeShape {
  cpu: string;
  memory: string;
  cpuLimit: string;
  memoryLimit: string;
}

export function sizeShape(size: Size): SizeShape {
  if (size === "small") {
    return { cpu: "100m", memory: "512Mi", cpuLimit: "500m", memoryLimit: "1Gi" };
  }
  if (size === "medium") {
    return { cpu: "250m", memory: "1Gi", cpuLimit: "1", memoryLimit: "2Gi" };
  }
  return { cpu: "500m", memory: "1Gi", cpuLimit: "2", memoryLimit: "2Gi" };
}

/**
 * What a tier asks for when nothing says otherwise.
 *
 * A default, not a coupling. `size` is settable on its own and
 * `tier=light size=large` is an ordinary thing to want; this exists so that
 * dropping the middle tier did not silently shrink an `ha` deployment.
 */
export function defaultSize(tier: Tier): Size {
  return tier === "ha" ? "large" : "small";
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
    retentionDays: shape.retentionDays,
  };
}
