import { Deployment, Container, Probe } from "@intentius/chant-lexicon-k8s";
import { namespace, image, publicUrl, hostname, httpsPublicUrl, tier, size, seams, databaseSsl, secretName, emailDelivery, otelTraces, registrationEnabled, firstUserAdmin, pgImage, cnpgImage, labels } from "../params";
import { spritzerBaseUrl } from "../data/spritzer";

/**
 * The fountain server.
 *
 * The probe split is the part worth reading before changing anything:
 *
 *   startup    holds the others off while boot-time migrations run. Fountain
 *              migrates on every start, under an advisory lock, before the
 *              endpoint listens. 150s of headroom.
 *
 *              The advisory lock is only true from v0.7.0 (fountain#610).
 *              Before it, the lock was a row lock on `schema_migrations`,
 *              which cannot serialize the creation of that table itself — so
 *              at `ha` (replicas: 2) against a *fresh* database both replicas
 *              entered the migrator at once and the loser died on
 *              `pg_type_typname_nsp_index`, restarted, and succeeded. That is
 *              the benign `RESTARTS 1` on a first `ha` deploy that reads
 *              exactly like a crash loop. Unverified here either way: k3d is
 *              refused at `ha`, so this path has never run in `just e2e`.
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

// Only set when the emulator is the data plane. Left unset the Sprites client
// falls back to its own default, so absent means "the real API" without this
// file having to name it.
const spritzerEnv = spritzerBaseUrl ? [{ name: "SPRITES_BASE_URL", value: spritzerBaseUrl }] : [];

const clusteringPorts = tier.clustered
  ? [
      { containerPort: 4369, name: "epmd" },
      { containerPort: 9100, name: "erldist" },
    ]
  : [];

// cnpg: the operator generates a Secret carrying a ready-made connection URI.
// bundled and reference: the URL is one more key in the Secret, because a
// connection string with a password in it is not config. For bundled, whatever
// writes the Secret also points it at the in-cluster service.
const databaseUrl =
  seams.postgres === "cnpg"
    ? { name: "DATABASE_URL", valueFrom: { secretKeyRef: { name: "fountain-pg-app", key: "uri" } } }
    : { name: "DATABASE_URL", valueFrom: { secretKeyRef: { name: secretName, key: "DATABASE_URL" } } };

/**
 * Wait for the bundled Postgres before starting the app.
 *
 * Both Deployments are applied in the same `kubectl apply`, so without this the
 * app races a database that is still pulling its image. fountain migrates at
 * boot, before the endpoint listens; the migration cannot get a connection,
 * raises, and the release exits 1. Kubernetes restarts it and the third attempt
 * wins — so `just up` goes green while `kubectl get pods` shows RESTARTS 2 and
 * `just logs` shows an Ecto stacktrace on a deployment that is actually fine.
 *
 * The probe split below does not help: the process exits before any probe is
 * consulted, and `kubectl rollout status` reads the end state without caring
 * how many attempts it took to get there.
 *
 * For `bundled` and `cnpg` both; only `reference` goes without, and that is
 * not an oversight:
 *
 *   cnpg       first shipped without the wait, reasoning that the pod cannot
 *              start until `fountain-pg-app` exists — a Secret the operator
 *              creates when it bootstraps the cluster — and that
 *              CreateContainerConfigError is already a wait. It is, but for
 *              the wrong moment: the operator writes the Secret well before
 *              the primary accepts connections, so the app started into the
 *              gap and restarted two or three times per replica on every
 *              first boot. Observed standing `k3d`+`ha` up from nothing; the
 *              probe below against `fountain-pg-rw` is what closed it.
 *   reference  the database is somebody else's and presumed up. There is
 *              nothing to probe either: the host is inside DATABASE_URL, which
 *              is a Secret and not a build-time value.
 */
