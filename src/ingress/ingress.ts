import { Ingress, Certificate } from "@intentius/chant-lexicon-k8s";
import { namespace, host, httpsPublicUrl, seams, clusterIssuer, ingressClassName, labels } from "../params";

/**
 * The ingress seam.
 *
 * Whatever terminates TLS has one contract to satisfy, and it is not optional
 * when scheme=https: it must set X-Forwarded-Proto. Fountain redirects anything
 * that looks like plain http, so without the header everything redirects, in a
 * loop, and the symptom looks like a broken app rather than a missing header.
 *
 * WebSocket upgrades must pass through too — the dashboard is LiveView.
 *
 * ingress="traefik" is declared in the seam enum and refused in lib/seams.ts
 * until chant generates traefik.io CRDs. Hand-rolling an IngressRoute as an
 * untyped blob would build green and fail at the cluster, which is the failure
 * mode chant exists to remove.
 */

export const ingress =
  seams.ingress === "ingress"
    ? new Ingress({
        metadata: {
          name: "fountain",
          namespace,
          labels,
          annotations: httpsPublicUrl
            ? {
                // Nothing here is universal — every controller spells this
                // differently. The contract is in the doc comment above; these
                // are the nginx spellings as a starting point.
                "nginx.ingress.kubernetes.io/force-ssl-redirect": "true",
                "nginx.ingress.kubernetes.io/proxy-read-timeout": "3600",
              }
            : undefined,
        },
        spec: {
          // undefined rather than a conditional spread: the serializer omits
          // undefined properties, and a spread of a ternary is EVL004.
          ingressClassName,
          rules: [
            {
              host,
              http: {
                paths: [
                  {
                    path: "/",
                    pathType: "Prefix",
                    // Port 80 on the Service, never 9568 — the metrics
                    // listener enumerates routes and DB timings and is
                    // deliberately unreachable from outside the cluster.
                    backend: { service: { name: "fountain", port: { name: "http" } } },
                  },
                ],
              },
            },
          ],
          tls: seams.tls === "cert-manager" ? [{ hosts: [host], secretName: "fountain-tls" }] : undefined,
        },
      })
    : undefined;

/**
 * The certificate, when cert-manager owns issuance. Named to match the
 * `secretName` the ingress above references — if these two ever disagree the
 * ingress serves its default certificate and the browser warning is the first
 * anyone hears about it.
 */
export const certificate =
  seams.tls === "cert-manager"
    ? new Certificate({
        metadata: { name: "fountain-tls", namespace, labels },
        spec: {
          secretName: "fountain-tls",
          issuerRef: { name: clusterIssuer, kind: "ClusterIssuer" },
          dnsNames: [host],
        },
      })
    : undefined;
