import { IngressRoute, Middleware } from "@intentius/chant-lexicon-k8s";
import { namespace, host, httpsPublicUrl, seams, labels, traefikMiddlewareNamespace } from "../params";

/**
 * The Traefik ingress seam.
 *
 * An IngressRoute is not an Ingress with annotations — it is Traefik's own
 * kind, with its own matcher grammar. The contract from `ingress.ts` still
 * holds and is not optional over https: whatever terminates TLS must set
 * X-Forwarded-Proto, or fountain sees plain http, redirects, and loops.
 *
 * Traefik sets it on the websecure entrypoint by default. That default is the
 * reason this is not spelled out in an annotation here, and the reason it is
 * worth knowing if anyone changes the entrypoint config.
 *
 * WebSocket upgrades pass through without configuration — the dashboard is
 * LiveView and Traefik proxies upgrades natively.
 */

/** The matcher. Backticks are Traefik's grammar, not YAML quoting. */
const match = `Host(\`${host}\`)`;

/** Port 80 on the Service — never 9568, which is the metrics listener. */
const services = [{ name: "fountain", port: 80 }];

/**
 * The https route.
 *
 * Over plain http this is the only route, and it sits on `web` rather than
 * `websecure`: an entrypoint that terminates nothing needs no certificate, and
 * pointing at a secretName that will never exist is how you get a route that
 * silently serves Traefik's default certificate.
 */
export const traefikRoute =
  seams.ingress === "traefik"
    ? new IngressRoute({
        metadata: { name: "fountain", namespace, labels },
        spec: {
          entryPoints: httpsPublicUrl ? ["websecure"] : ["web"],
          routes: [{ match, kind: "Rule", services }],
          // cert-manager writes fountain-tls; ingress.ts's Certificate is what
          // creates it. Without that seam there is nothing to reference.
          tls: seams.tls === "cert-manager" ? { secretName: "fountain-tls" } : undefined,
        },
      })
    : undefined;

/**
 * The redirect middleware, and the http route that uses it.
 *
 * Only meaningful over https — there is nothing to redirect to otherwise.
 *
 * The middleware is declared here rather than assumed to exist. A `middlewares`
 * entry naming something absent does not fail: Traefik finds nothing, applies
 * no middleware, and serves the route anyway, so plain http keeps working and
 * nothing reports a problem.
 */
export const traefikRedirect =
  seams.ingress === "traefik" && httpsPublicUrl
    ? new Middleware({
        metadata: { name: "fountain-redirect-https", namespace, labels },
        spec: { redirectScheme: { scheme: "https", permanent: true } },
      })
    : undefined;

export const traefikHttpRoute =
  seams.ingress === "traefik" && httpsPublicUrl
    ? new IngressRoute({
        metadata: { name: "fountain-http", namespace, labels },
        spec: {
          entryPoints: ["web"],
          routes: [
            {
              match,
              kind: "Rule",
              // The namespace qualifier is load-bearing whenever the middleware
              // lives elsewhere: without it Traefik looks in this route's own
              // namespace. Defaults to this namespace, where the middleware
              // above is declared.
              middlewares: [
                { name: "fountain-redirect-https", namespace: traefikMiddlewareNamespace },
              ],
              services,
            },
          ],
        },
      })
    : undefined;