const pgWaitHost = seams.postgres === "cnpg" ? "fountain-pg-rw" : "fountain-postgres";
const waitForPostgres =
  seams.postgres === "bundled" || seams.postgres === "cnpg"
    ? [
        new Container({
          name: "wait-for-postgres",
          // The image the database already pulls — postgres for bundled, the
          // CNPG build of it for cnpg — so this costs no extra pull, and
          // pg_isready is the tool that ships in both.
          image: seams.postgres === "cnpg" ? cnpgImage : pgImage,
          imagePullPolicy: "IfNotPresent",
          command: ["/bin/sh", "-c"],
          // `-U fountain` is load-bearing and not a stylistic echo of the
          // database's own probe. With no -U, libpq falls back to the OS
          // user's name, and this runs as uid 1001, which has no /etc/passwd
          // entry in the postgres image. pg_isready cannot resolve a name,
          // makes no attempt, and exits 3 — "no attempt", not "not ready" —
          // for a database that is up and accepting connections.
          //
          // The failure that costs you an afternoon: it looks exactly like a
          // database that never came up, and the wait then burns its full
          // timeout and fails the pod, which is worse than the crashloop this
          // replaced. Verified against a live cluster both ways.
          args: [
            `set -eu
for i in $(seq 1 180); do
  if pg_isready -q -U fountain -h ${pgWaitHost} -p 5432; then
    echo "postgres is accepting connections"
    exit 0
  fi
  sleep 1
done
echo "postgres did not accept connections within 180s" >&2
echo "check:  ${seams.postgres === "cnpg" ? `kubectl get cluster.postgresql.cnpg.io -n ${namespace} fountain-pg` : `kubectl logs -n ${namespace} deployment/fountain-postgres`}" >&2
exit 1`,
          ],
          securityContext: {
            runAsNonRoot: true,
            runAsUser: 1001,
            readOnlyRootFilesystem: true,
            allowPrivilegeEscalation: false,
            capabilities: { drop: ["ALL"] },
          },
          // No CPU limit: this sleeps in a loop, and throttling a readiness
          // wait only makes the thing it is waiting on look slower.
          resources: { requests: { cpu: "10m", memory: "32Mi" }, limits: { memory: "64Mi" } },
        }),
      ]
    : [];

export const deployment = new Deployment({
  metadata: { name: "fountain", namespace, labels },
  spec: {
    replicas: tier.replicas,
    strategy: { type: "RollingUpdate", rollingUpdate: { maxSurge: 1, maxUnavailable: 0 } },
    selector: { matchLabels: labels },
    template: {
      metadata: { labels },
      spec: {
        initContainers: waitForPostgres,
        containers: [
          new Container({
            name: "fountain",
            image,
            imagePullPolicy: "IfNotPresent",
            ports: [{ containerPort: 4000, name: "http" }, { containerPort: 9568, name: "metrics" }, ...clusteringPorts],
            env: [
              { name: "PHX_SERVER", value: "true" },
              { name: "PORT", value: "4000" },
              { name: "PUBLIC_URL", value: publicUrl },
              // A hostname, not an authority. Phoenix's url: [host: ...] rejects
              // "localhost:4000" and logs it on every boot.
              { name: "PHX_HOST", value: hostname },
              // fountain refuses to boot without a mail decision. Discarding
              // verification mail silently would dead-end signup with no
              // visible error, so it makes you say so — "none" is a real
              // answer, absent is not.
              { name: "EMAIL_DELIVERY", value: emailDelivery },
              // Off unless asked for. Upstream also defaults to off since
              // v0.4.0 (fountain#317), so this is explicitness now, not the
              // workaround it started as. See params.ts.
              { name: "OTEL_TRACES_EXPORTER", value: otelTraces },
              // The subscription gate is a lock with no key on a self-hosted
              // instance unless Stripe is configured. Upstream defaults it off
              // since v0.4.0; stated anyway, because the gate being off is a
              // property of this deployment, not an inherited default.
              { name: "BILLING_ENABLED", value: "false" },
              // An instance on the public internet with registration open will
              // be found. Close it once you have your account.
              { name: "REGISTRATION_ENABLED", value: registrationEnabled },
              // First verified account becomes the admin while none exists
              // (fountain ADR 0011) — register before exposing the instance.
              // Images ≤ v0.4.0 ignore this; see params.ts.
              { name: "FIRST_USER_ADMIN", value: firstUserAdmin },
              // Defaults from the seam and is settable — a referenced Postgres
              // that serves no TLS is an ordinary thing and used to be
              // unexpressible. See params.ts.
              { name: "DATABASE_SSL", value: databaseSsl },
              databaseUrl,
              ...clusteringEnv,
              // The whole data plane seam, on the app's side. Unset, the client
              // defaults to https://api.sprites.dev; set, it talks to the
              // emulator in this namespace. Nothing else about the app changes,
              // which is what makes the local path exercise the real one.
              ...spritzerEnv,
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
              requests: { cpu: size.cpu, memory: size.memory },
              limits: { cpu: size.cpuLimit, memory: size.memoryLimit },
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
