/**
 * The three-node stand-in `just e2e-k8s` treats as foreign.
 *
 * Three nodes so the ha replicas can land on different machines, and the
 * loadbalancer published on a host port so the Ingress assertions reach
 * Traefik from outside — the port here and the curl in the recipe meet at
 * the emitted config, which the recipe reads rather than restates.
 *
 * kubeconfig: written but never switched to, same as the local cluster —
 * except here it is load-bearing rather than a courtesy: every kubectl
 * call in e2e-k8s names this context explicitly, and the recipe's claim to
 * treat the cluster as foreign is only true while nothing repoints the
 * ambient context under the operator mid-run.
 */
import { Cluster, K3dOptions, KubeconfigOptions, Options, Port } from "@intentius/chant-lexicon-k3d";

export const standInCluster = new Cluster({
  metadata: { name: "fountain-k8s-stand-in" },
  servers: 1,
  agents: 2,
  ports: [new Port({ port: "8091:80", nodeFilters: ["loadbalancer"] })],
  options: new Options({
    k3d: new K3dOptions({}),
    kubeconfig: new KubeconfigOptions({
      updateDefaultKubeconfig: true,
      switchCurrentContext: false,
    }),
  }),
});
