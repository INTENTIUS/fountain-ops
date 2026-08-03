import type { ChantConfig } from "@intentius/chant";

/**
 * Self-hosted fountain, deployed by chant.
 *
 * Two axes decide what this project emits:
 *
 *   target — where the substrate runs (k3d / kubernetes)
 *   tier   — how durable it is (light / standard / ha)
 *   seams  — who provides each dependency (postgres, secrets, ingress, tls, backups, metrics)
 *
 * They are separate questions: a tier does not imply a target, or the reverse.
 * The target picks coherent seam defaults; the tier scales the deployment and
 * never changes what fountain can do.
 *
 * Separate is not the same as freely combinable. A tier is refused on a target
 * whose default seams cannot support it -- k3d defaults to the bundled
 * single-instance Postgres, so k3d + ha is a build error until postgres is set
 * explicitly. Six combinations, five of which build.
 *
 * Every seam mode is expressible against the k8s lexicon as it ships. What is
 * rejected at build time is an incoherent combination -- a "highly available"
 * single Postgres, a WAL archive with nothing archiving into it -- because
 * those apply cleanly and then mean something other than they say.
 */

const env = process.env.FOUNTAIN_ENV ?? "dev";

export default {
  lexicons: ["k8s", "temporal", "github"],

  // Whole-project discovery (bare `chant lifecycle diff|snapshot`) stays inside
  // src/ so it never walks ops/ or test/ fixtures. Per-stack builds pass their
  // own path and are unaffected.
  sourceDir: "src",

  // One environment per invocation — the same single-deployment-at-a-time
  // convention the params below follow.
  environments: [env],

  // Every resource module here reads a value that comes out of a function --
  // resolveTier, targetShape, resolveSeams -- so the static folder can never
  // fold any of them and falls back to running each one. That fallback is the
  // correct outcome and it is also the design: the refusals in lib/ are
  // executable checks, not literals.
  //
  // Left on, chant reports the fallback once per file, thirteen times, in a
  // nested "is not foldable" format that reads like an error to anyone seeing
  // it for the first time. Declaring the intent removes all thirteen and the
  // built output is byte-identical.
  build: { fold: false },

  // Labels every emitted resource with app.kubernetes.io/managed-by=chant plus
  // the stack and env identity, so `--owned` filtering, drift and the
  // owned-only prune all have something to key on.
  ownership: { stack: "fountain", env },

  lint: {
    rules: {
      // A Kubernetes manifest IS a nested object — spec.template.spec.containers
      // is the shape, not an accident. COR001 wants each nested value extracted
      // to its own exported const, which for a Deployment means a dozen exports
      // that exist only to satisfy the rule and make the manifest harder to
      // read against the upstream YAML it mirrors. Off, deliberately.
      COR001: "off",
      // Manifest files export resources for the build to collect, not for each
      // other. "Never referenced in this file" is the normal case here.
      COR004: "off",
      // Postgres writes to its data directory and the backup job writes a dump
      // to its work volume. A read-only root filesystem is right for the app
      // tier, which has one, and wrong for these two.
      WK8203: "off",
      // A CPU limit throttles rather than protects: under contention the
      // database gets slower instead of shedding load, and a stalled dump is a
      // missing backup. Requests are set; limits are deliberate omissions.
      WK8201: "off",
      // "consider at least 2 replicas for high availability" asks for the one
      // thing this repo refuses to let you do. The replica count comes from
      // the tier, and above one replica fountain's pods must form an Erlang
      // cluster — so resolveTier makes two replicas at light or standard a
      // build error, and the bundled Postgres is a single instance by
      // definition. At tier=ha the count is already 2 and the rule is silent.
      // A warning nobody can act on trains people to ignore warnings.
      WK8302: "off",
    },
  },

  buildParams: {
    // ── identity ──────────────────────────────────────────────────────────
    env: { type: "string", default: "dev", env: "FOUNTAIN_ENV" },
    namespace: { type: "string", default: "fountain" },
    // The externally-visible host, and the scheme it is reached over. PUBLIC_URL
    // is derived from the pair rather than declared whole: the host on its own
    // is what the ingress rule and the certificate SAN need, and splitting a URL
    // back apart in source is a function call, which nothing can fold.
    //
    // scheme=https is not cosmetic — it turns on fountain's HTTPS redirect,
    // HSTS and secure cookies, so whatever terminates TLS must set
    // X-Forwarded-Proto or every request looks like http and redirect-loops.
    host: { type: "string", default: "localhost:4000" },
    scheme: { type: "string", enum: ["http", "https"], default: "http" },
    image: { type: "string", default: "ghcr.io/binarybourbon/fountain:v0.3.0" },

    // ── the two axes ──────────────────────────────────────────────────────
    // Separate questions, and not a free grid: k3d + ha is refused, because
    // k3d's default bundled Postgres cannot back it. See src/lib/targets.ts.
    //
    // target — where the substrate runs. Picks coherent seam defaults for that
    //          substrate and nothing else.
    target: {
      type: "string",
      enum: ["k3d", "kubernetes"],
      default: "k3d",
      env: "FOUNTAIN_TARGET",
    },
    // tier — how durable the deployment is. Scales the same deployment; never
    //        changes what fountain can do. `ha` carries the Erlang clustering
    //        its replica count requires — see src/lib/tiers.ts.
    tier: {
      type: "string",
      enum: ["light", "standard", "ha"],
      default: "light",
      env: "FOUNTAIN_TIER",
    },
    replicas: { type: "number", required: false },

    // ── seams ─────────────────────────────────────────────────────────────
    // Unset means "take the target's default" — see src/lib/tiers.ts. Setting one
    // replaces exactly that seam and leaves the rest of the tier profile alone,
    // so there is no default here to disagree with the tier's.
    //
    // `reference` means "it already exists, here is how to reach it".
    // `omit` means "this deployment does not have one".
    postgres: { type: "string", enum: ["reference", "bundled", "cnpg"], required: false },
    secrets: { type: "string", enum: ["reference", "infisical"], required: false },
    ingress: { type: "string", enum: ["omit", "ingress", "traefik"], required: false },
    tls: { type: "string", enum: ["omit", "cert-manager"], required: false },
    backups: { type: "string", enum: ["omit", "pg-dump", "barman-pitr"], required: false },
    monitoring: { type: "string", enum: ["omit", "prometheus-operator"], required: false },
    // Where the sandboxes agents run in come from. "spritzer" is an emulator
    // of the Sprites API running in the cluster — the local default, because
    // offline there is no account and a placeholder token against the real
    // API is a 401 nobody sees until they talk to an agent.
    dataPlane: { type: "string", enum: ["sprites", "spritzer"], required: false },

    // ── seam inputs ───────────────────────────────────────────────────────
    // postgres=reference: nothing here — DATABASE_URL lives in the Secret,
    // because a connection string with a password in it is not config.
    // postgres=cnpg:
    pgStorageSize: { type: "string", default: "10Gi" },
    pgImage: { type: "string", default: "postgres:16" },
    // secrets=reference: the name of the Secret you created out of band.
    secretName: { type: "string", default: "fountain-secrets" },
    // secrets=infisical:
    infisicalProjectSlug: { type: "string", required: false },
    infisicalEnvSlug: { type: "string", default: "prod" },
    infisicalIdentityId: { type: "string", required: false },
    infisicalHostApi: {
      type: "string",
      default: "http://infisical.infisical.svc.cluster.local:8080",
    },
    infisicalSecretsPath: { type: "string", default: "/" },
    infisicalServiceAccount: { type: "string", default: "fountain-infisical" },
    infisicalResyncSeconds: { type: "number", default: 60 },
    // fountain refuses to boot without a mail decision — see src/app/deployment.ts.
    emailDelivery: { type: "string", enum: ["none", "resend", "smtp"], default: "none" },
    registrationEnabled: { type: "string", enum: ["true", "false"], default: "true" },
    // tls=cert-manager:
    clusterIssuer: { type: "string", default: "letsencrypt-production" },
    // ingress=ingress:
    ingressClassName: { type: "string", required: false },
    // backups:
    backupSchedule: { type: "string", default: "17 3 * * *" },
    // Unset takes the tier's retention — it is durability, not a seam input.
    backupRetentionDays: { type: "number", required: false },
    backupBucket: { type: "string", default: "fountain-backups" },
    backupS3Endpoint: { type: "string", required: false },

    // ── cnpg seam ────────────────────────────────────────────────────────
    cnpgImage: { type: "string", default: "ghcr.io/cloudnative-pg/postgresql:16.4" },
    // dataPlane=spritzer. Pinned rather than :latest — the emulator decides
    // what a local conversation does, so a floating tag would change what a
    // green run means with nothing in this repo changing.
    spritzerImage: { type: "string", default: "ghcr.io/intentius/spritzer:0.4.1" },
    // Unset means the cluster's default StorageClass, which is what k3d wants.
    pgStorageClass: { type: "string", required: false },
    backupSecretName: { type: "string", default: "fountain-backup-s3-credentials" },
    // SIX fields, leading with seconds. Separate from backupSchedule, which is
    // the five-field CronJob form — one parameter for two dialects would put a
    // valid-looking schedule in the wrong one every time a seam flipped.
    pitrSchedule: { type: "string", default: "0 47 2 * * *" },

    // ── traefik seam ─────────────────────────────────────────────────────
    traefikMiddlewareNamespace: { type: "string", required: false },
  },
} satisfies ChantConfig;
