/**
 * `k8s` is a real config key and `ChantConfig` does not declare it.
 *
 * chant's k8s lexicon exports `K8sChantConfig` for a `k8s` block in
 * chant.config.ts — it is what binds `--env <name>` to a cluster context, and
 * the lexicon reads it at runtime. But `ChantConfig` in @intentius/chant 0.38.0
 * has no `k8s` property and no index signature, so `satisfies ChantConfig`
 * rejects the very block the lexicon asks for:
 *
 *   error TS2353: Object literal may only specify known properties,
 *   and 'k8s' does not exist in type 'ChantConfig'.
 *
 * Declaration merging rather than dropping `satisfies` or casting: the rest of
 * the config keeps its typecheck, and this file says out loud that the gap is
 * upstream's rather than hiding it behind an `as`.
 *
 * Filed as INTENTIUS/chant#1455. Delete this when the core type carries the key.
 */
import type { K8sChantConfig } from "@intentius/chant-lexicon-k8s";

declare module "@intentius/chant" {
  interface ChantConfig {
    k8s?: K8sChantConfig;
  }
}
