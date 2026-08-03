import { InfisicalSecret } from "@intentius/chant-lexicon-k8s";
import {
  namespace,
  seams,
  labels,
  secretName,
  infisicalHostApi,
  infisicalIdentityId,
  infisicalProjectSlug,
  infisicalEnvSlug,
  infisicalSecretsPath,
  infisicalServiceAccount,
  infisicalResyncSeconds,
} from "../params";

/**
 * The external-secrets seam.
 *
 * This is the one resource in the repo that exists to say where a value comes
 * from without ever carrying it. Every field below is policy — which server,
 * which identity, which scope, what happens to the materialized Secret when
 * this is deleted. That is why it can live in source at all.
 *
 * With this seam on, `just secret` stops being how the platform secret is
 * created. The operator materializes it from Infisical instead, and the
 * Deployment's envFrom does not change — it reads the same Secret name either
 * way, which is the whole point of the seam.
 *
 * The operator must already be installed on the cluster.
 */
export const infisicalSecret =
  seams.secrets === "infisical"
    ? new InfisicalSecret({
        metadata: { name: secretName, namespace, labels },
        spec: {
          hostAPI: infisicalHostApi,
          // Seconds, and a number. Quoted, the operator rejects the resource.
          resyncInterval: infisicalResyncSeconds,
          authentication: {
            // Kubernetes-native auth: no stored credential anywhere. The
            // operator presents a ServiceAccount token, which is the thing
            // that stops this from being a secret needed to fetch secrets.
            kubernetesAuth: {
              identityId: infisicalIdentityId,
              autoCreateServiceAccountToken: true,
              serviceAccountRef: { name: infisicalServiceAccount, namespace },
              secretsScope: {
                projectSlug: infisicalProjectSlug,
                envSlug: infisicalEnvSlug,
                secretsPath: infisicalSecretsPath,
              },
            },
          },
          managedSecretReference: {
            secretName,
            secretNamespace: namespace,
            // Orphan, not Owner, and the difference matters on the day someone
            // deletes this resource: Owner takes the materialized Secret with
            // it, and every pod reading that Secret fails on next restart.
            // Orphan also lets the operator adopt a Secret `just secret`
            // already minted, which is what a migration onto this seam looks
            // like.
            creationPolicy: "Orphan",
          },
        },
      })
    : undefined;
