/**
 * The fountain image pin, and the only place it lives.
 *
 * Two files need this value and both used to spell it out: chant.config.ts
 * declares it as the `image` build parameter's default, and params.ts carries
 * the same string as the fallback behind that declaration. Two literals, one
 * of them invisible from the docs, and nothing that could notice them
 * disagreeing — so the pin sat at `v0.7.0` nine releases after upstream moved
 * on, and `just up` stood up an instance with no team roster, no teammate
 * schedules, no webhook endpoints and no sandboxes routes, against docs that
 * describe all four ([#119](https://github.com/INTENTIUS/fountain-ops/issues/119)).
 *
 * Same rule as `workflows/shared.ts`'s K3D_VERSION: a pin stays honest only
 * while there is exactly one place it lives. The version is alone on its line
 * because the `image-pin` workflow rewrites that line when upstream publishes
 * a release newer than this one — see `image-pin/pipeline.ts`.
 *
 * A pin, never a floating tag. `latest` would make two `just up` runs a week
 * apart two different applications, and the failure that follows would look
 * like a bug in whatever you changed in between.
 */

/** The upstream release this repo deploys by default. */
export const FOUNTAIN_VERSION = "v0.21.0";

/**
 * The registry path moved with the repository. BinaryBourbon/fountain became
 * managoat/fountain, and releases after v0.16.0 publish only to
 * ghcr.io/managoat/fountain: ghcr.io/binarybourbon/fountain has no v0.17.0 or
 * later, so a version bump that kept the old path pinned an image nothing can
 * pull. The bare tag is the bundled distribution; `-core` tags drop the
 * extensions (Buzz, the connection providers) and are not what this deploys.
 */
export const FOUNTAIN_IMAGE = `ghcr.io/managoat/fountain:${FOUNTAIN_VERSION}`;
