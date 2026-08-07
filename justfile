# fountain-ops — everything needed to stand a fountain up and prove it works.
#
# The local loop is `just up`. Every other target is a step of it you can run on
# its own, because when a deploy goes wrong you want the step, not the whole
# thing again.

# Everything `just` does is the local deployment, so it is owned, labelled and
# bound as `local` — one name across the ownership marker, the instance label
# and the k8s cluster binding in chant.config.ts. Without this the marker says
# `dev` while behold reads `--env local` and matches nothing.
export FOUNTAIN_ENV := "local"

cluster := "fountain-local"
ns      := "fountain"
secret  := "fountain-secrets"

# Build parameters for every target that builds. Empty means the defaults:
# target=k3d, tier=light, and the seams k3d picks.
#
#   just params="--param postgres=cnpg" up
#
# It is a variable rather than a recipe argument because `up` is a chain of
# targets and just does not thread arguments through dependencies — this way
# `build`, `apply` and `preview` all see the same value.
params := ""

# Upstream versions, pinned once. `just crds` installs the schemas at these
# versions and `just operators` installs the controllers that reconcile them,
# so the two must not be able to drift apart.
cnpg_version    := "1.29.1"
# The release branch the operator manifest lives on — the minor of the above.
cnpg_major      := "1.29"
barman_version  := "0.14.0"
traefik_version := "41.1.0"
infisical_version := "0.11.7"
prom_version    := "0.79.2"
certmgr_version := "1.16.2"

[doc("List every recipe. This is what bare `just` runs.")]
default:
    @just --list

# ── the whole loop ─────────────────────────────────────────────────────────

# Stand up everything, from nothing, and prove it serves.
[doc("Stand up everything, from nothing, and prove it serves.")]
up: cluster-up secret build apply wait storage-init verify
    @echo ""
    @echo "fountain is up. Reach it with:  just forward   →  http://localhost:4000"

# Remove everything this created, and nothing it did not.
[doc("Remove everything this created, and nothing it did not.")]
down: cluster-down

# ── the guard ──────────────────────────────────────────────────────────────

# Refuse to touch a cluster that is not this project's.
#
# `kubectl` acts on whatever context is ambient, and a context is global state
# that anything on the machine can change — creating any other k3d cluster
# switches it, silently, mid-session. That happened while writing the restore
# drill: a second cluster appeared, took the context, and the drill reported a
# failing backup for a namespace that simply was not there. A wrong answer that
# looks like a real finding is worse than an error.
#
# So every recipe that reaches for a cluster depends on this. `cluster-up` sets
# the context and is exempt; the read-only `check`, `build`, `lint` and `test`
# never touch one.
#
# ALLOW_FOREIGN_CLUSTER=1 to mean it — `just dry-run` against a real cluster is
# a legitimate thing to want.
_require-cluster:
    #!/usr/bin/env bash
    set -euo pipefail
    ctx="$(kubectl config current-context 2>/dev/null || true)"
    if [ "$ctx" = "k3d-{{cluster}}" ] || [ "${ALLOW_FOREIGN_CLUSTER:-}" = "1" ]; then exit 0; fi
    echo "  ✗ kubectl context is \"$ctx\", not \"k3d-{{cluster}}\"." >&2
    echo "" >&2
    echo "    Something else changed it — creating any k3d cluster switches the" >&2
    echo "    active context. Refusing rather than acting on the wrong cluster." >&2
    echo "" >&2
    echo "    Fix it:   kubectl config use-context k3d-{{cluster}}" >&2
    echo "    Or mean it:  ALLOW_FOREIGN_CLUSTER=1 just <target>" >&2
    exit 2

# ── preflight ──────────────────────────────────────────────────────────────

# What this needs on the machine, whether it is there, and how to get it.
#
# A tool reported as `missing` and nothing else is where someone trying this
# out stops trying it out, so every ✗ carries the install line for the platform
# it is running on.
[doc("What this needs on the machine, whether it is there, and how to get it.")]
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
        jq)      echo "https://jqlang.github.io/jq/download/" ;;
        sops)    echo "https://github.com/getsops/sops/releases  (only for secrets=sops)" ;;
        age)     echo "https://github.com/FiloSottile/age/releases  (only for secrets=sops)" ;;
      esac
    }

    # jq is in the list because `just verify-email` builds a pod spec with it.
    # macOS does not ship it, and without this the failure is a bare
    # "jq: command not found" from inside a recipe — after the preflight that
    # exists to prevent exactly that has already passed.
    for t in docker k3d kubectl node npm jq; do
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

    # Optional, and only for secrets=sops. Reported rather than required,
    # because failing a preflight over a tool most deployments never need is
    # how a preflight gets ignored.
    for t in sops age; do
      if command -v "$t" >/dev/null 2>&1; then
        printf "  ✓ %-8s %s\n" "$t" "$("$t" --version 2>&1 | head -1 | cut -c1-40)"
      else
        printf "  · %-8s not installed — only needed for secrets=sops\n" "$t"
      fi
    done

    # `just` is not in the loop above for the obvious reason: you are running it.
    if [ "$ok" = 0 ]; then echo ""; echo "  everything this needs is here. Next:  npm install && just up"; fi
    exit $ok

# ── cluster ────────────────────────────────────────────────────────────────

# Create the k3d cluster. Idempotent.
[doc("Create the k3d cluster, and wait for its apiserver. Idempotent.")]
cluster-up:
    #!/usr/bin/env bash
    set -euo pipefail
    if k3d cluster list "{{cluster}}" >/dev/null 2>&1; then
      echo "cluster {{cluster}} already exists"
    else
      # The cluster's shape lives in cluster/local.ts, not in flags here —
      # chant emits the SimpleConfig and k3d consumes it verbatim. The
      # declaration writes the kubeconfig entry but never switches to it;
      # the explicit use-context below is the one deliberate switch, which
      # is the whole point of the guard above it.
      npx chant build cluster -o dist/k3d-local.yaml --format yaml >/dev/null
      k3d cluster create --config dist/k3d-local.yaml --wait
    fi
    kubectl config use-context "k3d-{{cluster}}" >/dev/null

    # `--wait` returns when k3d is satisfied, which is not the same as the
    # apiserver accepting connections. CI failed once with
    #
    #   error validating "dist/fountain.yaml": failed to download openapi:
    #   Get "https://0.0.0.0:41171/openapi/v2": connect: connection refused
    #
    # three seconds after `secret` had talked to that same apiserver
    # successfully. It passed on a re-run, which is the worst kind of failure:
    # one that looks like a real breakage and goes away if you ignore it.
    for i in $(seq 1 60); do
      kubectl get --raw /readyz >/dev/null 2>&1 && break
      [ "$i" = 60 ] && { echo "  ✗ apiserver never became ready" >&2; exit 1; }
      sleep 2
    done

[doc("Delete the k3d cluster.")]
cluster-down:
    -k3d cluster delete "{{cluster}}"

# ── secrets ────────────────────────────────────────────────────────────────

# Mint the platform secret, once. Never rotates an existing one.
[doc("Mint the platform secret, once. Never rotates an existing one.")]
secret: _require-cluster
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
      --from-literal=SPRITES_TOKEN="local-dev-not-a-real-token" \
      --from-literal=AWS_ACCESS_KEY_ID="local-dev-not-a-real-key" \
      --from-literal=AWS_SECRET_ACCESS_KEY="local-dev-not-a-real-secret" \
      --from-literal=AWS_DEFAULT_REGION="us-east-1"
    echo "secret {{secret}} created"

# Create the backup bucket when the storage seam is emulated.
#
# floci starts empty, and `aws s3 cp` to a bucket that does not exist fails the
# way a missing credential does — late, in the upload container, after a good
# dump has already been taken. A real bucket is yours to create; this only ever
# touches the emulator.
[doc("Create the backup bucket, when the storage seam is the emulator.")]
storage-init: _require-cluster
    #!/usr/bin/env bash
    set -euo pipefail
    ep="$(npx chant build src --format yaml {{params}} 2>/dev/null | awk '/name: S3_ENDPOINT/{getline; print $2}' | head -1)"
    case "$ep" in
      *fountain-floci*) ;;
      *) echo "  storage is not emulated — nothing to create"; exit 0 ;;
    esac
    bucket="$(npx chant build src --format yaml {{params}} 2>/dev/null | awk '/name: BUCKET/{getline; print $2}' | head -1)"
    kubectl rollout status deploy/fountain-floci -n "{{ns}}" --timeout=180s >/dev/null
    # `mb` on a bucket that already exists is an error, and re-running `just up`
    # must stay a no-op, so an existing bucket is success.
    kubectl run "floci-mb-$$" --rm -i --restart=Never -n "{{ns}}" --quiet \
      --image=amazon/aws-cli:2.31.19 \
      --env=AWS_ACCESS_KEY_ID=local-dev-not-a-real-key \
      --env=AWS_SECRET_ACCESS_KEY=local-dev-not-a-real-secret \
      --env=AWS_DEFAULT_REGION=us-east-1 \
      -- --endpoint-url "$ep" s3 mb "s3://$bucket" 2>&1 | grep -vE "^pod .* deleted$" || true
    echo "  ✓ s3://$bucket on the emulated store"

