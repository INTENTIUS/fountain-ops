import { Ingress, Certificate } from "@intentius/chant-lexicon-k8s";
import { namespace, hostname, httpsPublicUrl, seams, clusterIssuer, ingressClassName, labels } from "../params";
import { service } from "../app/service";

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
          // Nothing here is universal — every controller spells this
          // differently. The contract is in the doc comment above; these are
          // the nginx spellings.
          //
          // proxy-read-timeout is NOT conditional on https, and used to be.
          // fountain streams a conversation over SSE and holds the connection
          // open for up to 60s between events; nginx's default read timeout is
          // also 60s, so a plain-http ingress cut long streams at exactly the
          // boundary where they are most likely to be waiting. The scheme has
          // nothing to do with how long a stream lives.
          //
          // undefined rather than a conditional spread, which is EVL004 — the
          // serializer omits undefined properties, and this file already said
          // so about ingressClassName below before I did it anyway.
          annotations: {
            "nginx.ingress.kubernetes.io/proxy-read-timeout": "3600",
            // This one really is https-only: forcing a redirect to a scheme
            // nothing terminates is a loop.
            "nginx.ingress.kubernetes.io/force-ssl-redirect": httpsPublicUrl ? "true" : undefined,
          },
        },
        spec: {
          // undefined rather than a conditional spread: the serializer omits
          // undefined properties, and a spread of a ternary is EVL004.
          ingressClassName,
          rules: [
            {
              host: hostname,
              http: {
                paths: [
                  {
                    path: "/",
                    pathType: "Prefix",
                    // Port 80 on the Service, never 9568 — the metrics
                    // listener enumerates routes and DB timings and is
                    // deliberately unreachable from outside the cluster.
                    // The reference, not the string: an Ingress→Service edge
                    // for the graph (#84), serialized to the same literal.
                    backend: { service: { name: service.name, port: { name: "http" } } },
                  },
                ],
              },
            },
          ],
          tls: seams.tls === "cert-manager" ? [{ hosts: [hostname], secretName: "fountain-tls" }] : undefined,
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
          dnsNames: [hostname],
        },
      })
    : undefined;
