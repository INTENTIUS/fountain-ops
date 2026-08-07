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
- How a conversation turn *ends* against the emulator varies by fountain
  release and is being actively worked on upstream. `just verify-conversation`
  reports which ending it observed; do not chase the ending, and do not add
  assertions about it.

## Things that will waste your time if edited directly

- `.github/workflows/*.yml` are rendered from `ci/`, `pages/` and
  `e2e-k8s/` TypeScript declarations — edit those and run `just ci`;
  `just ci-check` fails CI on a hand edit.
- `dist/` is build output. The docs pages under `docs-site/` are source.
- The roadmap is [the issues](https://github.com/INTENTIUS/fountain-ops/issues);
  there is no roadmap file to update.