# Decrypt secrets/platform.enc.yaml into the cluster Secret.
[doc("Decrypt secrets/platform.enc.yaml into the cluster Secret (secrets=sops).")]
secrets-sync: _require-cluster
    #!/usr/bin/env bash
    # The `secrets=sops` half of the seam: source of truth is this repo, as
    # ciphertext, and the cluster is a copy. The opposite of `just secret`,
    # which mints values on the spot — fine for one laptop, and not a story you
    # can carry to a second machine or a second operator.
    #
    # Nothing decrypted is ever written to disk. sops streams to stdout, kubectl
    # reads it, and a decrypted file cannot be left behind because one is never
    # created.
    set -euo pipefail

    enc=secrets/platform.enc.yaml
    if [ ! -f "$enc" ]; then
      echo "  ✗ $enc does not exist." >&2
      echo "" >&2
      echo "    cp secrets/platform.example.yaml $enc" >&2
      echo "    \$EDITOR $enc" >&2
      echo "    sops --encrypt --in-place $enc" >&2
      exit 2
    fi
    command -v sops >/dev/null || { echo "  ✗ sops is not installed — see just doctor" >&2; exit 2; }

    # sops looks for age identities in a different place per platform:
    # ~/Library/Application Support/sops/age/keys.txt on macOS,
    # ~/.config/sops/age/keys.txt elsewhere. `age-keygen -o` and most
    # instructions on the internet write the second one, so on a Mac the key
    # exists, is correct, and is not found — and the error is
    #
    #   identity did not match any of the recipients
    #
    # which reads like the wrong key rather than the wrong directory.
    if [ -z "${SOPS_AGE_KEY_FILE:-}" ]; then
      for candidate in \
        "$HOME/Library/Application Support/sops/age/keys.txt" \
        "${XDG_CONFIG_HOME:-$HOME/.config}/sops/age/keys.txt"; do
        if [ -f "$candidate" ]; then export SOPS_AGE_KEY_FILE="$candidate"; break; fi
      done
    fi
    if [ -z "${SOPS_AGE_KEY_FILE:-}" ]; then
      echo "  ✗ no age identity found." >&2
      echo "" >&2
      echo "    age-keygen -o \"\${XDG_CONFIG_HOME:-\$HOME/.config}/sops/age/keys.txt\"" >&2
      echo "    then add its public half to .sops.yaml and re-encrypt." >&2
      exit 2
    fi

    # --output-type dotenv, because --from-env-file wants KEY=VALUE and the
    # file on disk is YAML. sops converts; kubectl skips the comment lines.
    kubectl create namespace "{{ns}}" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
    sops --decrypt --output-type dotenv "$enc" \
      | kubectl create secret generic "{{secret}}" -n "{{ns}}" --from-env-file=/dev/stdin \
          --dry-run=client -o yaml \
      | kubectl apply -f - >/dev/null

    n="$(kubectl get secret "{{secret}}" -n "{{ns}}" -o jsonpath='{.data}' | tr ',' '\n' | grep -c ':' || true)"
    echo "  ✓ {{secret}} synced from $enc ($n keys)"

# ── build and apply ────────────────────────────────────────────────────────

[doc("Render the manifests to dist/fountain.yaml.")]
build:
    npx chant build src -o dist/fountain.yaml --format yaml {{params}}

[doc("Lint the source.")]
lint:
    npx chant lint src

[doc("Run the unit tests.")]
test:
    npx vitest run

# Render this repo's own workflows from their declarations.
#
# One directory per workflow, because `chant build <dir>` collects a
# directory into one output file: ci/ renders ci.yml, pages/ renders
# pages.yml, e2e-k8s/ renders e2e-k8s.yml.
[doc("Render the GitHub workflows from their TypeScript declarations.")]
ci:
    npx chant build ci -o .github/workflows/ci.yml --format yaml
    npx chant build pages -o .github/workflows/pages.yml --format yaml
    npx chant build e2e-k8s -o .github/workflows/e2e-k8s.yml --format yaml

# Fail if either committed workflow has drifted from its declaration.
[doc("Fail if either committed workflow has drifted from its declaration.")]
ci-check:
    #!/usr/bin/env bash
    # GitHub reads YAML from the default branch, so the rendered file has to be
    # committed. That makes hand-editing it possible, and a hand edit would win
    # silently — the declaration would still look authoritative while meaning
    # nothing. This is the gate that keeps the TypeScript the source of truth.
    set -euo pipefail
    out="$(mktemp -t fountain-ci-XXXX.yml)"
    trap 'rm -f "$out"' EXIT
    rc=0
    for pair in "ci:.github/workflows/ci.yml" "pages:.github/workflows/pages.yml" "e2e-k8s:.github/workflows/e2e-k8s.yml"; do
      src="${pair%%:*}"; committed="${pair#*:}"
      npx chant build "$src" -o "$out" --format yaml >/dev/null
      if diff -u "$committed" "$out"; then
        echo "  ✓ $committed matches $src/pipeline.ts"
      else
        echo ""
        echo "  $committed is not what $src/pipeline.ts renders."
        echo "  Run 'just ci' and commit the result."
        rc=1
      fi
    done
    exit $rc

# ── the published site ─────────────────────────────────────────────────────

# Build the docs site. Astro + Starlight, in docs-site/.
#
# The same target CI runs, so what gets published is what you previewed. Uses
# `npm ci` when there is a lockfile to honour, which is what CI wants and what
# keeps a local build from quietly resolving a different Starlight.
[doc("Build the docs site, the same way CI does.")]
site:
    #!/usr/bin/env bash
    set -euo pipefail
    cd docs-site
    if [ -f package-lock.json ]; then npm ci; else npm install; fi
    npm run build
    echo "  ✓ docs-site/dist built"

# Serve the docs site locally with hot reload.
[doc("Serve the docs site locally with hot reload.")]
site-dev:
    cd docs-site && npm install && npm run dev

# Does the source typecheck against the lexicon's own types?
#
# Worth its own step: `chant build` executes the source, so a property that
# does not exist reads as undefined rather than failing. That is how
# monitoring="prometheus-operator" emitted nothing for as long as it did.
[doc("Typecheck the source against the lexicon's own types.")]
typecheck:
    npx tsc --noEmit -p tsconfig.json

# Build, typecheck, lint and test without touching a cluster.
[doc("Typecheck, lint, test and build. Touches no cluster. What CI runs.")]
check: typecheck lint test build

[doc("Build, then apply the manifests to the cluster.")]
apply: build _require-cluster
    kubectl apply -f dist/fountain.yaml

# Wait for both rollouts. Fountain migrates at boot, so give it room.
[doc("Wait for both rollouts. Fountain migrates at boot, so give it room.")]
wait: _require-cluster
    #!/usr/bin/env bash
    set -euo pipefail
    # Which database to wait for depends on the seam: bundled is a Deployment,
    # cnpg is a Cluster, and a referenced Postgres is not ours to wait for.
    # Asking the cluster what is actually there — apply has already run by the
    # time this does — is what lets `just params="--param postgres=cnpg" up`
    # be one command instead of a sequence with this step hand-replaced.
    if kubectl get deployment fountain-postgres -n "{{ns}}" >/dev/null 2>&1; then
      kubectl rollout status deployment/fountain-postgres -n "{{ns}}" --timeout=120s
    elif kubectl get cluster.postgresql.cnpg.io fountain-pg -n "{{ns}}" >/dev/null 2>&1; then
      kubectl wait --for=condition=Ready cluster.postgresql.cnpg.io/fountain-pg -n "{{ns}}" --timeout=300s
    fi
    kubectl rollout status deployment/fountain -n "{{ns}}" --timeout=300s

