/**
 * fountain-ops's own CI, declared rather than hand-written.
 *
 * The repo's rule is that its infrastructure is chant. A CI pipeline is
 * infrastructure, so it is declared here and `just ci` renders it into
 * .github/workflows/ci.yml. The rendered file is committed — GitHub reads YAML
 * from the default branch, not TypeScript — and `just ci-check` fails if the
 * committed copy has drifted from this source.
 *
 * Two jobs, split by what they need:
 *
 *   check  no Docker. Typecheck, lint, test, build. Fast enough to gate on.
 *   e2e    stands the whole thing up on k3d and proves it serves, which is the
 *          claim the README makes and the only way to keep it true.
 *
 * Every tool is a pinned release binary rather than `curl | bash`. The install
 * scripts are convenient and they resolve to whatever upstream published this
 * morning, which is the drift a pin exists to stop (and what #13 is about).
 */

import {
  Workflow,
  Job,
  Step,
  Checkout,
  SetupNode,
} from "@intentius/chant-lexicon-github";
import { CHECKOUT_SHA, SETUP_NODE_SHA, NODE_VERSION, installJust } from "../workflows/shared";

/** Pinned to the version #1394 pins for the k3d lexicon. One number, one place. */
const K3D_VERSION = "v5.9.0";

/**
 * Actions by commit SHA, not by tag.
 *
 * `actions/checkout@v4` is a moving pointer — whoever controls the tag controls
 * what runs in this repo's CI. chant's own GH011 check flags it, and it would
 * have been inconsistent to pin the tool binaries below and leave these
 * floating. The tags these resolved from are in the comments so a bump is a
 * one-line diff with something to compare against.
 */

export const workflow = new Workflow({
  name: "fountain-ops",
  on: {
    push: { branches: ["main"] },
    pull_request: { branches: ["main"] },
  },
  permissions: { contents: "read" },
});

export const check = new Job({
  "runs-on": "ubuntu-latest",
  timeoutMinutes: 10,
  steps: [
    Checkout({ defaults: { step: { uses: `actions/checkout@${CHECKOUT_SHA}` } } }).step,
    SetupNode({
      nodeVersion: NODE_VERSION,
      cache: "npm",
      defaults: { step: { uses: `actions/setup-node@${SETUP_NODE_SHA}` } },
    }).step,
    installJust(),
    new Step({ name: "Install", run: "npm ci" }),
    // The same chain `just check` runs locally. If these ever diverge, the
    // thing people run before pushing stops predicting what CI does.
    new Step({ name: "Check", run: "just check" }),
    // The rendered workflow must match this file. Without it, editing
    // .github/workflows/ci.yml by hand silently wins and the declaration
    // becomes decoration.
    new Step({ name: "CI is not hand-edited", run: "just ci-check" }),
  ],
});

export const e2e = new Job({
  "runs-on": "ubuntu-latest",
  timeoutMinutes: 20,
  steps: [
    Checkout({ defaults: { step: { uses: `actions/checkout@${CHECKOUT_SHA}` } } }).step,
    SetupNode({
      nodeVersion: NODE_VERSION,
      cache: "npm",
      defaults: { step: { uses: `actions/setup-node@${SETUP_NODE_SHA}` } },
    }).step,
    installJust(),
    new Step({
      name: "Install k3d",
      run: [
        `curl -fsSL -o /tmp/k3d https://github.com/k3d-io/k3d/releases/download/${K3D_VERSION}/k3d-linux-amd64`,
        `chmod +x /tmp/k3d`,
        `sudo mv /tmp/k3d /usr/local/bin/k3d`,
        `k3d version`,
      ].join("\n"),
    }),
    new Step({ name: "Install", run: "npm ci" }),
    new Step({ name: "Preflight", run: "just doctor" }),
    // The README's central claim: this stands up from nothing and serves.
    // `just up` ends on an in-cluster probe of /health, so a green run here
    // means the getting-started path still works.
    new Step({ name: "Stand it up", run: "just up" }),
    // /health only proves the process is alive. /health/ready proves it
    // reached Postgres, which is the half that actually breaks.
    new Step({
      name: "Readiness, including the database",
      run: [
        `kubectl run ready --rm -i --restart=Never -n fountain \\`,
        `  --image=curlimages/curl:8.11.1 --quiet -- \\`,
        `  curl -fsS -m 10 http://fountain.fountain.svc.cluster.local/health/ready \\`,
        `  | tee /dev/stderr | grep -q '"database":"ok"'`,
      ].join("\n"),
    }),
    // Re-running is the documented recovery advice, and the secret check is
    // the one with real consequences: a regenerated MASTER_SECRETS_KEY makes
    // every stored secret unrecoverable and looks like a successful deploy.
    new Step({
      name: "Re-running up does not rotate the secret",
      run: [
        `before=$(kubectl get secret fountain-secrets -n fountain -o jsonpath='{.data.MASTER_SECRETS_KEY}')`,
        `just up`,
        `after=$(kubectl get secret fountain-secrets -n fountain -o jsonpath='{.data.MASTER_SECRETS_KEY}')`,
        `test "$before" = "$after"`,
      ].join("\n"),
    }),
    // Every seam that needs a CRD, validated against a real API server rather
    // than against our own expectations. No controllers, so nothing reconciles
    // — that gap is fountain-ops#22.
    new Step({ name: "Install the operator CRDs", run: "just crds" }),
    new Step({
      name: "A real API server accepts every seam",
      run: [
        `just dry-run --param postgres=cnpg --param backups=barman-pitr \\`,
        `  --param ingress=traefik --param tls=cert-manager \\`,
        `  --param secrets=infisical --param monitoring=prometheus-operator \\`,
        `  --param scheme=https --param host=fountain.ci.example.com`,
      ].join("\n"),
    }),
    // Logs beat a red X with no context, and only when it failed.
    new Step({
      name: "Diagnostics",
      if: "failure()",
      run: [`just status || true`, `kubectl logs -n fountain deployment/fountain --tail=200 || true`].join("\n"),
    }),
    new Step({ name: "Tear down", if: "always()", run: "just down" }),
  ],
});
