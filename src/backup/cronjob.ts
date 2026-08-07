import { CronJob } from "@intentius/chant-lexicon-k8s";
import {
  namespace,
  seams,
  secretName,
  backupSchedule,
  backupRetentionDays,
  backupBucket,
  backupS3Endpoint,
  labels,
} from "../params";

/**
 * Nightly logical backup to any S3-compatible bucket.
 *
 * The ordering is the point, and it is why this is two containers rather than
 * one script: dump to completion first, upload only a size-checked artifact,
 * verify the uploaded size, and prune old backups only after a verified
 * upload. A failed run can then never delete a good backup or leave a
 * truncated one looking valid — a truncated dump that uploads cleanly is worse
 * than a failed job, because it looks like a backup.
 *
 * And the standing rule this cannot enforce: a database backup alone cannot
 * decrypt itself. MASTER_SECRETS_KEY has to be backed up separately, and a
 * restore needs the same key the dump was written under.
 *
 * A backup nobody has restored is a hypothesis.
 */

const retention = String(backupRetentionDays);

export const backup =
  seams.backups === "pg-dump"
    ? new CronJob({
        metadata: { name: "fountain-pg-backup", namespace, labels },
        spec: {
          // Off the hour so it does not pile onto other cluster crons.
          schedule: backupSchedule,
          concurrencyPolicy: "Forbid",
          successfulJobsHistoryLimit: 3,
          failedJobsHistoryLimit: 5,
          // If the cluster is down at the scheduled time, still run on
          // recovery — once, not a stampede of missed runs.
          startingDeadlineSeconds: 3600,
          jobTemplate: {
            spec: {
              backoffLimit: 2,
              template: {
                spec: {
                  restartPolicy: "OnFailure",
                  securityContext: { runAsNonRoot: true, runAsUser: 999, fsGroup: 999 },
                  volumes: [
                    // Bounded so a runaway dump cannot fill the node.
                    { name: "work", emptyDir: { sizeLimit: "2Gi" } },
                  ],
                  initContainers: [
                    {
                      name: "dump",
                      image: "postgres:16",
                      // Both of these are set on the app and the bundled
                      // Postgres already; this container was the one that
                      // missed them. pg_dump reads over a connection string
                      // and writes to an emptyDir, so it needs no capability
                      // at all.
                      imagePullPolicy: "IfNotPresent",
                      securityContext: { capabilities: { drop: ["ALL"] }, allowPrivilegeEscalation: false },
                      command: ["/bin/bash", "-c"],
                      args: [
                        `set -euo pipefail
TS="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
OUT="/work/fountain-\${TS}.dump"
pg_dump -Fc -Z6 --no-owner --no-privileges -f "$OUT" "$DATABASE_URL"
ls -lh "$OUT"
SIZE=$(stat -c %s "$OUT")
if [ "$SIZE" -lt 10240 ]; then echo "FAIL: dump is only \${SIZE} bytes, refusing to upload"; exit 1; fi
echo "$OUT" > /work/latest`,
                      ],
                      env: [
                        // The same URL the app uses, FROM THE SAME SOURCE —
                        // which is not always the platform Secret. At
                        // postgres=cnpg the operator mints fountain-pg-app
                        // and the platform Secret's DATABASE_URL names the
                        // bundled service, which does not exist; a dump over
                        // it fails on DNS after the schedule fires, which is
                        // the worst place to learn your backup never ran.
                        // Mirrors app/deployment.ts's databaseUrl exactly.
                        seams.postgres === "cnpg"
                          ? { name: "DATABASE_URL", valueFrom: { secretKeyRef: { name: "fountain-pg-app", key: "uri" } } }
                          : { name: "DATABASE_URL", valueFrom: { secretKeyRef: { name: secretName, key: "DATABASE_URL" } } },
                      ],
                      volumeMounts: [{ name: "work", mountPath: "/work" }],
                      resources: { requests: { cpu: "50m", memory: "128Mi" }, limits: { memory: "512Mi" } },
                    },
                  ],
                  containers: [
                    {
                      name: "upload",
                      image: "amazon/aws-cli:2.31.19",
                      // Both were missing here and nothing said so: the "dump"
                      // container above sits behind a block-scalar args, and
                      // until chant 0.41.14 the post-synth parser lost every
                      // container after one of those — so this container was
                      // never checked at all (INTENTIUS/chant#1482). The fix
                      // that made the checker see it again is what surfaced
                      // these.
                      imagePullPolicy: "IfNotPresent",
                      securityContext: { capabilities: { drop: ["ALL"] }, allowPrivilegeEscalation: false },
                      command: ["/bin/sh", "-c"],
                      args: [
                        `set -eu
if [ "\${S3_FORCE_PATH_STYLE:-false}" = "true" ]; then
  printf '[default]\\ns3 =\\n    addressing_style = path\\n' > /work/aws-config
  export AWS_CONFIG_FILE=/work/aws-config
fi
ENDPOINT_ARGS=""
if [ -n "\${S3_ENDPOINT:-}" ]; then ENDPOINT_ARGS="--endpoint-url \${S3_ENDPOINT}"; fi
FILE="$(cat /work/latest)"; BASE="$(basename "$FILE")"
DEST="s3://\${BUCKET}/pg_dump/\${BASE}"
aws $ENDPOINT_ARGS s3 cp --no-progress "$FILE" "$DEST"
LOCAL=$(stat -c %s "$FILE")
REMOTE=$(aws $ENDPOINT_ARGS s3api list-objects-v2 --bucket "$BUCKET" --prefix "pg_dump/\${BASE}" --query "Contents[?Key=='pg_dump/\${BASE}'].Size | [0]" --output text)
if [ "$LOCAL" != "$REMOTE" ]; then echo "FAIL: size mismatch after upload"; exit 1; fi
CUTOFF=$(date -u -d "-\${RETENTION_DAYS} days" +%Y-%m-%d)
aws $ENDPOINT_ARGS s3api list-objects-v2 --bucket "$BUCKET" --prefix "pg_dump/" --query "Contents[?LastModified<'\${CUTOFF}'].Key" --output text | tr "\\t" "\\n" | grep -v "^$" | grep -v "^None$" | while read -r KEY; do aws $ENDPOINT_ARGS s3api delete-object --bucket "$BUCKET" --key "$KEY"; done || true
echo "Backup complete: \${DEST}"`,
                      ],
                      env: [
                        { name: "RETENTION_DAYS", value: retention },
                        { name: "BUCKET", value: backupBucket },
                        { name: "S3_ENDPOINT", value: backupS3Endpoint },
                        // Emulated stores serve path-style only.
                        { name: "S3_FORCE_PATH_STYLE", value: backupS3Endpoint ? "true" : "false" },
                      ],
                      // Credentials for the bucket. Same Secret, same rule:
                      // nothing secret-shaped is declared in source.
                      envFrom: [{ secretRef: { name: secretName } }],
                      volumeMounts: [{ name: "work", mountPath: "/work" }],
                      resources: { requests: { cpu: "50m", memory: "128Mi" }, limits: { memory: "512Mi" } },
                    },
                  ],
                },
              },
            },
          },
        },
      })
    : undefined;
