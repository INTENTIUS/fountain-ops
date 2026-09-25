/**
 * The one thing nothing was watching: the fountain image pin.
 *
 * Every other pin in this repo has a reader that would notice it moving —
 * `just doctor` prints CI's k3d version next to the installed one, `ci-check`
 * diffs the rendered workflows, the lockfile is a diff in review. The image
 * default had none, so it sat at `v0.7.0` while upstream shipped nine
 * releases, and `just up` handed people an instance missing the team roster,
 * teammate schedules, webhook endpoints and the sandboxes routes that the docs
 * on the same page describe
 * ([#119](https://github.com/INTENTIUS/fountain-ops/issues/119)).
 *
 * So this workflow is the reader. Weekly, and on demand: read the pin out of
 * src/lib/fountain-image.ts, ask GitHub for fountain's latest release, and if
 * they differ, open one pull request that moves the pin.
 *
 * What it deliberately does not do:
 *
 *   - merge anything. A pin bump is a deploy-path change, and this repo's bar
 *     for one is a full `just e2e` against the new image plus whatever the
 *     release notes changed underneath us — see the v0.6.1 -> v0.7.0 commit
 *     for the shape of that work. The PR is the prompt to do it, not the work.
 *   - touch the docs. The pin is quoted in prose that a `sed` would wreck, so
 *     the PR body lists the files that still name the old version and leaves
 *     them to a human.
 *   - nag. One open PR per upstream release: if the branch already exists, the
 *     run is a no-op, so a bump somebody has decided not to take yet stays
 *     decided.
 *
 * The PR is opened with GITHUB_TOKEN, and GitHub deliberately does not start
 * workflow runs on pushes made with it — so the bump PR arrives with no CI on
 * it. That is by design upstream, not a misconfiguration here; the body says
 * how to get a run.
 */

import { Workflow, Job, Step, Checkout, github } from "@intentius/chant-lexicon-github";
import { CHECKOUT_SHA } from "../workflows/shared";

/** Where the pin lives, and the line shape the bump edits. Both are asserted. */
const PIN_FILE = "src/lib/fountain-image.ts";
const PIN_CONST = "FOUNTAIN_VERSION";

/** Upstream. The image is published from this repo's releases. */
const UPSTREAM = "managoat/fountain";

export const workflow = new Workflow({
  name: "image-pin",
  on: {
    // Monday morning, off the hour — a queue of jobs all asking for the same
    // minute is how a cron job becomes a cron job that sometimes does not run.
    schedule: [{ cron: "17 6 * * 1" }],
    workflow_dispatch: {},
  },
  permissions: { contents: "read" },
});

