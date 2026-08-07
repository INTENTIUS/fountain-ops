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
import { CHECKOUT_SHA, SETUP_NODE_SHA, NODE_VERSION, K3D_VERSION, installJust } from "../workflows/shared";

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
    // One step, and deliberately so.
    //
    // These assertions used to live here as eight separate workflow steps,
    // which meant the only way to run them was to push. `just check` had
    // always been identical to the check job for exactly this reason — so
    // that what people run locally predicts what CI does — and the e2e half
    // had no such target. It does now, and this calls it rather than
    // restating it, so the two cannot drift.
    //
    // `just e2e` stands up from nothing, asserts readiness through to the
    // database, that a re-run does not rotate the master key, that the app
    // starts without crashing first, that the backup restores and matches
    // live, that the account path works headlessly, that the conversation
    // gate's outcome matches the path it took — reattach implies an orphaned
    // turn, no reattach implies a completed one, and which you get is a race
    // (#67) — and that a real API server accepts every seam. Then it tears
    // down.
    new Step({ name: "Stand it up and assert every claim", run: "just e2e" }),
    // Logs beat a red X with no context, and only when it failed.
    new Step({
      name: "Diagnostics",
      if: "failure()",
      run: [`just status || true`, `kubectl logs -n fountain deployment/fountain --tail=200 || true`].join("\n"),
    }),
    new Step({ name: "Tear down", if: "always()", run: "just down" }),
  ],
});
