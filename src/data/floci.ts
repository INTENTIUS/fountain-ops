import { Deployment, Service, Container } from "@intentius/chant-lexicon-k8s";
import { namespace, seams, backupS3Endpoint, flociImage, flociLabels } from "../params";

/**
 * floci — an S3-compatible bucket, emulated in the cluster.
 *
 * The backup seam is an endpoint and a bucket. That is the whole reason it can
 * be emulated: the CronJob issues the same `aws s3 cp` and the same
 * `list-objects-v2` either way and cannot tell the difference, so a local run
 * exercises the real upload-verify-prune path rather than a stub of it.
 *
 * The default at `target=k3d`, because the alternative is a backup job that
 * uploads nowhere.
 *
 * ## Why in the cluster, and not on your laptop
 *
 * floci normally runs on the host, and `backupS3Endpoint` used to default to
 * `http://localhost:4566` to match. From inside a pod `localhost` is the pod,
 * so that endpoint could never reach it — the upload container would have been
 * talking to itself. It is the kind of default that looks right in a diff and
 * has never once worked, and it is why the backup row said "emitted, never
 * run" without saying that it could not have.
 *
 * In the cluster, the address is a Service name that resolves from where the
 * job actually runs, and `just up` gives you a working backup path with nothing
 * else to install.
 *
 * ## What it is not
 *
 * Durable. Everything floci holds is in one pod with no volume, so a restart is
 * an empty bucket. That is fine for exercising the path and is why `seams.ts`
 * refuses to let it hold the backups of an `ha` deployment — a backup
 * destination that forgets is worse than none, because it looks like one.
 */

const on = seams.storage === "floci";

/**
 * Where the backup job uploads. Derived in params.ts, because the CronJob reads
 * it and importing this module from there would be a cycle.
 */
export const flociEndpoint = on ? backupS3Endpoint : undefined;

export const flociDeployment = on
  ? new Deployment({
      metadata: { name: "fountain-floci", namespace, labels: flociLabels },
      spec: {
        replicas: 1,
        selector: { matchLabels: flociLabels },
        template: {
          metadata: { labels: flociLabels },
          spec: {
            // Start as the uid the image wants rather than letting it get
            // there itself. Its entrypoint switches to `floci` (1001) when it
            // starts as root, and that switch needs SETUID/SETGID — dropped
            // below — so it exits 1 with `failed switching to "floci":
            // operation not permitted`. Starting there already is the same
            // shape as the bundled Postgres two files over, and for the same
            // reason.
            securityContext: { runAsNonRoot: true, runAsUser: 1001, runAsGroup: 0 },
            containers: [
              new Container({
                name: "floci",
                image: flociImage,
                imagePullPolicy: "IfNotPresent",
                ports: [{ containerPort: 4566, name: "s3" }],
                securityContext: { capabilities: { drop: ["ALL"] }, allowPrivilegeEscalation: false },
                // A bucket nobody has written to still answers, so readiness is
                // the socket rather than a shaped request — anything cleverer
                // would be asserting on the emulator's own API surface here
                // instead of in the backup job, which is where it belongs.
                readinessProbe: {
                  tcpSocket: { port: 4566 },
                  initialDelaySeconds: 2,
                  periodSeconds: 5,
                },
                livenessProbe: {
                  tcpSocket: { port: 4566 },
                  initialDelaySeconds: 15,
                  periodSeconds: 30,
                },
                resources: {
                  requests: { cpu: "50m", memory: "128Mi" },
                  limits: { memory: "512Mi" },
                },
              }),
            ],
          },
        },
      },
    })
  : undefined;

export const flociService = on
  ? new Service({
      metadata: { name: "fountain-floci", namespace, labels: flociLabels },
      spec: {
        type: "ClusterIP",
        selector: flociLabels,
        ports: [{ name: "s3", port: 4566, targetPort: 4566, protocol: "TCP" }],
      },
    })
  : undefined;