# ── verify ─────────────────────────────────────────────────────────────────

# Prove it serves, from inside the cluster so no port-forward is needed.
[doc("Prove it serves, probed from inside the cluster.")]
verify: _require-cluster
    #!/usr/bin/env bash
    set -euo pipefail
    echo "GET /health via an in-cluster probe..."
    kubectl run fountain-verify --rm -i --restart=Never -n "{{ns}}" \
      --image=curlimages/curl:8.11.1 --quiet -- \
      curl -fsS -m 10 http://fountain.{{ns}}.svc.cluster.local/health
    echo ""
    echo "  ✓ /health answered"

# The whole thing, from nothing, asserted.
#
# `just check` is deliberately identical to what CI's `check` job runs, so the
# thing people run before pushing predicts what CI does. The e2e half had no
# such target: its assertions lived only in ci/pipeline.ts as workflow steps,
# so answering "do the documented claims still hold on my machine?" meant
# reading the pipeline and hand-transcribing it. This is that target, and CI
# calls it rather than restating it.
#
# It also runs the three gates CI never did — restore-drill, the conversation
# gate, and the account path. restore-drill is what turns "a backup nobody has
# restored is a hypothesis" into a fact, and it was manual-only, so the status
# page's `pg-dump → floci` row rested on something nothing re-checked.
#
# Tears down on success. On failure it leaves the cluster up on purpose, so
# there is something to look at — CI does its own `just down` with `always()`.
[doc("Stand up from nothing, assert every documented claim, tear down.")]
e2e:
    #!/usr/bin/env bash
    set -euo pipefail
    fail() { echo ""; echo "  ✗ e2e: $1" >&2; echo "    cluster left up for inspection — 'just down' when finished" >&2; exit 1; }
    step() { echo ""; echo "── $1 ─────────────────────────────────────"; }

    step "stand it up from nothing"
    just up

    # /health only proves the release booted. /health/ready proves it reached
    # Postgres, which is the half that actually breaks.
    step "readiness, including the database"
    kubectl run e2e-ready --rm -i --restart=Never -n "{{ns}}" \
      --image=curlimages/curl:8.11.1 --quiet -- \
      curl -fsS -m 10 "http://fountain.{{ns}}.svc.cluster.local/health/ready" \
      | tee /dev/stderr | grep -q '"database":"ok"' || fail "/health/ready did not report the database ok"
    echo "  ✓ database reachable through the app"

    # Re-running is the documented recovery advice, and this is the one with
    # real consequences: a regenerated MASTER_SECRETS_KEY makes every stored
    # secret unrecoverable and looks exactly like a successful deploy.
    step "re-running up does not rotate the master key"
    before="$(kubectl get secret "{{secret}}" -n "{{ns}}" -o jsonpath='{.data.MASTER_SECRETS_KEY}')"
    just up >/dev/null
    after="$(kubectl get secret "{{secret}}" -n "{{ns}}" -o jsonpath='{.data.MASTER_SECRETS_KEY}')"
    [ "$before" = "$after" ] || fail "MASTER_SECRETS_KEY changed across a re-run"
    echo "  ✓ MASTER_SECRETS_KEY byte-identical"

    # The app races nothing now, so a restart here means the initContainer
    # stopped doing its job. Asserted rather than eyeballed, because the
    # failure it guards against is invisible: `just up` goes green either way.
    step "the app came up without crashing first"
    r="$(kubectl get pod -n "{{ns}}" -l app.kubernetes.io/component=server \
         -o jsonpath='{.items[0].status.containerStatuses[0].restartCount}')"
    [ "$r" = "0" ] || fail "app restarted $r time(s) before becoming ready — the postgres wait regressed (#57)"
    echo "  ✓ restartCount 0"

    step "the backup is real: taken, then restored and table-matched"
    just backup-now >/dev/null
    job="$(kubectl get jobs -n "{{ns}}" -o name --sort-by=.metadata.creationTimestamp | tail -1)"
    kubectl wait --for=condition=complete --timeout=300s -n "{{ns}}" "$job" >/dev/null 2>&1 \
      || fail "the backup job did not complete"
    just restore-drill || fail "restore-drill could not read the backup back"

    # The account path, headless. Registration is POST /api/auth/register — the
    # browser form is not the only route, which is what lets this run at all.
    step "the account path: register, verify, get a key"
    email="e2e-$(date +%s)@example.com"
    pass="e2e-$(openssl rand -hex 12)"
    kubectl run e2e-register --rm -i --restart=Never -n "{{ns}}" \
      --image=curlimages/curl:8.11.1 --quiet -- \
      curl -fsS -m 15 -X POST "http://fountain.{{ns}}.svc.cluster.local/api/auth/register" \
      -H 'content-type: application/json' -d "{\"email\":\"$email\",\"password\":\"$pass\"}" \
      | grep -q user_id || fail "registration did not return a user_id"
    just verify-email "$email" | grep -q "is verified" || fail "verify-email did not verify the account"
    echo "  ✓ registered and verified $email"

    # The first-admin bootstrap. Two vintages are legitimate here:
    #   - images after v0.4.0 (fountain ADR 0011): FIRST_USER_ADMIN=true in
    #     the pod spec means the e2e account above — the instance's first
    #     verified account — is already the admin, and promote-admin reports
    #     "was already an admin". That report IS the assertion that the
    #     in-app bootstrap fired.
    #   - v0.4.0 and earlier ignore the variable, so promote-admin performs
    #     the grant itself ("is an admin").
    # Either way the account must end up admin; a "no account" or error path
    # still fails. Asserting the grant, not the admin pages — driving those
    # needs a browser session this target does not have.
    step "the first-admin bootstrap"
    just promote-admin "$email" | grep -qE "is an admin|already an admin" \
      || fail "the account was not admin after promote-admin — neither the in-app bootstrap nor the release task granted it"
    echo "  ✓ $email is admin, audit-recorded"

    # The conversation gate, asserted as the pairing rather than a result.
    #
    # Both outcomes below are legitimate and which one you get is a race, not a
    # property of the deployment. fountain v0.4.0, dispatch_provision/7:
    #
    #   case sandbox.status do
    #     "ready"                        -> reattach(...)
    #     s when s in ["pending", ...]   -> fresh_provision(...)
    #
    # If provisioning marks the sandbox `ready` before the ConversationServer
    # dispatches, it takes the reattach path — and reattach calls list_sessions,
    # which spritzer answers 426 (spritzer#18), orphaning the turn. If dispatch
    # gets there first, it provisions fresh and the turn runs to exit 0.
    #
    # Whoever wins is decided by machine speed, so a FASTER machine is MORE
    # likely to see the failure. Observed 5/5 orphaned on an M-series laptop and
    # 2/2 completed on a GitHub runner, with identical image digests. #67.
    #
    # So neither result can be pinned. What is pinned is that the two agree:
    # reattach implies orphaned, and no reattach implies a completed turn.
    # Anything else — reattach that somehow succeeds, or no reattach and no exit
    # 0 — is new, and worth stopping for. That is stricter than asserting
    # provisioning alone and it holds on any machine.
    step "the conversation gate, and that its outcome matches its path"
    export FOUNTAIN_PASSWORD="$pass"
    out="$(just verify-conversation "$email" 2>&1 || true)"
    printf '%s' "$out" | grep -q 'provision' \
      || { echo "$out" | tail -20; fail "no provision stage — the sandbox was never requested"; }
    if printf '%s' "$out" | grep -q '"stage":"reattach"'; then
      printf '%s' "$out" | grep -q "turn_orphaned" \
        || { echo "$out" | tail -20; fail "reattach ran and did NOT orphan the turn — spritzer#18 may be fixed. Re-check #67 and the status page."; }
      echo "  ✓ reattach path taken, turn orphaned as spritzer#18 describes ($(uname -m))"
    else
      printf '%s' "$out" | grep -q "plumbing: sandbox provisioned" \
        || { echo "$out" | tail -20; fail "no reattach, so the turn should have completed, and it did not"; }
      echo "  ✓ fresh provision, turn completed ($(uname -m))"
      echo "    (spritzer echoes the command back — this is plumbing, not a model reply)"
    fi

    # Every seam that needs a CRD, against a real API server rather than
    # against our own expectations. No controllers, so nothing reconciles.
    step "a real API server accepts every seam"
    just crds >/dev/null
    just dry-run --param postgres=cnpg --param backups=barman-pitr \
      --param ingress=traefik --param tls=cert-manager \
      --param secrets=infisical --param monitoring=prometheus-operator \
      --param scheme=https --param host=fountain.ci.example.com >/dev/null \
      || fail "the API server rejected one of the seams"
    echo "  ✓ every seam validated"

    step "tearing down"
    just down >/dev/null 2>&1
    echo ""
    echo "  ✓ e2e: every documented claim held, from nothing, and the cluster is gone."

