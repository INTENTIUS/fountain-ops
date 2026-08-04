/**
 * Targets — which Kubernetes cluster this runs on.
 *
 * A target picks the cluster and, with it, which seam defaults are coherent
 * there. It does not decide how durable the deployment is; that is the tier.
 *
 * ## `target` answers "which cluster", not "what kind of thing runs this"
 *
 * Decided in #25 and recorded here rather than only in a closed issue.
 *
 * `k3d` and `kubernetes` are both Kubernetes, and a managed cluster — EKS, GKE,
 * AKS — is `target=kubernetes` with different seam defaults rather than a new
 * value. Anything without a Kubernetes API is not a third value on this axis:
 * every resource module in src/ emits K8s::*, and a Task Definition is not a
 * Deployment with different field names. Adding an enum value would advertise a
 * config change and mean a rewrite.
 *
 * chant is not the constraint — it ships aws, fly, gcp and azure lexicons. This
 * repo's emitters are. If a second emitter tree ever lands (#54, #55), `target`
 * is the wrong name for what selects between them and the honest move is a new
 * axis above it, not a stretched one.
 *
 * What generalises is the seam model: postgres, secrets, ingress, tls, backups,
 * monitoring, dataPlane and storage all mean something on any substrate, and
 * dataPlane and storage do not change at all — an HTTP API and an S3 bucket do
 * not care what schedules the caller.
 *
 * This axis exists separately from the tier because they answer different
 * questions and mixing them produces knobs that mean two things at once. A
 * "local" tier is really a k3d target at the light tier, and collapsing those
 * into one word is what makes people ask whether `production` implies a cloud.
 *
 * Separate questions, though, is not the same as a free grid, and the earlier
 * wording here ("any tier runs on any target") was tested and found false:
 *
 *   k3d + ha  ->  refused. Every one of k3d's defaults is a single-pod
 *                 stand-in: postgres="bundled" is one pod with a volume,
 *                 dataPlane="spritzer" holds every sandbox in memory, and
 *                 storage="floci" holds every backup in memory. None can carry
 *                 "ha", and they are refused one at a time — so naming
 *                 postgres alone gets you the next error, not a build.
 *
 * A tier never fails because of the target as such. It fails because the seam
 * defaults that are coherent on that substrate cannot carry it, which is a
 * refusal you can always resolve by naming the seam. Five of the six
 * combinations build; the sixth says which seam to set.
 *
 * Written as an if-chain over literals: a computed lookup is EVL003, and this
 * module is read from resource files.
 */

import type { Seams } from "./seams";

export type Target = "k3d" | "kubernetes";

export interface TargetShape {
  /** True when nothing this touches is real — emulators and a throwaway cluster. */
  emulated: boolean;
  /** Where each seam starts on this substrate. Every one is overridable. */
  seams: Seams;
}

export function targetShape(target: Target): TargetShape {
  if (target === "k3d") {
    return {
      emulated: true,
      seams: {
        // A plain single-instance Postgres in the cluster. Not CNPG — this
        // substrate has no operator and does not want one.
        postgres: "bundled",
        secrets: "reference",
        // No ingress controller and no DNS on a throwaway cluster. Reach it
        // with a port-forward. An Ingress that resolves nowhere is worse than
        // no Ingress: it looks like it should work.
        ingress: "omit",
        tls: "omit",
        backups: "pg-dump",
        monitoring: "omit",
        // The emulator, because there is no real Sprites account offline and a
        // placeholder token against the real API is not a data plane, it is a
        // 401 nobody sees until they try to talk to an agent.
        dataPlane: "spritzer",
        // The emulator, in the cluster. The backup path then runs for real
        // against an emulated bucket instead of being the part nobody
        // exercises until a restore.
        storage: "floci",
      },
    };
  }

  // A real cluster you already have. Nothing is assumed about what is
  // installed on it, so every seam that needs an operator starts off.
  return {
    emulated: false,
    seams: {
      postgres: "reference",
      secrets: "reference",
      ingress: "ingress",
      tls: "omit",
      backups: "omit",
      monitoring: "omit",
      // A real cluster talks to the real API. Running the emulator here is
      // expressible and occasionally what a staging cluster wants; it is not
      // what an unconfigured one should default to.
      dataPlane: "sprites",
      storage: "s3",
    },
  };
}
