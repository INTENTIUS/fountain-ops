/**
 * The published site, declared rather than hand-written.
 *
 * Same rule as ci/pipeline.ts: this repo's infrastructure is chant, a workflow
 * is infrastructure, so it is declared here and `just pages` renders it into
 * .github/workflows/pages.yml. `just ci-check` diffs both rendered files, so a
 * hand edit to either one fails rather than silently winning.
 *
 * It lives in its own directory because `chant build ci` collects everything
 * under ci/ into a single output file. Two workflows are two files, so they
 * are two source directories.
 *
 * ## The site has no content of its own
 *
 * `just site` copies README.md in as the index page. Nothing is duplicated and
 * nothing can drift, because there is exactly one source and it is the file
 * contributors already edit. A docs/ tree that restates the README is the
 * thing this repo keeps having to delete — see #20 and #28 — and a site is a
 * very good way to grow one by accident.
 *
 * GitHub's own jekyll-build-pages action does the rendering, so there is no
 * Gemfile, no bundler, and nothing to keep in step with a Ruby version.
 */

import { Workflow, Job, Step, Checkout } from "@intentius/chant-lexicon-github";
import { CHECKOUT_SHA, installJust } from "../workflows/shared";

/**
 * Actions by commit SHA, not by tag — the same reasoning as ci/pipeline.ts.
 * These four run with `pages: write` and `id-token: write`, so a moved tag
 * here is a moved tag on the credential that publishes the site.
 */
const CONFIGURE_PAGES_SHA = "45bfe0192ca1faeb007ade9deae92b16b8254a0d"; // v6.0.0
const JEKYLL_BUILD_SHA = "44a6e6beabd48582f863aeeb6cb2151cc1716697"; // v1.0.13
const UPLOAD_ARTIFACT_SHA = "fc324d3547104276b827a68afc52ff2a11cc49c9"; // v5.0.0
const DEPLOY_PAGES_SHA = "cd2ce8fcbc39b97be8ca5fce6e763baed58fa128"; // v5.0.0

export const workflow = new Workflow({
  name: "pages",
  on: {
    push: { branches: ["main"] },
    // So the site can be republished without an empty commit — useful the
    // first time Pages is enabled, when there is nothing new to push.
    workflow_dispatch: {},
  },
  // Read-only by default. The write scopes Pages needs live on the deploy job
  // alone — granting them here would hand them to every job in the file,
  // which is what chant's GH lint flags and it is right to.
  permissions: { contents: "read" },
  // One publish at a time, and never cancel one midway — a cancelled deploy
  // can leave the site on a half-published artifact.
  concurrency: { group: "pages", "cancel-in-progress": false },
});

export const build = new Job({
  "runs-on": "ubuntu-latest",
  timeoutMinutes: 10,
  // Assembling and uploading needs to read the repo and read the Pages config
  // for the site URL. It never publishes, so it gets no write scope and no
  // OIDC token.
  permissions: { contents: "read", pages: "read" },
  steps: [
    Checkout({ defaults: { step: { uses: `actions/checkout@${CHECKOUT_SHA}` } } }).step,
    new Step({ name: "Configure Pages", uses: `actions/configure-pages@${CONFIGURE_PAGES_SHA}` }),
    // The site is assembled by the same target a human runs to preview it, so
    // what CI publishes is what they saw — which means the runner needs `just`.
    // Its absence is why the first published run failed at exit 127.
    installJust(),
    new Step({ name: "Assemble the site", run: "just site" }),
    new Step({
      name: "Build with Jekyll",
      uses: `actions/jekyll-build-pages@${JEKYLL_BUILD_SHA}`,
      with: { source: "_site_src", destination: "_site" },
    }),
    new Step({
      name: "Upload the artifact",
      uses: `actions/upload-pages-artifact@${UPLOAD_ARTIFACT_SHA}`,
      with: { path: "_site" },
    }),
  ],
});

export const deploy = new Job({
  needs: "build",
  "runs-on": "ubuntu-latest",
  timeoutMinutes: 10,
  // The only job that publishes: `pages: write` to set the deployment and
  // `id-token: write` for the OIDC token deploy-pages exchanges for it.
  permissions: { contents: "read", pages: "write", "id-token": "write" },
  environment: { name: "github-pages", url: "${{ steps.deployment.outputs.page_url }}" },
  steps: [
    new Step({
      id: "deployment",
      name: "Deploy to GitHub Pages",
      uses: `actions/deploy-pages@${DEPLOY_PAGES_SHA}`,
    }),
  ],
});
