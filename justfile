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

# What this needs on the machine, and whether it is there.
doctor:
    #!/usr/bin/env bash
    set -uo pipefail
    ok=0
    for t in docker k3d kubectl node npm; do
      if command -v "$t" >/dev/null 2>&1; then printf "  ✓ %-8s %s\n" "$t" "$($t --version 2>/dev/null | head -1 | cut -c1-48)"
      else printf "  ✗ %-8s missing\n" "$t"; ok=1; fi
    done
    if docker info >/dev/null 2>&1; then echo "  ✓ docker   daemon running"
    else echo "  ✗ docker   daemon not running"; ok=1; fi
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
