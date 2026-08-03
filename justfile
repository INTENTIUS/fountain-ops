# fountain-ops — everything needed to stand a fountain up and prove it works.
#
# The local loop is `just up`. Every other target is a step of it you can run on
# its own, because when a deploy goes wrong you want the step, not the whole
# thing again.

cluster := "fountain-local"
ns      := "fountain"
secret  := "fountain-secrets"

default:
    @just --list

# ── the whole loop ─────────────────────────────────────────────────────────

# Stand up everything, from nothing, and prove it serves.
up: cluster-up secret build apply wait verify
    @echo ""
    @echo "fountain is up. Reach it with:  just forward   →  http://localhost:4000"

# Remove everything this created, and nothing it did not.
down: cluster-down

# ── preflight ──────────────────────────────────────────────────────────────

# What this needs on the machine, whether it is there, and how to get it.
#
# A tool reported as `missing` and nothing else is where someone trying this
# out stops trying it out, so every ✗ carries the install line for the platform
# it is running on.
doctor:
    #!/usr/bin/env bash
    set -uo pipefail
    ok=0

    # Two answers per tool: how to install it on this platform, and the
    # platform-independent fallback for anyone without a package manager.
    case "$(uname -s)" in
      Darwin) pm="brew install" ;;
      Linux)  pm="your package manager" ;;
      *)      pm="" ;;
    esac
    hint() {
      case "$1" in
        docker)  echo "https://docs.docker.com/get-started/get-docker/" ;;
        k3d)     echo "curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash" ;;
        kubectl) echo "https://kubernetes.io/docs/tasks/tools/#kubectl" ;;
        node|npm) echo "https://nodejs.org/en/download  (node ships npm)" ;;
      esac
    }

    for t in docker k3d kubectl node npm; do
      # kubectl takes `version`, not `--version`, and prints nothing for the
      # latter — so ask each tool the way it wants to be asked.
      case "$t" in
        kubectl) v="$(kubectl version --client -o yaml 2>/dev/null | awk -F': ' '/gitVersion/{print $2; exit}')" ;;
        *)       v="$($t --version 2>/dev/null | head -1)" ;;
      esac
      if command -v "$t" >/dev/null 2>&1; then
        printf "  ✓ %-8s %s\n" "$t" "$(printf '%s' "$v" | cut -c1-48)"
      else
        ok=1
        if [ "$pm" = "brew install" ]; then printf "  ✗ %-8s missing — brew install %s\n" "$t" "$t"
        else                                printf "  ✗ %-8s missing\n" "$t"; fi
        printf "             %s\n" "$(hint "$t")"
      fi
    done

    # Installed and not running is a different problem from not installed, and
    # has a different fix. Only ask once the binary is actually there.
    if ! command -v docker >/dev/null 2>&1; then :
    elif docker info >/dev/null 2>&1; then echo "  ✓ docker   daemon running"
    else
      ok=1
      echo "  ✗ docker   installed, but the daemon is not running"
      echo "             start Docker Desktop, or: sudo systemctl start docker"
    fi

    # `just` is not in the loop above for the obvious reason: you are running it.
    if [ "$ok" = 0 ]; then echo ""; echo "  everything this needs is here. Next:  npm install && just up"; fi
    exit $ok

# ── cluster ────────────────────────────────────────────────────────────────

# Create the k3d cluster. Idempotent.
cluster-up:
    #!/usr/bin/env bash
    set -euo pipefail
    if k3d cluster list "{{cluster}}" >/dev/null 2>&1; then
      echo "cluster {{cluster}} already exists"
    else
      # No loadbalancer: this tier has no ingress, and the port-forward is how
      # you reach it. One server node is enough to run a Deployment.
      k3d cluster create "{{cluster}}" --servers 1 --agents 0 --no-lb --wait
    fi
    kubectl config use-context "k3d-{{cluster}}" >/dev/null

cluster-down:
    -k3d cluster delete "{{cluster}}"

# ── secrets ────────────────────────────────────────────────────────────────

# Mint the platform secret, once. Never rotates an existing one.
secret:
    #!/usr/bin/env bash
    # The interim of INTENTIUS/chant#1365 — values are generated here rather
    # than declared, because a value in source is the one thing chant will not
    # do. The read-then-write is the important part: MASTER_SECRETS_KEY
    # regenerated over an existing database makes every stored secret
    # unrecoverable, and it looks exactly like a successful deploy.
    set -euo pipefail
    kubectl create namespace "{{ns}}" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
    if kubectl get secret "{{secret}}" -n "{{ns}}" >/dev/null 2>&1; then
      echo "secret {{secret}} already exists — leaving it alone"
      exit 0
    fi
    PGPASS="$(openssl rand -hex 16)"
    kubectl create secret generic "{{secret}}" -n "{{ns}}" \
      --from-literal=SECRET_KEY_BASE="$(openssl rand -base64 48 | tr -d '\n')" \
      --from-literal=MASTER_SECRETS_KEY="$(openssl rand 32 | base64 | tr '+/' '-_' | tr -d '=\n')" \
      --from-literal=POSTGRES_PASSWORD="$PGPASS" \
      --from-literal=DATABASE_URL="postgres://fountain:${PGPASS}@fountain-postgres.{{ns}}.svc.cluster.local:5432/fountain" \
      --from-literal=SPRITES_TOKEN="local-dev-not-a-real-token"
    echo "secret {{secret}} created"

