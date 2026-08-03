/**
 * The bits both declared workflows need.
 *
 * ci/pipeline.ts and pages/pipeline.ts are separate chant build roots, because
 * `chant build <dir>` collects a directory into one output file and two
 * workflows are two files. That split is about output, not about pins: the
 * checkout SHA and the `just` version should not be able to disagree between
 * them, so they live here and neither file owns them.
 *
 * This directory is deliberately not a build root — nothing here is scanned
 * for resources, and the exports are functions rather than Declarables so
 * there is nothing for a stray build to pick up.
 */

import { Step } from "@intentius/chant-lexicon-github";

/**
 * Actions by commit SHA, not by tag. `actions/checkout@v4` is a moving pointer
 * — whoever controls the tag controls what runs in this repo's CI. chant's
 * GH011 flags it. The tag each resolved from is in the comment so a bump is a
 * one-line diff with something to compare against.
 */
export const CHECKOUT_SHA = "11d5960a326750d5838078e36cf38b85af677262"; // v4

export const SETUP_NODE_SHA = "49933ea5288caeca8642d1e84afbd3f7d6820020"; // v4

export const NODE_VERSION = "24";

export const JUST_VERSION = "1.36.0";

/**
 * `just` is the documented interface, so CI drives the same targets a human
 * does. A pinned release binary rather than `curl | bash`: the install scripts
 * are convenient and resolve to whatever upstream published this morning,
 * which is the drift a pin exists to stop.
 */
export const installJust = (): InstanceType<typeof Step> =>
  new Step({
    name: "Install just",
    run: [
      `curl -fsSL -o /tmp/just.tar.gz https://github.com/casey/just/releases/download/${JUST_VERSION}/just-${JUST_VERSION}-x86_64-unknown-linux-musl.tar.gz`,
      `tar -xzf /tmp/just.tar.gz -C /tmp just`,
      `sudo mv /tmp/just /usr/local/bin/just`,
      `just --version`,
    ].join("\n"),
  });