# The target=kubernetes claims, re-checked on a cluster this recipe treats as
# foreign. `just e2e` proves the k3d target; the rows it cannot reach are the
# ones about a cluster this repo did not create — a referenced Postgres, an
# Ingress class the cluster already answers to, two replicas that must find
# each other across nodes. This stands up a *separate* multi-node k3d cluster
# as the stand-in (still not a managed cluster — #23), and never touches the
# ambient kubectl context: every kubectl call names its context explicitly,
# which is also why it needs no ALLOW_FOREIGN_CLUSTER.
#
# The stand-in differs from `just up`'s cluster on purpose:
#   - three nodes, so the ha replicas can actually land on different machines
#   - k3s's bundled Traefik is the ingress controller, so ingressClassName is
#     exercised against a class this recipe did not install
#   - Postgres runs in another namespace, deployed here but not by chant, and
#     the platform Secret is created by hand — which is exactly what
#     postgres=reference and secrets=reference mean
#
# light applies first and ha applies over it, so the in-place light→ha upgrade
# is exercised as a side effect rather than assumed.
# The stand-in's name and host port live in cluster/stand-in.ts; the recipe
# reads both from the emitted config rather than restating them here, so the
# declaration cannot drift from the curls that depend on it.
k8s_cluster := "fountain-k8s-stand-in"
k8s_host    := "fountain.k8s.test"

