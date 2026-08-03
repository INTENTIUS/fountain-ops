import type { ChantConfig } from "@intentius/chant";

/**
 * Self-hosted fountain, deployed by chant.
 *
 * Two axes decide what this project emits:
 *
 *   tier   — how much fountain you are running (light / production / production-ha)
 *   seams  — who provides each dependency (postgres, secrets, ingress, tls, backups, metrics)
 *
 * Every seam has a mode that works with the k8s lexicon as it ships today, so
 * this deploys now. The modes that need CRDs chant does not generate yet are
 * listed in each seam's enum and rejected at build time with a pointer, rather
 * than emitting something that would not apply.
 */

const env = process.env.FOUNTAIN_ENV ?? "dev";

export default {
  lexicons: ["k8s", "temporal"],

  // Whole-project discovery (bare `chant lifecycle diff|snapshot`) stays inside
  // src/ so it never walks ops/ or test/ fixtures. Per-stack builds pass their
  // own path and are unaffected.
  sourceDir: "src",

  // One environment per invocation — the same single-deployment-at-a-time
  // convention the params below follow.
  environments: [env],

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

    // ── tier ──────────────────────────────────────────────────────────────
    // light          1 replica, no clustering, external Postgres
    // production     1 replica, CNPG, backups, metrics, TLS
    // production-ha  2+ replicas WITH Erlang clustering (see lib/tiers.ts —
    //                more replicas without it silently breaks conversation
    //                streaming, so the tier carries the wiring, not a number)
    tier: {
      type: "string",
      enum: ["local", "light", "minimal-cloud", "production", "production-ha"],
      default: "local",
      env: "FOUNTAIN_TIER",
    },
    replicas: { type: "number", required: false },

    // ── seams ─────────────────────────────────────────────────────────────
    // Unset means "take the tier's default" — see src/lib/tiers.ts. Setting one
    // replaces exactly that seam and leaves the rest of the tier profile alone,
    // so there is no default here to disagree with the tier's.
    //
    // `reference` means "it already exists, here is how to reach it".
    // `omit` means "this deployment does not have one".
    postgres: { type: "string", enum: ["reference", "cnpg"], required: false },
    secrets: { type: "string", enum: ["reference", "infisical"], required: false },
    ingress: { type: "string", enum: ["omit", "ingress", "traefik"], required: false },
    tls: { type: "string", enum: ["omit", "cert-manager"], required: false },
    backups: { type: "string", enum: ["omit", "pg-dump", "barman-pitr"], required: false },
    monitoring: { type: "string", enum: ["omit", "prometheus-operator"], required: false },

    // ── seam inputs ───────────────────────────────────────────────────────
    // postgres=reference: nothing here — DATABASE_URL lives in the Secret,
    // because a connection string with a password in it is not config.
    // postgres=cnpg:
    pgStorageClass: { type: "string", required: false },
    pgStorageSize: { type: "string", default: "10Gi" },
    pgImage: { type: "string", default: "ghcr.io/cloudnative-pg/postgresql:18.4-standard-trixie" },
    // secrets=reference: the name of the Secret you created out of band.
    secretName: { type: "string", default: "fountain-secrets" },
    // secrets=infisical:
    infisicalProjectSlug: { type: "string", required: false },
    infisicalEnvSlug: { type: "string", default: "prod" },
    infisicalIdentityId: { type: "string", required: false },
    infisicalHostApi: { type: "string", required: false },
    // tls=cert-manager:
    clusterIssuer: { type: "string", default: "letsencrypt-production" },
    // ingress=ingress:
    ingressClassName: { type: "string", required: false },
    // backups:
    backupSchedule: { type: "string", default: "17 3 * * *" },
    backupRetentionDays: { type: "number", default: 14 },
    backupBucket: { type: "string", required: false },
    backupS3Endpoint: { type: "string", required: false },
  },
} satisfies ChantConfig;