# ── build and apply ────────────────────────────────────────────────────────

build:
    npx chant build src -o dist/fountain.yaml --format yaml

lint:
    npx chant lint src

test:
    npx vitest run

# Render this repo's own CI from ci/pipeline.ts.
ci:
    npx chant build ci -o .github/workflows/ci.yml --format yaml

# Fail if the committed workflow has drifted from its declaration.
ci-check:
    #!/usr/bin/env bash
    # GitHub reads YAML from the default branch, so the rendered file has to be
    # committed. That makes hand-editing it possible, and a hand edit would win
    # silently — the declaration would still look authoritative while meaning
    # nothing. This is the gate that keeps ci/pipeline.ts the source of truth.
    set -euo pipefail
    out="$(mktemp -t fountain-ci-XXXX.yml)"
    trap 'rm -f "$out"' EXIT
    npx chant build ci -o "$out" --format yaml >/dev/null
    if ! diff -u .github/workflows/ci.yml "$out"; then
      echo ""
      echo "  .github/workflows/ci.yml is not what ci/pipeline.ts renders."
      echo "  Run 'just ci' and commit the result."
      exit 1
    fi
    echo "  ✓ committed workflow matches ci/pipeline.ts"

# Does the source typecheck against the lexicon's own types?
#
# Worth its own step: `chant build` executes the source, so a property that
# does not exist reads as undefined rather than failing. That is how
# monitoring="prometheus-operator" emitted nothing for as long as it did.
typecheck:
    npx tsc --noEmit -p tsconfig.json

# Build, typecheck, lint and test without touching a cluster.
check: typecheck lint test build

apply: build
    kubectl apply -f dist/fountain.yaml

# Wait for both rollouts. Fountain migrates at boot, so give it room.
wait:
    kubectl rollout status deployment/fountain-postgres -n "{{ns}}" --timeout=120s
    kubectl rollout status deployment/fountain -n "{{ns}}" --timeout=300s

# ── verify ─────────────────────────────────────────────────────────────────

# Prove it serves, from inside the cluster so no port-forward is needed.
verify:
    #!/usr/bin/env bash
    set -euo pipefail
    echo "GET /health via an in-cluster probe..."
    kubectl run fountain-verify --rm -i --restart=Never -n "{{ns}}" \
      --image=curlimages/curl:8.11.1 --quiet -- \
      curl -fsS -m 10 http://fountain.{{ns}}.svc.cluster.local/health
    echo ""
    echo "  ✓ /health answered"

# Hold a port open to reach it from the browser.
forward:
    @echo "http://localhost:4000  (ctrl-c to stop)"
    kubectl port-forward -n "{{ns}}" svc/fountain 4000:80

# ── first login ────────────────────────────────────────────────────────────