[doc("Stand up a multi-node stand-in cluster, prove target=kubernetes light and ha serve, tear down.")]
e2e-k8s:
    #!/usr/bin/env bash
    set -euo pipefail
    ctx="k3d-{{k8s_cluster}}"
    fail() { echo ""; echo "  ✗ e2e-k8s: $1" >&2; echo "    cluster left up for inspection — 'k3d cluster delete {{k8s_cluster}}' when finished" >&2; exit 1; }
    step() { echo ""; echo "── $1 ─────────────────────────────────────"; }
    kc() { kubectl --context "$ctx" "$@"; }

    step "a fresh cluster that is not ours"
    # The cluster's shape is a declaration, same as the local one. The host
    # port the loadbalancer publishes is read from the emitted config so the
    # Ingress curls below and the declaration cannot disagree.
    npx chant build cluster -o dist/k3d-local.yaml --format yaml >/dev/null
    # Secondary configs are keyed by export name; find the stand-in by the
    # cluster name it declares, which is the thing this recipe actually needs.
    cfg="$(grep -l "name: {{k8s_cluster}}" dist/k3d-local.yaml dist/*.k3d.yaml 2>/dev/null | head -1)"
    [ -n "$cfg" ] || fail "no emitted config declares cluster {{k8s_cluster}} — is cluster/stand-in.ts still declared?"
    hostport="$(sed -n "s/.*port: ['\"]\{0,1\}\([0-9][0-9]*\):80.*/\1/p" "$cfg" | head -1)"
    [ -n "$hostport" ] || fail "no host port for the loadbalancer in $cfg"
    if ! k3d cluster list "{{k8s_cluster}}" >/dev/null 2>&1; then
      k3d cluster create --config "$cfg" --wait >/dev/null
    fi
    for i in $(seq 1 60); do
      kc get --raw /readyz >/dev/null 2>&1 && break
      [ "$i" = 60 ] && fail "apiserver never became ready"
      sleep 2
    done
    # k3s installs Traefik asynchronously; the class is the thing the build
    # names, so it existing is part of the claim.
    for i in $(seq 1 60); do
      kc get ingressclass traefik >/dev/null 2>&1 && break
      [ "$i" = 60 ] && fail "the traefik ingressclass never appeared"
      sleep 2
    done
    echo "  ✓ 3 nodes, ingressclass traefik"

    # postgres=reference means "it already exists, here is how to reach it".
    # So it has to already exist: a plain Postgres in another namespace,
    # deployed by kubectl here and never by chant.
    step "a Postgres chant does not manage"
    kc create namespace pg-external --dry-run=client -o yaml | kc apply -f - >/dev/null
    pgpass="$(openssl rand -hex 16)"
    if ! kc get secret pg-credentials -n pg-external >/dev/null 2>&1; then
      kc create secret generic pg-credentials -n pg-external \
        --from-literal=POSTGRES_PASSWORD="$pgpass" >/dev/null
    else
      pgpass="$(kc get secret pg-credentials -n pg-external -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d)"
    fi
    kc apply -n pg-external -f - >/dev/null <<'MANIFEST'
    apiVersion: apps/v1
    kind: Deployment
    metadata: { name: postgres }
    spec:
      replicas: 1
      selector: { matchLabels: { app: postgres } }
      template:
        metadata: { labels: { app: postgres } }
        spec:
          containers:
          - name: postgres
            image: postgres:16
            env:
            - { name: POSTGRES_USER, value: fountain }
            - { name: POSTGRES_DB, value: fountain }
            - name: POSTGRES_PASSWORD
              valueFrom: { secretKeyRef: { name: pg-credentials, key: POSTGRES_PASSWORD } }
            ports: [{ containerPort: 5432 }]
    ---
    apiVersion: v1
    kind: Service
    metadata: { name: postgres }
    spec:
      selector: { app: postgres }
      ports: [{ port: 5432, targetPort: 5432 }]
    MANIFEST
    kc rollout status deployment/postgres -n pg-external --timeout=180s >/dev/null \
      || fail "the external Postgres never became ready"
    echo "  ✓ postgres:16 in pg-external, no TLS — which is why databaseSsl=false below"

    # secrets=reference means the cluster is the source of truth, so the
    # Secret is created by hand — same keys `just secret` mints, but
    # DATABASE_URL points at the referenced Postgres, not the bundled one.
    step "the platform Secret, by hand"
    kc create namespace "{{ns}}" --dry-run=client -o yaml | kc apply -f - >/dev/null
    if ! kc get secret "{{secret}}" -n "{{ns}}" >/dev/null 2>&1; then
      kc create secret generic "{{secret}}" -n "{{ns}}" \
        --from-literal=SECRET_KEY_BASE="$(openssl rand -base64 48 | tr -d '\n')" \
        --from-literal=MASTER_SECRETS_KEY="$(openssl rand 32 | base64 | tr '+/' '-_' | tr -d '=\n')" \
        --from-literal=POSTGRES_PASSWORD="$pgpass" \
        --from-literal=DATABASE_URL="postgres://fountain:${pgpass}@postgres.pg-external.svc.cluster.local:5432/fountain" \
        --from-literal=SPRITES_TOKEN="local-dev-not-a-real-token" \
        --from-literal=AWS_ACCESS_KEY_ID="local-dev-not-a-real-key" \
        --from-literal=AWS_SECRET_ACCESS_KEY="local-dev-not-a-real-secret" \
        --from-literal=AWS_DEFAULT_REGION="us-east-1" >/dev/null
    fi
    echo "  ✓ {{secret}} exists, DATABASE_URL → pg-external"

    P="--param target=kubernetes --param host={{k8s_host}} --param scheme=http \
       --param ingressClassName=traefik --param databaseSsl=false"

    step "kubernetes/light: build, dry-run, apply, serve through the Ingress"
    npx chant build src -o dist/fountain-k8s-light.yaml --format yaml $P >/dev/null 2>&1 \
      || fail "the light build did not render"
    kc apply -f dist/fountain-k8s-light.yaml --dry-run=server >/dev/null \
      || fail "the API server rejected the light manifests"
    kc apply -f dist/fountain-k8s-light.yaml >/dev/null
    kc rollout status deployment/fountain -n "{{ns}}" --timeout=300s >/dev/null \
      || fail "the light rollout never completed"
    # Through the Ingress, not a port-forward: this is what proves the class,
    # the rule and the controller agree. Traefik picks the new Ingress up
    # asynchronously, so the first answers can be its own 503 — retried, and
    # only the body decides.
    ok=""
    for i in $(seq 1 30); do
      body="$(curl -fsS -m 10 -H "Host: {{k8s_host}}" "http://localhost:$hostport/health/ready" 2>/dev/null)" \
        && printf '%s' "$body" | grep -q '"database":"ok"' && ok=1 && break
      sleep 2
    done
    [ "$ok" = 1 ] || fail "/health/ready through the Ingress did not report the database ok"
    r="$(kc get pod -n "{{ns}}" -l app.kubernetes.io/component=server \
         -o jsonpath='{.items[0].status.containerStatuses[0].restartCount}')"
    [ "$r" = "0" ] || fail "the app restarted $r time(s) before serving"
    echo "  ✓ light serves {\"database\":\"ok\"} through the Traefik Ingress, restartCount 0"

    step "kubernetes/ha: two replicas that find each other"
    npx chant build src -o dist/fountain-k8s-ha.yaml --format yaml $P --param tier=ha >/dev/null 2>&1 \
      || fail "the ha build did not render"
    kc apply -f dist/fountain-k8s-ha.yaml --dry-run=server >/dev/null \
      || fail "the API server rejected the ha manifests"
    kc apply -f dist/fountain-k8s-ha.yaml >/dev/null
    kc rollout status deployment/fountain -n "{{ns}}" --timeout=300s >/dev/null \
      || fail "the ha rollout never completed"
    ready="$(kc get deployment fountain -n "{{ns}}" -o jsonpath='{.status.readyReplicas}')"
    [ "$ready" = "2" ] || fail "expected 2 ready replicas, got ${ready:-0}"
    kc get pdb fountain -n "{{ns}}" >/dev/null || fail "the PodDisruptionBudget is missing"
    # libcluster logs the connect on the side that initiated it, and the line
    # only prints after :net_kernel.connect_node returned true — a formed
    # distribution connection, not an attempt. The rollout being ready and the
    # connect having happened are different moments — readiness is the HTTP
    # probe, and the headless DNS both sides poll answers on its own clock —
    # so this waits rather than sampling once.
    connected=0
    for i in $(seq 1 30); do
      for p in $(kc get pods -n "{{ns}}" -l app.kubernetes.io/component=server -o name); do
        kc logs "$p" -n "{{ns}}" 2>/dev/null | grep -q '\[libcluster:fountain\] connected to' && connected=1
      done
      [ "$connected" = 1 ] && break
      sleep 2
    done
    [ "$connected" = 1 ] || fail "neither replica logged a libcluster connect — the Erlang cluster did not form"
    ok=""
    for i in $(seq 1 30); do
      body="$(curl -fsS -m 10 -H "Host: {{k8s_host}}" "http://localhost:$hostport/health/ready" 2>/dev/null)" \
        && printf '%s' "$body" | grep -q '"database":"ok"' && ok=1 && break
      sleep 2
    done
    [ "$ok" = 1 ] || fail "/health/ready through the Ingress stopped answering after the ha rollout"
    echo "  ✓ 2 replicas, Erlang-clustered, PDB present, still serving through the Ingress"

    step "tearing down"
    k3d cluster delete "{{k8s_cluster}}" >/dev/null 2>&1
    echo ""
    echo "  ✓ e2e-k8s: target=kubernetes light and ha applied and served, and the stand-in is gone."

# Hold a port open to reach it from the browser.
[doc("Hold a port open to reach it from the browser, on :4000.")]
forward: _require-cluster
    @echo "http://localhost:4000  (ctrl-c to stop)"
    kubectl port-forward -n "{{ns}}" svc/fountain 4000:80

# ── first login ────────────────────────────────────────────────────────────

# Mark an account's email verified, without any mail being sent.
#
# This deployment sends no mail — emailDelivery defaults to "none" because
# without Resend's DNS records mail is silently discarded. On images after
# v0.4.0 (fountain ADR 0011) that mode self-verifies accounts at registration,
# so first login needs no target at all and this one is idempotent when run
# anyway. It stays for two cases: accounts that predate the pin carrying ADR
# 0011, and an instance whose real mail provider (resend/smtp) is broken.
#
# On v0.4.0 and earlier this target was mandatory, and skipping it did not
# look like an error: signing in appeared to work — the POST returned a
# redirect to /onboarding/step_1 — and then every authenticated page bounced
# straight back to /auth/login, with nothing on screen saying why.
[doc("Mark an account's email verified, without any mail being sent.")]
verify-email EMAIL: _require-cluster
    #!/usr/bin/env bash
    set -euo pipefail

    EMAIL="{{EMAIL}}"
    if ! printf '%s' "$EMAIL" | grep -qE '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'; then
      echo "  ✗ not an email address: $EMAIL" >&2
      exit 2
    fi

    # A separate pod, not `kubectl exec` into the running one.
    #
    # On v0.3.0 this was forced: Release tasks booted the whole application —
    # including the metrics endpoint on 9568, already bound in the pod that is
    # serving — so the documented `bin/fountain_server eval` died with
    # :eaddrinuse before it reached the database. v0.4.0 starts only the Repo
    # for these tasks (fountain#256), so exec would work now. The separate pod
    # stays: it leaves the serving pod alone, and a pod that runs and exits is
    # a cleaner unit than a shell inside one that must keep serving.
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

# Grant an account the admin role, so /admin stops bouncing it to /dashboard.
#
# On images after v0.4.0, first login does not need this: FIRST_USER_ADMIN=true
# in the pod spec (fountain ADR 0011) promotes the instance's first verified
# account in-app, and running this against it reports "was already an admin".
# It stays for the manual path (firstUserAdmin=false), for promoting a *second*
# admin without opening the panel, and for lock-out recovery.
#
# History: upstream's release-task bootstrap (fountain#275, in the pin since
# v0.4.0 — #31 tracked waiting for it) replaced the raw SQL both upstream
# deploy guides used to end in; ADR 0011 moved first-admin in-app. The grant
# is audit-recorded as `admin.role.granted` with a nil actor either way, so a
# promotion made here is as visible in the admin audit trail as one made from
# the panel. Revoking has no release task on purpose — that is done from the
# panel, by an admin.
#
# Needs a registered, verified account.
[doc("Grant an account the admin role, audit-recorded.")]
promote-admin EMAIL: _require-cluster
    #!/usr/bin/env bash
    set -euo pipefail

    EMAIL="{{EMAIL}}"
    if ! printf '%s' "$EMAIL" | grep -qE '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'; then
      echo "  ✗ not an email address: $EMAIL" >&2
      exit 2
    fi

    # The same pod shape as verify-email above, for the reasons its comment
    # gives: a separate pod, spec lifted from the live Deployment so the eval
    # cannot drift from the env the app runs with.
    spec="$(kubectl get deploy fountain -n "{{ns}}" -o json | jq -c --arg e "$EMAIL" '
      .spec.template.spec
      | .restartPolicy = "Never"
      | .containers |= [ .[0]
          | .name = "eval"
          | .command = ["/app/bin/fountain_server", "eval", "Fountain.Release.promote_admin(\"\($e)\")"]
          | del(.args, .livenessProbe, .readinessProbe, .startupProbe, .ports)
        ]')"

    set +e
    out="$(kubectl run "fountain-promote-admin-$$" --rm -i --restart=Never -n "{{ns}}" \
      --image=unused --quiet --overrides="{\"apiVersion\":\"v1\",\"spec\":$spec}" 2>&1)"
    rc=$?
    set -e

    # Same contract as verify-email: the eval reports a missing account with
    # an error tuple that sets no exit code, so the printed line decides.
    if printf '%s' "$out" | grep -q "Granted admin to"; then
      echo "  ✓ $EMAIL is an admin — /admin answers for it now"
      exit 0
    fi

    if printf '%s' "$out" | grep -q "is already an admin"; then
      echo "  ✓ $EMAIL was already an admin"
      exit 0
    fi

    if printf '%s' "$out" | grep -q "No account found"; then
      echo "  ✗ no account for $EMAIL" >&2
      echo "    Register it first: just forward, then http://localhost:4000/auth/register" >&2
      exit 1
    fi

    echo "$out" >&2
    echo "  ✗ could not promote $EMAIL (kubectl exit $rc)" >&2
    exit 1

# ── the conversation gate ──────────────────────────────────────────────────

# Prove a conversation runs: throwaway agent, one prompt, stream, tear down.
#
# `just verify` asks /health. A 200 there says the release booted. It does not
# say it reached its database, resolved its secrets, provisioned a sandbox or
# streamed anything back. This does.
#
# Two claims, and which one you get is not implicit — MODE picks it:
#
#   plumbing (default)  provision happened, a turn ran, events streamed in
#                       order, exit 0. True against either data plane. Catches
#                       a broken Secret, an unreachable data plane, a
#                       migration that did not run.
#
#   strict              additionally, a model actually replied. Refuses to run
#                       against dataPlane=spritzer, because the emulator
#                       answers exec by echoing the command back: every
#                       plumbing assertion above passes with no model in the
#                       loop at all. A gate that cannot tell those apart is
#                       worse than no gate, so this one fails closed.
#
# Needs a verified account — register, then `just verify-email`. Password comes
# from $FOUNTAIN_PASSWORD rather than the command line, so it stays out of your
# shell history.
[doc("Prove a conversation runs: throwaway agent, one prompt, stream, tear down.")]
verify-conversation EMAIL MODE="plumbing": _require-cluster
    #!/usr/bin/env bash
    set -euo pipefail

    case "{{MODE}}" in plumbing|strict) ;; *) echo "MODE must be plumbing or strict" >&2; exit 2 ;; esac
    # No apostrophe in this message. bash 3.2, which is what macOS ships, treats
    # one inside ${VAR:?...} as an opening quote and mis-parses the rest of the
    # script — the symptom is an "unbound variable" for something assigned two
    # lines further down, which sends you looking in the wrong place entirely.
    : "${FOUNTAIN_PASSWORD:?set FOUNTAIN_PASSWORD to the password for this account}"

    # Which data plane is actually deployed, read off the live Deployment
    # rather than from a parameter — the parameter says what was built, this
    # says what is running.
    # Every env value on the app container, and look for the emulator's service
    # name in it. A jsonpath filter — env[?(@.name=="SPRITES_BASE_URL")] — is
    # the obvious way to write this and bash 3.2, which is what macOS ships,
    # mis-parses the `?(` inside `$( )` and silently leaves the variable unset.
    plane=sprites
    envValues="$(kubectl get deploy fountain -n "{{ns}}" -o jsonpath='{.spec.template.spec.containers[0].env[*].value}' 2>/dev/null || true)"
    case "$envValues" in *fountain-spritzer*) plane=spritzer ;; esac
    echo "  data plane: $plane"

    if [ "{{MODE}}" = "strict" ] && [ "$plane" = "spritzer" ]; then
      echo "  ✗ strict needs a real data plane. This deployment runs the emulator," >&2
      echo "    which echoes the runtime command back instead of calling a model," >&2
      echo "    so a green run here would prove nothing about a reply." >&2
      echo "    Redeploy with --param dataPlane=sprites and a real SPRITES_TOKEN." >&2
      exit 1
    fi

    kubectl port-forward -n "{{ns}}" svc/fountain 14000:80 >/dev/null 2>&1 &
    pf=$!
    base=http://localhost:14000
    # Everything below is a throwaway. The trap is what makes that true even
    # when an assertion fails — losing the port-forward is fine, leaving an
    # agent and a live sandbox behind is not.
    conv=""; agent=""
    cleanup() {
      [ -n "$conv" ]  && curl -s -o /dev/null -X POST "$base/api/conversations/$conv/terminate" -H "authorization: Bearer ${key:-}" || true
      [ -n "$agent" ] && curl -s -o /dev/null -X DELETE "$base/api/agents/$agent" -H "authorization: Bearer ${key:-}" || true
      kill $pf 2>/dev/null || true
    }
    trap cleanup EXIT

    for _ in $(seq 1 30); do curl -s -o /dev/null -m 2 "$base/health" && break || sleep 1; done

    jsonstr() { grep -o "\"$1\":\"[^\"]*\"" | head -1 | cut -d'"' -f4; }

    key="$(curl -s -X POST "$base/api/auth/token" -H 'content-type: application/json' \
      -d "{\"email\":\"{{EMAIL}}\",\"password\":\"$FOUNTAIN_PASSWORD\"}" | jsonstr api_key)"
    [ -n "$key" ] || { echo "  ✗ could not get an API key for {{EMAIL}} — is it registered and verified?" >&2; exit 1; }

    agent="$(curl -s -X POST "$base/api/agents" -H "authorization: Bearer $key" -H 'content-type: application/json' \
      -d '{"name":"verify-throwaway","model":"anthropic/claude-sonnet-4-6","runtime":"claude"}' | jsonstr id)"
    [ -n "$agent" ] || { echo "  ✗ could not create the throwaway agent" >&2; exit 1; }

    conv="$(curl -s -X POST "$base/api/conversations" -H "authorization: Bearer $key" -H 'content-type: application/json' \
      -d "{\"agent_id\":\"$agent\",\"prompt\":\"Reply with the single word: fountain\"}" | jsonstr id)"
    [ -n "$conv" ] || { echo "  ✗ could not open a conversation" >&2; exit 1; }
    echo "  conversation $conv"

    # Poll to a terminal state. A fixed sleep is the usual shortcut here and it
    # is how this check starts passing on a fast machine and failing on a slow
    # one.
    for _ in $(seq 1 60); do
      st="$(curl -s "$base/api/conversations/$conv" -H "authorization: Bearer $key" | jsonstr status)"
      case "$st" in pending|running) sleep 2 ;; *) break ;; esac
    done

    ev="$(curl -sN --max-time 20 "$base/api/conversations/$conv/stream?wait=false" -H "authorization: Bearer $key")"

    fail() { echo "  ✗ $1" >&2; echo "$ev" | head -30 >&2; exit 1; }
    printf '%s' "$ev" | grep -q '"stage":"provision"' || fail "no provision stage — no sandbox was requested"
    printf '%s' "$ev" | grep -q '"stage":"turn"'      || fail "no turn stage — nothing ran in the sandbox"
    printf '%s' "$ev" | grep -q '"exit_code\\":0'     || fail "the turn did not exit 0"
    printf '%s' "$ev" | grep -q 'event: output'       || fail "the turn produced no output at all"
    echo "  ✓ plumbing: sandbox provisioned, turn ran, output streamed, exit 0"

    if [ "{{MODE}}" = "strict" ]; then
      # The claude runtime's terminal event. spritzer never emits one — it
      # echoes the command line and exits — so this is the assertion that
      # cannot be satisfied without a model on the other end.
      printf '%s' "$ev" | grep -q '\\"type\\":\\"result\\"' \
        || fail "no result event — the turn ran but no model replied"
      echo "  ✓ strict: a model replied"
    fi

