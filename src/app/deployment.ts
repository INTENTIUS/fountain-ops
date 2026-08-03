import { Deployment, Container, Probe } from "@intentius/chant-lexicon-k8s";
import { namespace, image, publicUrl, host, httpsPublicUrl, tier, seams, secretName, labels } from "../params";

/**
 * The fountain server.
 *
 * The probe split is the part worth reading before changing anything:
 *
 *   startup    holds the others off while boot-time migrations run. Fountain
 *              migrates on every start, under an advisory lock, before the
 *              endpoint listens. 150s of headroom.
 *   readiness  checks Postgres and gates traffic. A pod that cannot serve is
 *              pulled from the Service without being killed, so recovery needs
 *              no restart. Timeout is generous because answering 503 with a
 *              dead database takes about 3s, and a recorded 503 is more legible
 *              than a probe timeout.
 *   liveness   checks the process and nothing else. Pointing it at the database
 *              would restart every pod at once during a Postgres blip, which
 *              does nothing to fix Postgres.
 *
 * Simplifying liveness to /health/ready is the specific mistake this comment
 * exists to prevent.
 */

const clusteringEnv = tier.clustered
  ? [
      // Pod IP first — Kubernetes only substitutes vars defined earlier.
      { name: "POD_IP", valueFrom: { fieldRef: { fieldPath: "status.podIP" } } },
      { name: "RELEASE_DISTRIBUTION", value: "name" },
      // The basename must be the release name: libcluster derives peer node
      // names from it, so a mismatch discovers peers that never connect.
      { name: "RELEASE_NODE", value: "fountain_server@$(POD_IP)" },
      { name: "RELEASE_COOKIE", valueFrom: { secretKeyRef: { name: secretName, key: "SECRET_KEY_BASE" } } },
      // Pin the distribution port so a NetworkPolicy can name it; epmd would
      // otherwise hand out a random high port per boot.
      { name: "ERL_AFLAGS", value: "-kernel inet_dist_listen_min 9100 inet_dist_listen_max 9100" },
      { name: "CLUSTER_DNS_QUERY", value: `fountain-headless.${namespace}.svc.cluster.local` },
    ]
  : [];

const clusteringPorts = tier.clustered
  ? [
      { containerPort: 4369, name: "epmd" },
      { containerPort: 9100, name: "erldist" },
    ]
  : [];

// With postgres="cnpg" the operator generates a Secret carrying a ready-made
// connection URI. With "reference" the URL is one more key in the Secret you
// created — a connection string with a password in it is not config.
const databaseUrl =
  seams.postgres === "cnpg"
    ? { name: "DATABASE_URL", valueFrom: { secretKeyRef: { name: "fountain-pg-app", key: "uri" } } }
    : { name: "DATABASE_URL", valueFrom: { secretKeyRef: { name: secretName, key: "DATABASE_URL" } } };

export const deployment = new Deployment({
  metadata: { name: "fountain", namespace, labels },
  spec: {
    replicas: tier.replicas,
    strategy: { type: "RollingUpdate", rollingUpdate: { maxSurge: 1, maxUnavailable: 0 } },
    selector: { matchLabels: labels },
    template: {
      metadata: { labels },
      spec: {
        containers: [
          new Container({
            name: "fountain",
            image,
            ports: [{ containerPort: 4000, name: "http" }, { containerPort: 9568, name: "metrics" }, ...clusteringPorts],
            env: [
              { name: "PHX_SERVER", value: "true" },
              { name: "PORT", value: "4000" },
              { name: "PUBLIC_URL", value: publicUrl },
              { name: "PHX_HOST", value: host },
              databaseUrl,
              ...clusteringEnv,
            ],
            // Everything secret-shaped comes from the Secret, whoever made it.
            envFrom: [{ secretRef: { name: secretName } }],
            securityContext: {
              runAsNonRoot: true,
              runAsUser: 1001,
              readOnlyRootFilesystem: true,
              capabilities: { drop: ["ALL"] },
            },
            resources: {
              requests: { cpu: tier.resources.cpu, memory: tier.resources.memory },
              limits: { cpu: tier.resources.cpuLimit, memory: tier.resources.memoryLimit },
            },
            startupProbe: new Probe({
              httpGet: { path: "/health", port: 4000 },
              periodSeconds: 5,
              failureThreshold: 30,
            }),
            readinessProbe: new Probe({
              httpGet: { path: "/health/ready", port: 4000 },
              periodSeconds: 5,
              timeoutSeconds: 4,
              failureThreshold: 6,
            }),
            livenessProbe: new Probe({
              httpGet: { path: "/health", port: 4000 },
              periodSeconds: 30,
              failureThreshold: 3,
            }),
          }),
        ],
      },
    },
  },
});

// `httpsPublicUrl` is read by the ingress seam, which must set
// X-Forwarded-Proto when it is true or every request redirect-loops.
export { httpsPublicUrl };
