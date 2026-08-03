import { Cluster, ObjectStore, ScheduledBackup } from "@intentius/chant-lexicon-k8s";
import {
  namespace,
  size,
  seams,
  tier,
  pgLabels,
  pgStorageSize,
  pgStorageClass,
  cnpgImage,
  backupBucket,
  backupS3Endpoint,
  backupSecretName,
  pitrSchedule,
  backupRetentionDays,
} from "../params";

/**
 * The operator-managed Postgres seam.
 *
 * Where `data/postgres.ts` is a single pod with a volume, this hands the
 * database to CloudNativePG: it owns failover, the primary/replica topology,
 * and — with the barman-cloud plugin — a WAL stream that makes point-in-time
 * recovery possible.
 *
 * This is the only postgres mode that can honestly back tier="ha", because it
 * is the only one where more than one instance means anything.
 *
 * The operator and the plugin must already be installed on the cluster. chant
 * declares the custom resources; it does not install controllers.
 */

/**
 * Where base backups and archived WAL live.
 *
 * Declared whenever PITR is on, and only then — an ObjectStore with nothing
 * archiving into it is a bucket that looks like a backup.
 */
export const objectStore =
  seams.backups === "barman-pitr"
    ? new ObjectStore({
        metadata: { name: "fountain-backups", namespace, labels: pgLabels },
        spec: {
          // The plugin prunes base backups and WAL past this after each base
          // backup. Comes from the tier, because retention is durability.
          retentionPolicy: `${backupRetentionDays}d`,
          configuration: {
            destinationPath: `s3://${backupBucket}/barman`,
            endpointURL: backupS3Endpoint,
            s3Credentials: {
              accessKeyId: { name: backupSecretName, key: "AWS_ACCESS_KEY_ID" },
              secretAccessKey: { name: backupSecretName, key: "AWS_SECRET_ACCESS_KEY" },
            },
            wal: { compression: "gzip" },
            data: { compression: "gzip" },
          },
        },
      })
    : undefined;

/**
 * The Postgres cluster.
 *
 * `instances` follows the tier: one at light, two at ha. CNPG
 * replicates and fails over between them, which is the thing a bundled
 * Postgres cannot do at any replica count.
 */
export const pgCluster =
  seams.postgres === "cnpg"
    ? new Cluster({
        metadata: { name: "fountain-pg", namespace, labels: pgLabels },
        spec: {
          instances: tier.replicas,
          imageName: cnpgImage,
          // Attaching this rolls the Postgres pods. At instances: 1 that is a
          // brief outage — the app's readiness probe drains and recovers, but
          // it is not free, so it is only attached when PITR is actually on.
          //
          // `isWALArchiver` must stay a boolean. Quoted, the plugin ignores it,
          // archiving is off, and the cluster looks entirely healthy until
          // someone needs a restore.
          plugins:
            seams.backups === "barman-pitr"
              ? [
                  {
                    name: "barman-cloud.cloudnative-pg.io",
                    isWALArchiver: true,
                    // Names the ObjectStore above. Nothing upstream checks this
                    // string; a typo archives into nowhere, silently.
                    parameters: { barmanObjectName: "fountain-backups" },
                  },
                ]
              : undefined,
          bootstrap: {
            initdb: {
              database: "fountain",
              owner: "fountain",
            },
          },
          storage: { storageClass: pgStorageClass, size: pgStorageSize },
          // No CPU limit, deliberately: a limit throttles a database, and the
          // pause lands on whatever query held the lock.
          resources: {
            requests: { cpu: size.cpu, memory: size.memory },
            limits: { memory: size.memoryLimit },
          },
        },
      })
    : undefined;

/**
 * The nightly base backup.
 *
 * PITR needs both halves: the WAL stream is continuous, but replaying it needs
 * a base to replay against, and recovery time grows with the WAL accumulated
 * since the last one. A WAL archive with no base backup is not a backup.
 */
export const pgScheduledBackup =
  seams.backups === "barman-pitr"
    ? new ScheduledBackup({
        metadata: { name: "fountain-pg-base", namespace, labels: pgLabels },
        spec: {
          // SIX fields, leading with seconds — not the five a Kubernetes
          // CronJob takes. The five-field form is accepted and means something
          // else entirely, so this is validated in lib/seams.ts rather than
          // trusted.
          schedule: pitrSchedule,
          backupOwnerReference: "self",
          cluster: { name: "fountain-pg" },
          method: "plugin",
          pluginConfiguration: { name: "barman-cloud.cloudnative-pg.io" },
        },
      })
    : undefined;
