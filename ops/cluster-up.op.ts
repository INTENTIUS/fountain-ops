import { Op, phase, k3dUp } from "@intentius/chant-lexicon-temporal";

/**
 * Create the local cluster from its declaration (chant#1415).
 *
 * `just cluster-up` builds `dist/cluster.yaml` from `cluster/cluster.ts` and
 * runs this — so cluster shape lives in exactly one reviewable place and the
 * recipe carries no `k3d` flags. `k3dUp` is idempotent (an existing cluster
 * is left as-is) and passes `--wait` itself; the apiserver-readiness poll
 * stays in the recipe, because k3d being satisfied and the apiserver
 * accepting connections are different moments and CI once fell into the gap.
 *
 * The name here must match `cluster/cluster.ts`'s `metadata.name` and the
 * justfile's `cluster` variable — k3d addresses clusters by name, and the
 * config file does not relieve the create/exists/delete calls of naming one.
 *
 * The kubeconfig args repeat what the declaration already says, deliberately:
 * `k3dUp` cannot see inside an opaque configFile, so on the reuse path it
 * assumes the default kubeconfig was never touched and writes a dedicated
 * one — reachable, but not the ambient context every recipe here relies on.
 * Stating the intent as args makes create and reuse behave identically.
 * `cluster/cluster.ts` remains the single source for the cluster's *shape*;
 * these two flags are connection behaviour, stated twice on purpose, and the
 * declaration keeps them so the emitted config stands alone.
 */
export default Op({
  name: "cluster-up",
  overview: "The declared k3d cluster, created from dist/cluster.yaml",
  taskQueue: "cluster",
  phases: [
    phase("Cluster", [
      k3dUp("fountain-local", {
        configFile: "dist/cluster.yaml",
        updateDefaultKubeconfig: true,
        switchCurrentContext: true,
      }),
    ]),
  ],
});