# Print MASTER_SECRETS_KEY, so it can be kept somewhere the cluster is not.
[doc("Print MASTER_SECRETS_KEY, so it can be kept somewhere the cluster is not.")]
master-key: _require-cluster
    #!/usr/bin/env bash
    # The one thing a database backup cannot recreate.
    #
    # Every tenant's inference credentials are encrypted under this key and
    # stored in fountain's Postgres. A dump restored without it is ciphertext:
    # the rows come back, the tables count, `just restore-drill` passes, and not
    # one credential can be read. Losing this key is losing that data, and it is
    # currently generated by `just secret` and stored only in the cluster — so
    # `just down` on a real deployment loses it.
    #
    # Hence a target that prints it rather than a doc paragraph asking you to go
    # and find it. Put it somewhere the cluster is not: a password manager, a
    # different account, anywhere whose failure is uncorrelated with the
    # database's.
    #
    # It prints to stdout on purpose. Writing it to a file in the repo would be
    # the one thing this project says it will never do, and piping it somewhere
    # is your decision to make deliberately.
    set -euo pipefail
    # Unconditional, not `[ -t 1 ]`. Gating on "is stdout a terminal" gets this
    # exactly backwards in every context that matters: a pipe, a CI step, a
    # command-substitution in someone's script and an agent's tool output are
    # all not-a-terminal, and all places a secret should not appear by
    # accident. The opt-in is the whole guard, so it applies everywhere.
    if [ "${I_MEAN_IT:-}" != "1" ]; then
      echo "  This prints MASTER_SECRETS_KEY to stdout, wherever that goes." >&2
      echo "" >&2
      echo "    Somewhere safe:  I_MEAN_IT=1 just master-key | pbcopy" >&2
      echo "    On screen:       I_MEAN_IT=1 just master-key" >&2
      exit 2
    fi
    kubectl get secret "{{secret}}" -n "{{ns}}" -o jsonpath='{.data.MASTER_SECRETS_KEY}' | base64 -d
    echo ""

# ── operating ──────────────────────────────────────────────────────────────

[doc("Everything in the namespace.")]
status: _require-cluster
    kubectl get all,pvc,cronjob -n "{{ns}}"

