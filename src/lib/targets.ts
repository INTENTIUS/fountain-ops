/**
 * Targets — where the substrate runs.
 *
 * A target picks the substrate and, with it, which seam defaults are coherent
 * there. It does not decide how durable the deployment is; that is the tier.
 *
 * This axis exists separately from the tier because they answer different
 * questions and mixing them produces knobs that mean two things at once. A
 * "local" tier is really a k3d target at the light tier, and collapsing those
 * into one word is what makes people ask whether `production` implies a cloud.
 *
 * Separate questions, though, is not the same as a free grid, and the earlier
 * wording here ("any tier runs on any target") was tested and found false:
 *
 *   k3d + ha  ->  refused. k3d defaults to postgres="bundled", which is one
 *                 pod with a volume and cannot back an "ha" deployment. Adding
 *                 postgres="cnpg" builds it.
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
  /** Default S3 endpoint for the backup seam. floci, locally. */
  s3Endpoint?: string;
}

export function targetShape(target: Target): TargetShape {
  if (target === "k3d") {
    return {
      emulated: true,
      // floci speaks S3, so the backup path runs for real against an emulated
      // bucket rather than being the part nobody exercises until a restore.
      s3Endpoint: "http://localhost:4566",
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
    },
  };
}
