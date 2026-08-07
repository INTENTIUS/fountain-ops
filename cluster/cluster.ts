/**
 * The cluster itself, declared — the last piece of undeclared infrastructure
 * in this repo (chant#1415, closing the gap #1351 named).
 *
 * `chant build cluster --lexicon k3d` emits the SimpleConfig YAML that
 * `k3d cluster create --config` consumes verbatim, and the `cluster-up` Op's
 * `k3dUp` points at that file — so the flags the justfile used to carry
 * (`--servers 1 --agents 0 --no-lb`) are properties here, reviewable and
 * diffable like every other input. `--wait` was never config: it is
 * lifecycle, and it lives in the activity.
 *
 * ## Target-conditional, like every other seam
 *
 * Only `target=k3d` has a cluster to declare. At `target=kubernetes` the
 * cluster is the adopter's and this file emits nothing — the same shape as
 * `src/data/postgres.ts` emitting nothing when postgres is not `bundled`.
 *
 * ## The kubeconfig behaviour is declared back ON, deliberately
 *
 * chant's k3d default leaves ~/.kube/config and the current context alone
 * (chant#1411). This repo's recipes run against the ambient context on
 * purpose — every one of them is gated by the foreign-cluster guard in the
 * justfile, which is the protection that makes ambient safe here. So the
 * declaration opts back into merge-and-switch explicitly, where a reviewer
 * can see it, rather than the recipe quietly `kubectl config use-context`ing
 * after the fact.
 */
import { Cluster, K3dOptions, KubeconfigOptions, Options } from "@intentius/chant-lexicon-k3d";
import { params } from "@intentius/chant/params";
import type { Target } from "../src/lib/targets";

const targetName = (params.target as Target | undefined) ?? "k3d";

/** One server, no agents, no loadbalancer: this tier has no ingress, and the
 * port-forward is how you reach it. */
export const cluster =
  targetName === "k3d"
    ? new Cluster({
        metadata: { name: "fountain-local" },
        servers: 1,
        agents: 0,
        options: new Options({
          k3d: new K3dOptions({ disableLoadbalancer: true }),
          kubeconfig: new KubeconfigOptions({
            updateDefaultKubeconfig: true,
            switchCurrentContext: true,
          }),
        }),
      })
    : undefined;
