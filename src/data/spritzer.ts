import { Deployment, Service, Container, ServiceAccount, Role, RoleBinding } from "@intentius/chant-lexicon-k8s";
import { namespace, seams, spritzerImage, spritzerLabels, spritzerExec, spritzerSpriteImage } from "../params";

/**
 * spritzer — the Sprites API, emulated in the cluster.
 *
 * fountain reaches its data plane, the sandboxed VMs agents run in, through one
 * credential and one base URL. spritzer implements enough of that API to
 * satisfy the client, so pointing fountain at it is a configuration change and
 * not a fork: `SPRITES_BASE_URL` moves and nothing else does. The app cannot
 * tell the difference, which is the point — a local run exercises the real
 * control-plane path rather than a stub of it.
 *
 * The default at `target=k3d`, because offline there is no Sprites account, and
 * a placeholder token pointed at the real API is not a data plane. It is a 401
 * nobody discovers until they try to talk to an agent.
 *
 * ## Container mode
 *
 * From spritzer 0.6.0 (`spritzerExec=container`, the default here) a sprite is
 * a pod in this namespace running `spritzerSpriteImage`, and exec runs the
 * real command in it. That is what lets a turn complete: fountain's ACP
 * runtime is a real process that answers `initialize`, where the interpreter
 * below answered -32601. spritzer needs a ServiceAccount that can create,
 * read, delete and exec into pods in its own namespace, and nothing
 * cluster-wide. Sprite pods run as root, so a namespace under the restricted
 * Pod Security Standard rejects them; spritzer's own pod stays non-root with a
 * read-only root filesystem. Checkpoints answer 501 in this mode
 * (INTENTIUS/spritzer#23).
 *
 * ## What the interpreter is not
 *
 * An agent runtime. spritzer holds sprites, their filesystems and their
 * checkpoints in memory and runs a small scripted exec interpreter — `echo`,
 * `cat`, `rm`, and an echo-back default. Three things are absent and no
 * configuration brings them back:
 *
 *   - live model reasoning
 *   - real tool execution inside the sandbox
 *   - true VM isolation
 *
 * So a green local run is a plumbing check. It says fountain can provision a
 * sandbox, address it and stream from it. It says nothing about how an agent
 * behaves, and it is not a place to judge sandbox security.
 *
 * ## Why it is stateless here
 *
 * Everything spritzer holds is in memory, so a restart is a clean slate and
 * there is nothing to persist. That is also why `seams.ts` refuses to let it
 * back an `ha` deployment: one pod holding every sandbox is not what "highly
 * available" says.
 */

const on = seams.dataPlane === "spritzer";
const container = on && spritzerExec === "container";

/** Container mode only: the identity spritzer creates sprite pods as. */
export const spritzerServiceAccount = container
  ? new ServiceAccount({ metadata: { name: "fountain-spritzer", namespace, labels: spritzerLabels } })
  : undefined;

/** Pods and pods/exec in this namespace — what spritzer's container runtime calls, and nothing more. */
export const spritzerRole = container
  ? new Role({
      metadata: { name: "fountain-spritzer-sprites", namespace, labels: spritzerLabels },
      rules: [
        { apiGroups: [""], resources: ["pods"], verbs: ["create", "get", "list", "watch", "delete"] },
        { apiGroups: [""], resources: ["pods/exec"], verbs: ["create", "get"] },
      ],
    })
  : undefined;

export const spritzerRoleBinding = container
  ? new RoleBinding({
      metadata: { name: "fountain-spritzer-sprites", namespace, labels: spritzerLabels },
      subjects: [{ kind: "ServiceAccount", name: "fountain-spritzer", namespace }],
      roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "Role", name: "fountain-spritzer-sprites" },
    })
  : undefined;

/**
 * spritzer's container-mode settings. SPRITZER_AGENT_IMAGE is spritzer's own
 * image, whose binary is copied into each sprite as its agent, so it must be
 * the same pin the Deployment runs.
 */
const containerEnv = container
  ? [
      { name: "SPRITZER_EXEC", value: "container" },
      { name: "SPRITZER_RUNTIME", value: "kubernetes" },
      { name: "SPRITZER_NAMESPACE", value: namespace },
      { name: "SPRITZER_AGENT_IMAGE", value: spritzerImage },
      { name: "SPRITZER_SPRITE_IMAGE", value: spritzerSpriteImage },
    ]
  : [];

/** Where the app is told to find the Sprites API. Empty when it is the real one. */
export const spritzerBaseUrl = on
  ? `http://fountain-spritzer.${namespace}.svc.cluster.local:4290`
  : undefined;

export const spritzerDeployment = on
  ? new Deployment({
      metadata: { name: "fountain-spritzer", namespace, labels: spritzerLabels },
      spec: {
        replicas: 1,
        selector: { matchLabels: spritzerLabels },
        template: {
          metadata: { labels: spritzerLabels },
          spec: {
            // Distroless, and it needs nothing from the filesystem it does not
            // bring. Nothing here writes outside its own memory.
            securityContext: { runAsNonRoot: true, runAsUser: 65532, runAsGroup: 65532 },
            // The interpreter talks to nothing; container mode talks to the API server.
            serviceAccountName: container ? "fountain-spritzer" : "default",
            containers: [
              new Container({
                name: "spritzer",
                image: spritzerImage,
                imagePullPolicy: "IfNotPresent",
                ports: [{ containerPort: 4290, name: "http" }],
                env: containerEnv,
                securityContext: {
                  capabilities: { drop: ["ALL"] },
                  allowPrivilegeEscalation: false,
                  readOnlyRootFilesystem: true,
                },
                // spritzer reports its own version and the paths it implements
                // here, which is a stronger readiness signal than a socket:
                // the process can be listening before the routes are mounted.
                readinessProbe: {
                  httpGet: { path: "/_spritzer/health", port: 4290 },
                  initialDelaySeconds: 2,
                  periodSeconds: 5,
                },
                livenessProbe: {
                  tcpSocket: { port: 4290 },
                  initialDelaySeconds: 15,
                  periodSeconds: 30,
                },
                resources: {
                  requests: { cpu: "50m", memory: "64Mi" },
                  limits: { memory: "256Mi" },
                },
              }),
            ],
          },
        },
      },
    })
  : undefined;

export const spritzerService = on
  ? new Service({
      metadata: { name: "fountain-spritzer", namespace, labels: spritzerLabels },
      spec: {
        type: "ClusterIP",
        selector: spritzerLabels,
        ports: [{ name: "http", port: 4290, targetPort: 4290, protocol: "TCP" }],
      },
    })
  : undefined;
