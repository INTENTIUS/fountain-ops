import { phase, healthGate, shell, type Component, type Phase } from "@intentius/chant/components";
import { namespace, seams } from "./params";

/**
 * The deployment as a dependency graph, rather than as eleven flat resources.
 *
 * `chant build` emits Kubernetes objects and nothing about them says which
 * must exist before which. That ordering is real — the app migrates against
 * Postgres at boot, the backup dumps over a connection string and uploads to a
 * bucket — and until it was written down the only place it existed was the
 * order of targets in `just up`.
 *
 * What reads this: `chant graph --components` projects one node per component
 * with `dependsOn` as edges, which is what behold's components and composites
 * zooms draw. Before this file both rendered empty, and composites (defined as
 * resources plus component-dependency edges) silently fell back to the
 * resources view — INTENTIUS/behold#131.
 *
 * Components follow the seams, so the graph describes the deployment that was
 * built rather than every deployment that could be. A component whose seam is
 * off is `undefined` and is not discovered, the same way its resources are.
 *
 * That last part does not work yet, and the reason is worth knowing before
 * trusting this graph: component discovery ignores `--param`, so
 * `chant graph --components --param backups=omit` still lists `backup` even
 * though the CronJob is not emitted. The resource build honours the same flag
 * correctly. INTENTIUS/chant#1490.
 *
 * So today this reads as the DEFAULT-seam graph regardless of what was built.
 * The conditionals below are written the way they will need to be, rather than
 * flattened to match the bug, because flattening them would have to be undone
 * and would be wrong for every non-default build the day it is fixed.
 *
 * ## Why the deploy phases are waits
 *
 * chant's capability set covers build, publish and verification. It has no
 * "apply a manifest" verb, because that is not how this project applies: one
 * `kubectl apply` puts the whole estate on the cluster, via `just apply` or
 * the ApplyOp in `ops/`. So a component's `deploy` here is the part that is
 * genuinely per-component — how you know that piece came up — and every phase
 * below is something `just up` already does.
 */

const inNamespace = `${namespace}.svc.cluster.local`;

/**
 * Every in-cluster dependency announces readiness the same way, so the phase
 * that checks it is written once.
 *
 * chant's capability set has no non-HTTP readiness verb. Postgres answers a
 * pg_isready exec probe, the S3 emulator and the sandbox API serve their own
 * protocols and no health path, so none of them can be expressed with
 * waitEndpoint or healthGate. `shell` is the sanctioned escape hatch and takes
 * a reason for exactly this case.
 *
 * This is the same command `just wait` and `just storage-init` already run, so
 * the component graph and the local loop cannot disagree about what "up" means.
 */
function rolloutReady(deployment: string, protocol: string, timeout = "120s"): Phase {
  return phase("Ready", [
    shell({
      cmd: `kubectl rollout status deployment/${deployment} -n ${namespace} --timeout=${timeout}`,
      reason: `${protocol}; the capability set has no non-HTTP readiness verb`,
    }),
  ]);
}

/**
 * The database. Nothing else in the estate can be checked before this one.
 *
 * `bundled` and `cnpg` are both this component: the seam changes which
 * resources back it, not what it is or what depends on it. `reference` is
 * somebody else's database, so there is no component to deploy — the seam
 * means "it already exists".
 */
export const postgres: Component | undefined =
  seams.postgres === "reference"
    ? undefined
    : {
        name: "postgres",
        dependsOn: [],
        // The declared entities this component owns (chant#1491) — what joins
        // a component to its resources by NAME rather than by naming
        // convention. behold's composites zoom reads these off the component
        // IR (INTENTIUS/behold#138); without them the [name] fallback claims
        // nothing and the zoom degrades to the resources view.
        liveNames: seams.postgres === "bundled" ? ["pgDeployment", "pgService", "pgClaim"] : ["pgCluster"],
        // CNPG names its primary differently and the operator owns the
        // rollout, so the wait is only meaningful for the bundled Deployment.
        deploy:
          seams.postgres === "bundled"
            ? [rolloutReady("fountain-postgres", "Postgres readiness is a pg_isready exec probe")]
            : [phase("Ready", [shell({
                cmd: `kubectl wait --for=condition=Ready cluster/fountain-pg -n ${namespace} --timeout=300s`,
                reason: "CNPG reports readiness as a custom-resource condition, which no capability covers",
              })])],
      };

/**
 * The backup bucket.
 *
 * Only a component when it is emulated. `storage=s3` is a real bucket someone
 * else owns and this project never creates, which is a dependency rather than
 * a thing to deploy.
 */
export const storage: Component | undefined =
  seams.storage === "floci"
    ? {
        name: "storage",
        dependsOn: [],
        liveNames: ["flociDeployment", "flociService"],
        // `just storage-init` waits on exactly this before creating the
        // bucket: `aws s3 mb` against a floci that is not up yet fails in a
        // way that reads like a credentials problem.
        deploy: [rolloutReady("fountain-floci", "the S3 emulator serves S3, not a health path", "180s")],
      }
    : undefined;

/**
 * The sandbox API the app provisions against.
 *
 * `sprites` is the real service and is not deployed here, so only the emulator
 * is a component.
 */
export const dataPlane: Component | undefined =
  seams.dataPlane === "spritzer"
    ? {
        name: "data-plane",
        dependsOn: [],
        liveNames: ["spritzerDeployment", "spritzerService"],
        deploy: [rolloutReady("fountain-spritzer", "spritzer serves the Sprites API, not a health path")],
      }
    : undefined;

/**
 * The fountain server.
 *
 * Depends on the database because it migrates at boot, before the endpoint
 * listens — the ordering `src/app/deployment.ts`'s initContainer enforces on
 * the cluster. Depends on the data plane because a conversation provisions a
 * sandbox through it; the app boots without it and cannot do the thing it is
 * for.
 *
 * Not dependent on storage: only the backup writes there.
 */
export const fountain: Component = {
  name: "fountain",
  dependsOn: [postgres, dataPlane].filter((c): c is Component => c !== undefined).map((c) => c.name),
  liveNames: ["deployment", "service", "ns"],
  deploy: [
    phase("Ready", [
      // /health/ready, not /health. The first says the release booted; the
      // second says it reached Postgres, which is the half that breaks.
      healthGate({
        path: "/health/ready",
        host: `http://fountain.${inNamespace}`,
        consecutiveSuccesses: 2,
      }),
    ]),
  ],
};

/**
 * The nightly dump.
 *
 * The only component that needs both halves: it reads the database over the
 * connection string and writes the artifact to the bucket. That pairing is the
 * one piece of ordering in this estate that is not obvious from the manifests,
 * which is most of the reason this file is worth having.
 *
 * `barman-pitr` is CNPG's own scheduled backup rather than this CronJob, and
 * it is reconciled by the operator, so there is nothing here to wait on.
 */
export const backup: Component | undefined =
  seams.backups === "pg-dump"
    ? {
        name: "backup",
        dependsOn: [postgres, storage].filter((c): c is Component => c !== undefined).map((c) => c.name),
        liveNames: ["backup"],
        deploy: [
          phase("Scheduled", [
            shell({
              cmd: `kubectl get cronjob fountain-pg-backup -n ${namespace}`,
              // A CronJob has no rollout and no endpoint. Its existence is the
              // whole deploy-time claim; whether the backup is any good is
              // `just restore-drill`, which is a different question and is
              // asserted separately in `just e2e`.
              reason: "a CronJob has no rollout or endpoint; existence is the only deploy-time check",
            }),
          ]),
        ],
      }
    : undefined;