[doc("The app's logs, following.")]
logs: _require-cluster
    kubectl logs -n "{{ns}}" deployment/fountain --tail=100 -f

[doc("The database's logs.")]
pg-logs: _require-cluster
    kubectl logs -n "{{ns}}" deployment/fountain-postgres --tail=50

# Run the backup CronJob now instead of waiting for its schedule.
[doc("Run the backup CronJob now instead of waiting for its schedule.")]
backup-now: _require-cluster
    kubectl create job -n "{{ns}}" --from=cronjob/fountain-pg-backup "manual-$(date +%s)"

# Prove the latest backup can be read back, without touching the live database.
[doc("Prove the latest backup can be read back, without touching the live database.")]
restore-drill: _require-cluster
    #!/usr/bin/env bash
    # The backup job says "Backup complete" when an object of the right size
    # lands in the store. That is the upload verified, not the dump — a corrupt
    # dump of the right size uploads perfectly cleanly, and you find out during
    # the outage.
    #
    # So: restore the newest object into a throwaway database, count what came
    # back against what is live, drop the throwaway. Nothing writes to the live
    # database at any point.
    #
    # A drill that cannot verify is a failing finding ON THE BACKUP, not on the
    # drill. The exit code and the message both say so.
    set -euo pipefail

    cj=fountain-pg-backup
    if ! kubectl get cronjob "$cj" -n "{{ns}}" >/dev/null 2>&1; then
      echo "  ✗ no backup CronJob in {{ns}} — nothing to drill" >&2
      echo "    Needs backups=pg-dump, which is the k3d default." >&2
      exit 2
    fi
    envval() { kubectl get cronjob "$cj" -n "{{ns}}" -o jsonpath="{.spec.jobTemplate.spec.template.spec.containers[0].env[?(@.name=='$1')].value}" 2>/dev/null; }
    bucket="$(envval BUCKET)"; ep="$(envval S3_ENDPOINT)"; ps="$(envval S3_FORCE_PATH_STYLE)"

    # Which database, and how to ask it things. Resolved from the cluster the
    # same way `wait` picks its target: the bundled Deployment, the CNPG
    # primary, or — for a referenced Postgres that is not in the cluster at
    # all — a short-lived pod reading DATABASE_URL from the same Secret the
    # app does, so the connection string never lands in a pod spec or a shell
    # history. The drill Job below gets the same secret/key pair, because at
    # cnpg the platform Secret's DATABASE_URL names a service that does not
    # exist, and the operator's fountain-pg-app is the one that is true.
    if kubectl get deployment fountain-postgres -n "{{ns}}" >/dev/null 2>&1; then
      dbsecret="{{secret}}"; dbkey="DATABASE_URL"; createowner=""
      pgquery() { kubectl exec -n "{{ns}}" deploy/fountain-postgres -- \
        psql -U fountain -d fountain -tAc "$1"; }
    elif kubectl get cluster.postgresql.cnpg.io fountain-pg -n "{{ns}}" >/dev/null 2>&1; then
      dbsecret="fountain-pg-app"; dbkey="uri"
      # pgquery runs as the postgres superuser here, so the throwaway must be
      # owned by the app user or pg_restore (connecting as it) cannot create a
      # single table. The bundled path never sees this because its app user IS
      # the image's superuser — one more thing that path quietly got for free.
      createowner=" OWNER fountain"
      primary="$(kubectl get cluster.postgresql.cnpg.io fountain-pg -n "{{ns}}" -o jsonpath='{.status.currentPrimary}')"
      pgquery() { kubectl exec -n "{{ns}}" "pod/$primary" -c postgres -- \
        psql -U postgres -d fountain -tAc "$1"; }
    else
      dbsecret="{{secret}}"; dbkey="DATABASE_URL"; createowner=""
      pgquery() {
        ov="$(jq -n --arg secret "$dbsecret" --arg key "$dbkey" --arg sql "$1" '{spec:{restartPolicy:"Never",containers:[{name:"psql",image:"postgres:16",command:["sh","-c"],args:["psql \"$DATABASE_URL\" -tAc \"$PSQL_SQL\""],env:[{name:"DATABASE_URL",valueFrom:{secretKeyRef:{name:$secret,key:$key}}},{name:"PSQL_SQL",value:$sql}]}]}}')"
        kubectl run "fountain-drill-sql-$(date +%s)" --rm -i --restart=Never \
          -n "{{ns}}" --image=postgres:16 --quiet --overrides "$ov"
      }
    fi

    drilldb="fountain_drill_$(date +%s)"
    job="fountain-drill-$(date +%s)"
    echo "  store:       ${ep:-aws} / $bucket"
    echo "  throwaway:   $drilldb"

    # What the live database has, to compare against. A hardcoded number would
    # pass a restore of last month's schema.
    live="$(pgquery "select count(*) from information_schema.tables where table_schema='public'" 2>/dev/null | tr -d '[:space:]')"
    echo "  live tables: $live"

    cleanup() {
      kubectl delete job "$job" -n "{{ns}}" --ignore-not-found >/dev/null 2>&1 || true
      # Always drop the throwaway, pass or fail. A drill that leaves a database
      # behind is a drill nobody runs twice.
      pgquery "DROP DATABASE IF EXISTS \"$drilldb\"" >/dev/null 2>&1 || true
    }
    trap cleanup EXIT

    # Created here rather than in the Job, because only this side knows who
    # has CREATEDB: the Job connects as the app user, and at cnpg the app user
    # deliberately cannot create databases.
    pgquery "CREATE DATABASE \"$drilldb\"$createowner" >/dev/null

    sed -e "s|__JOB__|$job|g" -e "s|__NS__|{{ns}}|g" -e "s|__SECRET__|{{secret}}|g" \
        -e "s|__DB_SECRET__|$dbsecret|g" -e "s|__DB_KEY__|$dbkey|g" \
        -e "s|__DRILL_DB__|$drilldb|g" -e "s|__BUCKET__|$bucket|g" \
        -e "s|__S3_ENDPOINT__|$ep|g" -e "s|__PATH_STYLE__|${ps:-false}|g" \
        scripts/restore-drill.yaml | kubectl apply -f - >/dev/null

    kubectl wait --for=condition=complete --timeout=300s job/"$job" -n "{{ns}}" >/dev/null 2>&1 || true
    out="$(kubectl logs -n "{{ns}}" job/"$job" --all-containers --tail=200 2>&1 || true)"
    printf '%s\n' "$out" | grep -E "DRILL_KEY=|DRILL_FAIL:|DRILL_RESTORED_TABLES=" | sed 's/^/  /' || true

    n="$(printf '%s' "$out" | sed -n 's/.*DRILL_RESTORED_TABLES=\([0-9]*\).*/\1/p' | head -1)"
    if [ -z "$n" ]; then
      echo "" >&2
      echo "  ✗ the latest backup did not restore." >&2
      echo "    That is a finding on the backup, not on the drill." >&2
      # The drill's own diagnosis if it produced one, and only the raw log if
      # it did not — `kubectl logs --all-containers` reports the container that
      # never started, which reads like the cause and is not.
      why="$(printf '%s' "$out" | sed -n 's/.*DRILL_FAIL: //p' | head -1)"
      if [ -n "$why" ]; then
        echo "" >&2
        echo "    $why" >&2
      else
        printf '%s\n' "$out" | grep -v "waiting to start: PodInitializing" | tail -12 >&2
      fi
      exit 1
    fi
    if [ "$n" != "$live" ]; then
      echo "" >&2
      echo "  ✗ restored $n tables; the live database has $live." >&2
      echo "    The backup is not a faithful copy. A finding on the backup." >&2
      exit 1
    fi
    echo "  ✓ restored $n tables, matched live, threw the copy away"
    echo ""
    echo "    What this did not prove: a restored database is ciphertext for"
    echo "    every tenant credential. inference_credentials is encrypted under"
    echo "    MASTER_SECRETS_KEY, so this dump is only recoverable alongside the"
    echo "    key it was written under — see \`just master-key\`."

