/**
 * The laptop cluster, declared.
 *
 * `just cluster-up` used to spell this as flags on `k3d cluster create`;
 * now the flags are data, `chant build cluster` emits the SimpleConfig
 * YAML, and `k3d cluster create --config` consumes it. The artifact is a
 * file the native tool accepts with chant nowhere in sight, so the
 * walk-away cost is zero.
 *
 * The kubeconfig block is the deliberate part. The lexicon's default pins
 * both halves off; this opts the *write* back on so `kubectl config
 * use-context k3d-fountain-local` has something to switch to, and leaves
 * `switchCurrentContext` off — the justfile's foreign-cluster guard exists
 * precisely because a cluster create repointing the ambient context
 * mid-session produces convincingly false failures. cluster-up switches
 * explicitly, once, on purpose.
 */
import { Cluster, K3dOptions, KubeconfigOptions, Options } from "@intentius/chant-lexicon-k3d";

/** One server, no agents, no loadbalancer: light has no ingress, and the
 * port-forward is how you reach it. */
export const localCluster = new Cluster({
  metadata: { name: "fountain-local" },
  servers: 1,
  agents: 0,
  options: new Options({
    k3d: new K3dOptions({ disableLoadbalancer: true }),
    kubeconfig: new KubeconfigOptions({
      updateDefaultKubeconfig: true,
      switchCurrentContext: false,
    }),
  }),
});
