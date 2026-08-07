/**
 * The kubernetes-target loop in CI: on demand, and on every merge to main.
 *
 * `just e2e-k8s` proves target=kubernetes light and ha on a three-node
 * stand-in it creates and deletes itself. Running it on pull requests would
 * add a second cluster and ~6 minutes to every push, which is why it is not
 * in ci.yml — but a loop only a laptop runs is a loop that rots. So this
 * workflow runs it where merges land (push to main) and whenever someone
 * presses the button (workflow_dispatch).
 *
 * Same discipline as ci/pipeline.ts: actions by commit SHA, tools as pinned
 * release binaries, and the one step calls the just recipe rather than
 * restating it, so the laptop run and the CI run cannot drift.
 */

import { Workflow, Job, Step, Checkout, SetupNode } from "@intentius/chant-lexicon-github";
import { CHECKOUT_SHA, SETUP_NODE_SHA, NODE_VERSION, installJust } from "../workflows/shared";

/** The same pin ci/pipeline.ts uses — and the version the k3d lexicon types. */
const K3D_VERSION = "v5.9.0";

export const workflow = new Workflow({
  name: "e2e-k8s",
  on: {
    push: { branches: ["main"] },
    workflow_dispatch: {},
  },
  permissions: { contents: "read" },
});

export const e2eK8s = new Job({
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
    new Step({ name: "Prove the kubernetes rows", run: "just e2e-k8s" }),
    // The recipe leaves the stand-in up on failure so a human can look; a CI
    // runner is about to evaporate, so grab the picture first, then delete.
    new Step({
      name: "Diagnostics",
      if: "failure()",
      run: [
        `kubectl --context k3d-fountain-k8s-stand-in get pods -A || true`,
        `kubectl --context k3d-fountain-k8s-stand-in logs -n fountain deployment/fountain --tail=200 || true`,
      ].join("\n"),
    }),
    new Step({ name: "Tear down", if: "always()", run: "k3d cluster delete fountain-k8s-stand-in || true" }),
  ],
});