# Prove the PITR archive can become a database again, without touching the live one.
#
# The pg-dump drill above proves a logical dump reads back; this proves the
# other backup mode's whole chain — the newest base backup, plus the WAL
# archived after it, replayed by a recovery bootstrap. The throwaway is a
# real one-instance CNPG cluster, because that is what a barman restore
# produces; it is deleted whether the drill passed or failed.
[doc("Prove the PITR archive restores into a working cluster. Needs backups=barman-pitr.")]
pitr-drill: _require-cluster
    #!/usr/bin/env bash
    set -euo pipefail
    if ! kubectl get objectstore.barmancloud.cnpg.io fountain-backups -n "{{ns}}" >/dev/null 2>&1; then
      echo "  ✗ no ObjectStore in {{ns}} — nothing to drill" >&2
      echo "    Needs backups=barman-pitr, which needs postgres=cnpg." >&2
      exit 2
    fi
    primary="$(kubectl get cluster.postgresql.cnpg.io fountain-pg -n "{{ns}}" -o jsonpath='{.status.currentPrimary}')"
    [ -n "$primary" ] || { echo "  ✗ fountain-pg has no current primary — is the live cluster healthy?" >&2; exit 1; }

    live="$(kubectl exec -n "{{ns}}" "pod/$primary" -c postgres -- \
      psql -U postgres -d fountain -tAc \
      "select count(*) from information_schema.tables where table_schema='public'" 2>/dev/null | tr -d '[:space:]')"
    drill="fountain-pg-drill-$(date +%s)"
    echo "  live tables:  $live"
    echo "  throwaway:    $drill (recovery from ObjectStore fountain-backups)"

    cleanup() {
      kubectl delete cluster.postgresql.cnpg.io "$drill" -n "{{ns}}" --ignore-not-found --wait=false >/dev/null 2>&1 || true
    }
    trap cleanup EXIT

    cnpg_image="$(kubectl get cluster.postgresql.cnpg.io fountain-pg -n "{{ns}}" -o jsonpath='{.spec.imageName}')"
    pg_storage="$(kubectl get cluster.postgresql.cnpg.io fountain-pg -n "{{ns}}" -o jsonpath='{.spec.storage.size}')"
    sed -e "s|__DRILL_CLUSTER__|$drill|g" -e "s|__NS__|{{ns}}|g" \
        -e "s|__CNPG_IMAGE__|$cnpg_image|g" -e "s|__PG_STORAGE__|$pg_storage|g" \
        scripts/pitr-drill.yaml | kubectl apply -f - >/dev/null

    ready=""
    for i in $(seq 1 60); do
      ready="$(kubectl get cluster.postgresql.cnpg.io "$drill" -n "{{ns}}" -o jsonpath='{.status.readyInstances}' 2>/dev/null)"
      [ "$ready" = "1" ] && break
      sleep 5
    done
    if [ "$ready" != "1" ]; then
      echo "" >&2
      echo "  ✗ the recovery cluster never became ready." >&2
      echo "    That is a finding on the archive, not on the drill." >&2
      kubectl get cluster.postgresql.cnpg.io "$drill" -n "{{ns}}" -o jsonpath='{.status.phase} — {.status.phaseReason}' >&2 || true
      echo "" >&2
      exit 1
    fi

    n="$(kubectl exec -n "{{ns}}" "pod/$drill-1" -c postgres -- \
      psql -U postgres -d fountain -tAc \
      "select count(*) from information_schema.tables where table_schema='public'" 2>/dev/null | tr -d '[:space:]')"
    if [ "$n" != "$live" ]; then
      echo "" >&2
      echo "  ✗ recovered $n tables; the live database has $live." >&2
      echo "    The archive is not a faithful copy. A finding on the archive." >&2
      exit 1
    fi
    echo "  ✓ recovered $n tables from base backup + WAL, matched live, threw the cluster away"
    echo ""
    echo "    Same caveat as the dump drill: the rows are ciphertext without"
    echo "    MASTER_SECRETS_KEY — see \`just master-key\`."

# What the deployment would look like elsewhere, without applying anything.
[doc("What the deployment would look like elsewhere, without applying anything.")]
preview target="kubernetes" tier="ha" class="nginx":
    npx chant build src --format yaml --param target={{target}} --param tier={{tier}} --param ingressClassName={{class}}

# Ask a real API server whether it would accept the output.
[doc("Ask a real API server whether it would accept the output.")]
dry-run *ARGS: _require-cluster
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

# Install the controllers that reconcile what `just crds` declares.
[doc("Install the controllers that reconcile what `just crds` declares.")]
operators: _require-cluster
    #!/usr/bin/env bash
    # `just crds` is schemas only: manifests validate, nothing runs. This is the
    # other half — after it, postgres=cnpg produces a database that actually
    # accepts connections, and backups=barman-pitr has something archiving into
    # it.
    #
    # Deliberately not part of `just up`, and deliberately not folded into
    # `just crds`. Installing controllers into a cluster is a much bigger action
    # than installing schemas, and the two should not become one command by
    # accident.
    #
    # What this installs:
    #
    #   cert-manager   because the barman plugin declares an Issuer and a
    #                  Certificate and will not start without one
    #   CNPG           the operator, so a Cluster becomes Postgres
    #   barman plugin  so an ObjectStore and a ScheduledBackup mean something
    #
    # and what it does not:
    #
    #   traefik        already running on k3d — k3s ships it
    #   infisical      needs an Infisical server to talk to, which is a separate
    #                  problem from installing a controller
    #   prometheus     kube-prometheus-stack is a lot of laptop for a
    #                  ServiceMonitor
    #
    # Teardown is free here only because `just down` deletes the whole cluster.
    # On a cluster you did not create it is not, which is why this refuses to
    # run against a context it does not recognise.
    set -euo pipefail

    apply() { kubectl apply --server-side --force-conflicts -f "$1" >/dev/null; }
    ready() { kubectl -n "$1" wait --for=condition=Available deploy --all --timeout="${2:-300s}" >/dev/null; }

    echo "cert-manager v{{certmgr_version}}..."
    apply "https://github.com/cert-manager/cert-manager/releases/download/v{{certmgr_version}}/cert-manager.yaml"
    ready cert-manager
    echo "  ✓ cert-manager"

    echo "CloudNativePG v{{cnpg_version}}..."
    apply "https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/release-{{cnpg_major}}/releases/cnpg-{{cnpg_version}}.yaml"
    ready cnpg-system
    echo "  ✓ cnpg"

    echo "barman-cloud plugin v{{barman_version}}..."
    apply "https://github.com/cloudnative-pg/plugin-barman-cloud/releases/download/v{{barman_version}}/manifest.yaml"
    ready cnpg-system
    echo "  ✓ barman-cloud"

    echo ""
    echo "  operators are up. Now: just up postgres=cnpg  (or --param postgres=cnpg)"

# Install the CRDs the operator seams declare against, without the operators.
[doc("Install the CRDs the operator seams declare against, without the operators.")]
crds: _require-cluster
    #!/usr/bin/env bash
    # Enough to validate manifests and nothing else: no controller runs, so
    # nothing is reconciled. Installing the operators is a separate decision
    # and not one this repo makes for you.
    set -euo pipefail
    apply() { kubectl apply --server-side --force-conflicts -f "$1" >/dev/null && echo "  ✓ $2"; }
    cnpg=https://raw.githubusercontent.com/cloudnative-pg/cloudnative-pg/v{{cnpg_version}}/config/crd/bases
    apply "$cnpg/postgresql.cnpg.io_clusters.yaml"         "cnpg Cluster"
    apply "$cnpg/postgresql.cnpg.io_scheduledbackups.yaml"  "cnpg ScheduledBackup"
    apply "https://raw.githubusercontent.com/cloudnative-pg/plugin-barman-cloud/v{{barman_version}}/config/crd/bases/barmancloud.cnpg.io_objectstores.yaml" "barman ObjectStore"
    traefik=https://raw.githubusercontent.com/traefik/traefik-helm-chart/v{{traefik_version}}/traefik/crds
    apply "$traefik/traefik.io_ingressroutes.yaml" "traefik IngressRoute"
    apply "$traefik/traefik.io_middlewares.yaml"   "traefik Middleware"
    apply "https://raw.githubusercontent.com/Infisical/kubernetes-operator/infisical-k8-operator/v{{infisical_version}}/config/crd/bases/secrets.infisical.com_infisicalsecrets.yaml" "InfisicalSecret"
    prom=https://raw.githubusercontent.com/prometheus-operator/prometheus-operator/v{{prom_version}}/example/prometheus-operator-crd
    apply "$prom/monitoring.coreos.com_servicemonitors.yaml" "ServiceMonitor"
    apply "$prom/monitoring.coreos.com_prometheusrules.yaml" "PrometheusRule"
    apply "https://github.com/cert-manager/cert-manager/releases/download/v{{certmgr_version}}/cert-manager.crds.yaml" "cert-manager"