# Mark an account's email verified, so it can actually use the instance.
#
# This deployment sends no mail. emailDelivery defaults to "none" because
# without Resend's DNS records mail is silently discarded, so the verification
# link a signup asks you to click never arrives and cannot.
#
# What that looks like without this target is not an error. Signing in appears
# to work — the POST returns a redirect to /onboarding/step_1 — and then every
# authenticated page bounces straight back to /auth/login. A loop, with nothing
# on screen saying why. Verified, the same account reaches onboarding and
# /conversations.
#
# So: register at /auth/register first, then run this with the same address.
verify-email EMAIL:
    #!/usr/bin/env bash
    set -euo pipefail

    EMAIL="{{EMAIL}}"
    if ! printf '%s' "$EMAIL" | grep -qE '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'; then
      echo "  ✗ not an email address: $EMAIL" >&2
      exit 2
    fi

    # A separate pod, not `kubectl exec` into the running one.
    #
    # Release.verify_email/1 calls ensure_all_started, which boots the whole
    # application — including the metrics endpoint on 9568. Inside the pod
    # that is already serving, that port is taken, so the documented
    # `bin/fountain_server eval` crashes with :eaddrinuse before it reaches
    # the database. In its own pod the ports are free.
    #
    # The spec is lifted from the live Deployment rather than restated here,
    # so the eval gets exactly the env the app runs with — the same Secret,
    # the same DATABASE_URL — and cannot drift from it. Probes and ports come
    # off because this serves nothing and exits.
    spec="$(kubectl get deploy fountain -n "{{ns}}" -o json | jq -c --arg e "$EMAIL" '
      .spec.template.spec
      | .restartPolicy = "Never"
      | .containers |= [ .[0]
          | .name = "eval"
          | .command = ["/app/bin/fountain_server", "eval", "Fountain.Release.verify_email(\"\($e)\")"]
          | del(.args, .livenessProbe, .readinessProbe, .startupProbe, .ports)
        ]')"

    set +e
    out="$(kubectl run "fountain-verify-email-$$" --rm -i --restart=Never -n "{{ns}}" \
      --image=unused --quiet --overrides="{\"apiVersion\":\"v1\",\"spec\":$spec}" 2>&1)"
    rc=$?
    set -e

    # The eval reports a missing account by printing to stderr and returning
    # an error tuple, which does not set an exit code. Reporting success for
    # an address that never registered is the failure worth avoiding here, so
    # the success line is what decides, not $?.
    if printf '%s' "$out" | grep -q "You can now sign in"; then
      echo "  ✓ $EMAIL is verified — sign in at /auth/login"
      exit 0
    fi

    if printf '%s' "$out" | grep -q "No account found"; then
      echo "  ✗ no account for $EMAIL" >&2
      echo "    Register it first: just forward, then http://localhost:4000/auth/register" >&2
      exit 1
    fi

    echo "$out" >&2
    echo "  ✗ could not verify $EMAIL (kubectl exit $rc)" >&2
    exit 1

# ── operating ──────────────────────────────────────────────────────────────

status:
    kubectl get all,pvc,cronjob -n "{{ns}}"

logs:
    kubectl logs -n "{{ns}}" deployment/fountain --tail=100 -f

pg-logs:
    kubectl logs -n "{{ns}}" deployment/fountain-postgres --tail=50

# Run the backup CronJob now instead of waiting for its schedule.
backup-now:
    kubectl create job -n "{{ns}}" --from=cronjob/fountain-pg-backup "manual-$(date +%s)"

# What the deployment would look like elsewhere, without applying anything.
preview target="kubernetes" tier="standard":
    npx chant build src --format yaml --param target={{target}} --param tier={{tier}}

# Ask a real API server whether it would accept the output.
dry-run *ARGS:
    #!/usr/bin/env bash
    # `just check` proves the manifests build. This proves a Kubernetes API
    # server validates them against the actual CRD schemas — a different
    # question, and the one that catches a field chant is happy to serialize
    # and the cluster rejects. Nothing is created; --dry-run=server validates.
    #
    # Needs the CRDs for whichever seams are on: `just crds`.
    set -euo pipefail
    out="$(mktemp -t fountain-dryrun-XXXX.yaml)"
    trap 'rm -f "$out"' EXIT
    npx chant build src -o "$out" --format yaml {{ARGS}}
    kubectl apply --dry-run=server -f "$out"

# Install the CRDs the operator seams declare against, without the operators.
crds:
    #!/usr/bin/env bash
    # Enough to validate manifests and nothing else: no controller runs, so
    # nothing is reconciled. Installing the operators is a separate decision
    # and not one this repo makes for you.
    set -euo pipefail
    apply() { kubectl apply --server-side --force-conflicts -f "$1" >/dev/null && echo "  ✓ $2"; }
    cnpg=https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/v1.29.1/config/crd/bases
    apply "$cnpg/postgresql.cnpg.io_clusters.yaml"         "cnpg Cluster"
    apply "$cnpg/postgresql.cnpg.io_scheduledbackups.yaml"  "cnpg ScheduledBackup"
    apply "https://raw.githubusercontent.com/cloudnative-pg/plugin-barman-cloud/v0.14.0/config/crd/bases/barmancloud.cnpg.io_objectstores.yaml" "barman ObjectStore"
    traefik=https://raw.githubusercontent.com/traefik/traefik-helm-chart/v41.1.0/traefik/crds
    apply "$traefik/traefik.io_ingressroutes.yaml" "traefik IngressRoute"
    apply "$traefik/traefik.io_middlewares.yaml"   "traefik Middleware"
    apply "https://raw.githubusercontent.com/Infisical/kubernetes-operator/infisical-k8-operator/v0.11.7/config/crd/bases/secrets.infisical.com_infisicalsecrets.yaml" "InfisicalSecret"
    prom=https://raw.githubusercontent.com/prometheus-operator/prometheus-operator/v0.79.2/example/prometheus-operator-crd
    apply "$prom/monitoring.coreos.com_servicemonitors.yaml" "ServiceMonitor"
    apply "$prom/monitoring.coreos.com_prometheusrules.yaml" "PrometheusRule"
    apply "https://github.com/cert-manager/cert-manager/releases/download/v1.16.2/cert-manager.crds.yaml" "cert-manager"
