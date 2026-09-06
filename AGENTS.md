# For agents

The shortest correct path, and the things that will waste your time. The
[docs site](https://intentius.io/fountain-ops/) has the paragraphs;
[status](https://intentius.io/fountain-ops/status/) is authoritative over
anything written in the present tense anywhere else, this file included.

## The path

- `just doctor` first, always. It ends on the literal next command.
- `just up` is the entry point; `just down` deletes the whole throwaway
  cluster, so failure recovery is cheap — re-running `up` is safe and never
  rotates the secret.
- Build parameters go through the variable, not positionally:
  `just params="--param tier=ha" up`.
- `just check` is literally CI's check job and `just e2e` its e2e job. Run
  `check` before proposing any change; `e2e` before claiming a deploy-path
  change works.
- Registration is `POST /api/auth/register` — no browser needed — and the
  instance's first verified account becomes the admin, so register before
  exposing anything.

## Things that look like breakage and are not

- Every recipe that touches a cluster refuses a kube context other than
  `k3d-fountain-local`. The refusal is a guard, not a bug;
  `ALLOW_FOREIGN_CLUSTER=1` is the deliberate override.
- At `tier=ha` on a brand-new database, one replica may show `RESTARTS 1`,
  once: both replicas race to create the migrations table and the loser's
  retry wins ([#90](https://github.com/INTENTIUS/fountain-ops/issues/90)).
  At `light`, any restart is a real finding.
- A conversation turn against the emulator fails at the ACP handshake, every
  time: fountain speaks ACP to its runtimes from v0.9.0 and spritzer 0.5.0
  answers `initialize is not supported`. `just verify-conversation` asserts
  everything up to that and names the refusal. Do not chase the ending — it is
  spritzer's to give back — and do not add assertions about it.

## Things that will waste your time if edited directly

- `.github/workflows/*.yml` are rendered from `ci/`, `pages/`, `e2e-k8s/`
  and `image-pin/` TypeScript declarations — edit those and run `just ci`;
  `just ci-check` fails CI on a hand edit.
- The fountain image pin is `FOUNTAIN_VERSION` in `src/lib/fountain-image.ts`
  and nowhere else. `image-pin` opens a PR when upstream moves; taking that PR
  means reading the releases and running `just e2e`, not merging it.
- `dist/` is build output. The docs pages under `docs-site/` are source.
- The roadmap is [the issues](https://github.com/INTENTIUS/fountain-ops/issues);
  there is no roadmap file to update.
