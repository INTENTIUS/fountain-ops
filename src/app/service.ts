import { Namespace, Service } from "@intentius/chant-lexicon-k8s";
import { namespace, tier, labels, serviceLabels } from "../params";

export const ns = new Namespace({
  metadata: { name: namespace, labels },
});

export const service = new Service({
  metadata: { name: "fountain", namespace, labels: serviceLabels },
  spec: {
    type: "ClusterIP",
    selector: labels,
    ports: [
      { name: "http", port: 80, targetPort: 4000, protocol: "TCP" },
      // Scraped in-cluster only. It enumerates routes, request rates and DB
      // timings, so it is deliberately absent from every ingress below.
      { name: "metrics", port: 9568, targetPort: 9568, protocol: "TCP" },
    ],
  },
});

/**
 * Headless Service — DNS returns one A record per pod IP instead of a VIP.
 * libcluster polls this name to find peers and form the Erlang cluster.
 * Distribution traffic itself flows pod-IP to pod-IP, not through here.
 *
 * publishNotReadyAddresses lets pods find each other during a rollout before
 * they pass readiness, so the cluster forms promptly instead of waiting out
 * the readiness gate.
 *
 * Only exists when the tier is clustered — a headless Service for a single
 * pod is a resource that does nothing and invites the question of why.
 */
export const headless = tier.clustered
  ? new Service({
      metadata: { name: "fountain-headless", namespace, labels },
      spec: {
        type: "ClusterIP",
        clusterIP: "None",
        publishNotReadyAddresses: true,
        selector: labels,
        ports: [
          { name: "epmd", port: 4369, targetPort: 4369 },
          { name: "erldist", port: 9100, targetPort: 9100 },
        ],
      },
    })
  : undefined;
