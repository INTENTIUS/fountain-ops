import { ApplyOp } from "@intentius/chant-lexicon-temporal";

/**
 * The deploy, as an Op: build → plan → apply against the local cluster.
 *
 * `just up` already does this and more, and this does not replace it. What an
 * Op adds is a handle something other than a terminal can pull — behold reads
 * `ops/` and puts a Run button on it, streaming Build → Plan (a live diff) →
 * Apply, which is the difference between looking at the estate and operating
 * it. The first entry in an `ops/` directory that has been empty since the
 * repo started, and the first row of #3.
 *
 * ## Why `local` only
 *
 * The env binds to a cluster in chant.config.ts, and only `local` is bound —
 * an Op is a thing that reaches out and changes something, so it should be
 * unambiguous which cluster it changes. Pointing this at an unbound env would
 * apply to whatever kubectl context happened to be ambient, which is the
 * accident #45 was about, with writes instead of reads.
 *
 * ## `delete: "owned-only"`
 *
 * Prune is scoped to the ownership marker, so it removes what this project
 * declared and stopped declaring, and never touches a resource it did not put
 * there. That marker is why the justfile exports FOUNTAIN_ENV=local: an Op
 * that prunes on `env=local` while the deployed resources are stamped `dev`
 * would either delete nothing or, worse, be pointed at a set it does not own.
 *
 * ## Not gated
 *
 * A gated apply needs Temporal for the durable approval wait; ungated runs on
 * the local one-shot executor with nothing to install. Gating belongs on the
 * Ops that can destroy something — `rotate-master-key` and a destructive
 * apply, per #3 and #8 — and this one applies a Deployment to a laptop.
 */
const { op } = ApplyOp({
  name: "fountain-apply",
  env: "local",
  target: "kubectl",
  output: "fountain.yaml",
  delete: "owned-only",
});

export default op;
