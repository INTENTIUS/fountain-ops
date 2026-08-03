import { PodDisruptionBudget } from "@intentius/chant-lexicon-k8s";
import { namespace, tier, labels } from "../params";

/**
 * A PodDisruptionBudget, where there is more than one pod to protect.
 *
 * Nothing emitted one at any tier, and chant's own post-synth check has been
 * saying so at `ha`:
 *
 *   Deployment "fountain" has 2 replicas but no PodDisruptionBudget
 *
 * Without it a node drain can take both replicas at once. The rolling update
 * strategy does not help: `maxUnavailable: 0` constrains a *rollout*, and an
 * eviction is not a rollout.
 *
 * ## Only when clustered
 *
 * At one replica a PDB is not a smaller safeguard, it is a different and worse
 * thing. `minAvailable: 1` over a single pod means no voluntary eviction can
 * ever succeed — `kubectl drain` hangs, cluster upgrades stall, and the
 * operator's fix is to delete the object they were told protected them.
 *
 * A single-replica deployment has no availability to budget. The honest answer
 * at `light` is no PDB, and the honest answer to wanting one is `tier=ha`.
 */

export const pdb = tier.clustered
  ? new PodDisruptionBudget({
      metadata: { name: "fountain", namespace, labels },
      spec: {
        // One pod may go at a time, and the survivor keeps serving. Expressed
        // as minAvailable rather than maxUnavailable so it stays correct if the
        // replica count is raised: two of three is a worse guarantee than "at
        // least one", and at 2 replicas they are the same thing.
        minAvailable: 1,
        selector: { matchLabels: labels },
      },
    })
  : undefined;
