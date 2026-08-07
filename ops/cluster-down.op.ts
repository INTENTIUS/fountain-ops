import { Op, phase, k3dDown } from "@intentius/chant-lexicon-temporal";

/**
 * Delete the local cluster (chant#1415). `k3d cluster delete` is a no-op
 * success when the cluster is already gone, so this needs no tolerance
 * prefix in the recipe that calls it.
 *
 * The delete itself is unconditional: chant's ownership marker does live on
 * a k3d cluster (Docker labels on the server node, chant#1412) and the
 * observation side reads it, but `k3dDown` does not consult it before
 * deleting. What stands between this Op and somebody else's cluster is the
 * justfile's foreign-cluster guard plus the name: it deletes
 * `fountain-local` and nothing else — and this project created that cluster,
 * marker and all.
 */
export default Op({
  name: "cluster-down",
  overview: "Delete the declared k3d cluster",
  taskQueue: "cluster",
  phases: [
    phase("Cluster", [
      k3dDown("fountain-local"),
    ]),
  ],
});