export const checkPin = new Job({
  "runs-on": "ubuntu-latest",
  timeoutMinutes: 10,
  // Write scopes on the one job that needs them, the same way pages.yml keeps
  // its publish credential off every other job in the file.
  permissions: { contents: "write", "pull-requests": "write" },
  steps: [
    Checkout({ defaults: { step: { uses: `actions/checkout@${CHECKOUT_SHA}` } } }).step,
    new Step({
      name: "Open a bump PR if the pin is behind",
      run: [
        `set -euo pipefail`,
        ``,
        `# Exported here rather than declared in the step's \`env\`, because the`,
        `# github serializer lower-cases env keys and \`gh_token\` authenticates`,
        `# nothing. Worth undoing upstream; wrong to work around silently.`,
        `export GH_TOKEN="${github.token}"`,
        ``,
        `# The pin is read out of the file rather than out of a workflow`,
        `# variable, because a second copy of the version here would be the`,
        `# exact bug this workflow exists to catch.`,
        `pinned="$(sed -n 's/^export const ${PIN_CONST} = "\\(.*\\)";$/\\1/p' ${PIN_FILE})"`,
        `if [ -z "$pinned" ]; then`,
        `  echo "::error file=${PIN_FILE}::${PIN_CONST} is not one line of the shape this workflow edits. Fix the line or fix image-pin/pipeline.ts."`,
        `  exit 1`,
        `fi`,
        ``,
        `latest="$(gh api repos/${UPSTREAM}/releases/latest --jq .tag_name)"`,
        `echo "pinned $pinned, latest $latest"`,
        ``,
        `if [ "$pinned" = "$latest" ]; then`,
        `  echo "  ✓ the pin is the current release"`,
        `  exit 0`,
        `fi`,
        ``,
        `# A release is not an image. The tag is published by a separate upstream`,
        `# workflow and lands minutes later, so a PR raised on the release alone`,
        `# can pin something nothing can pull. Anonymous pull scope is enough to`,
        `# ask. The registry path comes out of the same file as the version.`,
        `repo="$(sed -n 's|^export const FOUNTAIN_IMAGE = .ghcr.io/\\(.*\\):.*|\\1|p' ${PIN_FILE})"`,
        `ghcr="$(curl -fsS "https://ghcr.io/token?service=ghcr.io&scope=repository:$repo:pull" | jq -r .token)"`,
        `code="$(curl -sS -o /dev/null -w '%{http_code}' -I -H "Authorization: Bearer $ghcr" \\`,
        `  -H "Accept: application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json" \\`,
        `  "https://ghcr.io/v2/$repo/manifests/$latest")"`,
        `if [ "$code" != "200" ]; then`,
        `  echo "::warning::$repo:$latest is not on the registry yet (manifest HTTP $code) — no PR for a tag nothing can pull. Next run will retry."`,
        `  exit 0`,
        `fi`,
        ``,
        `branch="image-pin/$latest"`,
        `if git ls-remote --exit-code --heads origin "$branch" >/dev/null 2>&1; then`,
        `  echo "  · $branch already exists — this bump has already been raised"`,
        `  exit 0`,
        `fi`,
        ``,
        `sed -i "s|^export const ${PIN_CONST} = \\"$pinned\\";|export const ${PIN_CONST} = \\"$latest\\";|" ${PIN_FILE}`,
        `if git diff --quiet -- ${PIN_FILE}; then`,
        `  echo "::error::the pin edit changed nothing"`,
        `  exit 1`,
        `fi`,
        ``,
        `# Everything else that still names the old version, so the PR says what`,
        `# is left rather than pretending one line was the whole job.`,
        `stale="$(git grep -l -F "$pinned" -- ':!'${PIN_FILE} || true)"`,
        ``,
        `cat > /tmp/pr-body.md <<BODY`,
        `fountain $latest is out and this repo's default image pin is $pinned.`,
        ``,
        `This PR moves the one line the pin lives on. It is the prompt for the`,
        `bump, not the bump: nothing here has been stood up.`,
        ``,
        `Before merging:`,
        ``,
        `- Read https://github.com/${UPSTREAM}/releases — what changed between`,
        `  $pinned and $latest that this repo sets, asserts or documents.`,
        `- \\\`just e2e\\\` against the new pin, from nothing. This is a deploy-path`,
        `  change and that is the bar for one.`,
        `- Update the prose that quotes the pin, and re-attribute rather than`,
        `  restate any evidence measured at $pinned. Files still naming it:`,
        ``,
        `\\\`\\\`\\\``,
        `$stale`,
        `\\\`\\\`\\\``,
        ``,
        `Opened by .github/workflows/image-pin.yml, rendered from`,
        `image-pin/pipeline.ts. It runs weekly and will not raise this bump`,
        `again while the branch exists — close this without deleting the branch`,
        `to decline it.`,
        ``,
        `CI has not run on this PR and will not: GitHub does not start workflow`,
        `runs for pushes made with GITHUB_TOKEN. Close and reopen it, or push to`,
        `the branch, to get one.`,
        `BODY`,
        ``,
        `git config user.name "github-actions[bot]"`,
        `git config user.email "41898282+github-actions[bot]@users.noreply.github.com"`,
        `git checkout -b "$branch"`,
        `git commit -am "fountain $pinned -> $latest: the default pin catches up"`,
        `git push origin "$branch"`,
        `gh pr create --title "fountain $pinned -> $latest: the default pin catches up" --body-file /tmp/pr-body.md --base main --head "$branch"`,
      ].join("\n"),
    }),
  ],
});
