import { Deployment, Service, PersistentVolumeClaim, Container } from "@intentius/chant-lexicon-k8s";
import { namespace, seams, secretName, pgStorageSize, pgImage, pgLabels } from "../params";

/**
 * A single-instance Postgres in the cluster, for substrates that have no
 * operator and do not want one.
 *
 * This is deliberately the least interesting Postgres that works: one pod, one
 * volume, no failover, no WAL archiving. On k3d that is exactly right — the
 * point is a database to develop against, and `seams.ts` refuses to let this
 * back an `ha` deployment so nobody mistakes it for one.
 *
 * A Deployment rather than a StatefulSet: with one replica and one claim there
 * is nothing a StatefulSet buys, and `Recreate` avoids two pods briefly
 * sharing a ReadWriteOnce volume during a rollout.
 *
 * Credentials come from the same Secret the app reads. The app's DATABASE_URL
 * has to agree with them, which is why both are written together by whatever
 * provisions the Secret rather than being two places to keep in step.
 */

const on = seams.postgres === "bundled";

export const pgClaim = on
  ? new PersistentVolumeClaim({
      metadata: { name: "fountain-postgres", namespace, labels: pgLabels },
      spec: {
        accessModes: ["ReadWriteOnce"],
        resources: { requests: { storage: pgStorageSize } },
      },
    })
  : undefined;

export const pgDeployment = on
  ? new Deployment({
      metadata: { name: "fountain-postgres", namespace, labels: pgLabels },
      spec: {
        replicas: 1,
        // One volume, one writer. Never two pods at once.
        strategy: { type: "Recreate" },
        selector: { matchLabels: pgLabels },
        template: {
          metadata: { labels: pgLabels },
          spec: {
            // Run as the postgres uid from the start, with fsGroup so the
            // volume is already owned. The image otherwise starts as root to
            // chown its data dir and drop privileges itself — which needs
            // CHOWN/SETUID/SETGID, so dropping ALL capabilities without this
            // makes it fail with "Operation not permitted" on first boot.
            securityContext: { runAsNonRoot: true, runAsUser: 999, runAsGroup: 999, fsGroup: 999 },
            containers: [
              new Container({
                name: "postgres",
                image: pgImage,
                imagePullPolicy: "IfNotPresent",
                ports: [{ containerPort: 5432, name: "postgres" }],
                env: [
                  { name: "POSTGRES_DB", value: "fountain" },
                  { name: "POSTGRES_USER", value: "fountain" },
                  { name: "POSTGRES_PASSWORD", valueFrom: { secretKeyRef: { name: secretName, key: "POSTGRES_PASSWORD" } } },
                  // The image initialises into a subdirectory when the mount
                  // point is not empty — a lost+found on some volumes is
                  // enough to break initdb without this.
                  { name: "PGDATA", value: "/var/lib/postgresql/data/pgdata" },
                ],
                volumeMounts: [{ name: "data", mountPath: "/var/lib/postgresql/data" }],
                securityContext: { capabilities: { drop: ["ALL"] }, allowPrivilegeEscalation: false },
                readinessProbe: {
                  exec: { command: ["pg_isready", "-U", "fountain", "-d", "fountain"] },
                  initialDelaySeconds: 5,
                  periodSeconds: 5,
                },
                // Checks the process, not the database — the same reasoning as
                // the app's own liveness probe.
                livenessProbe: {
                  tcpSocket: { port: 5432 },
                  initialDelaySeconds: 30,
                  periodSeconds: 30,
                },
                resources: {
                  requests: { cpu: "100m", memory: "256Mi" },
                  limits: { memory: "1Gi" },
                },
              }),
            ],
            // pgClaim.name, not the string it happens to equal: the reference
            // is what puts a Deployment→PVC edge in the graph (#84), and the
            // serializer resolves it to the identical literal. The assertion
            // is safe — both declarations share the same seam guard.
            volumes: [{ name: "data", persistentVolumeClaim: { claimName: pgClaim!.name } }],
          },
        },
      },
    })
  : undefined;

export const pgService = on
  ? new Service({
      metadata: { name: "fountain-postgres", namespace, labels: pgLabels },
      spec: {
        type: "ClusterIP",
        selector: pgLabels,
        ports: [{ name: "postgres", port: 5432, targetPort: 5432, protocol: "TCP" }],
      },
    })
  : undefined;
