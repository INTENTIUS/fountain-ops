#!/usr/bin/env bash
# Temporary. One conversation, everything about it, on whatever CPU this is.
#
# The point is that the SAME script runs on arm64 and amd64, so the two outputs
# are comparable line for line. #67.
set -uo pipefail
ns=fountain
say() { echo ""; echo "═══ $1 ═══"; }

say "ARCHITECTURE"
echo "uname -m:      $(uname -m)"
echo "node arch:     $(kubectl get nodes -o jsonpath='{.items[0].status.nodeInfo.architecture}')"

say "IMAGE DIGESTS ACTUALLY PULLED"
kubectl get pods -n $ns -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{range .status.containerStatuses[*]}    {.image}{"\n"}    {.imageID}{"\n"}{end}{end}' \
  | grep -vE '^\s*$' | head -30

email="probe-$(date +%s)@example.com"
pass="probe-$(openssl rand -hex 8)"
say "ACCOUNT: $email"
kubectl run probe-reg --rm -i --restart=Never -n $ns --image=curlimages/curl:8.11.1 --quiet -- \
  curl -fsS -m 15 -X POST "http://fountain.$ns.svc.cluster.local/api/auth/register" \
  -H 'content-type: application/json' -d "{\"email\":\"$email\",\"password\":\"$pass\"}" 2>&1 | tail -1
just verify-email "$email" 2>&1 | tail -1

kubectl port-forward -n $ns svc/fountain 15000:80 >/dev/null 2>&1 &
pf=$!; trap 'kill $pf 2>/dev/null || true' EXIT
for _ in $(seq 1 30); do curl -s -o /dev/null -m 2 http://localhost:15000/health && break || sleep 1; done
base=http://localhost:15000
js() { grep -o "\"$1\":\"[^\"]*\"" | head -1 | cut -d'"' -f4; }

key="$(curl -s -X POST "$base/api/auth/token" -H 'content-type: application/json' \
  -d "{\"email\":\"$email\",\"password\":\"$pass\"}" | js api_key)"
agent="$(curl -s -X POST "$base/api/agents" -H "authorization: Bearer $key" -H 'content-type: application/json' \
  -d '{"name":"arch-probe","model":"anthropic/claude-sonnet-4-6","runtime":"claude"}' | js id)"
conv="$(curl -s -X POST "$base/api/conversations" -H "authorization: Bearer $key" -H 'content-type: application/json' \
  -d "{\"agent_id\":\"$agent\",\"prompt\":\"Reply with the single word: fountain\"}" | js id)"
echo "conversation: $conv"

for _ in $(seq 1 60); do
  st="$(curl -s "$base/api/conversations/$conv" -H "authorization: Bearer $key" | js status)"
  case "$st" in pending|running) sleep 2 ;; *) break ;; esac
done
echo "terminal status: ${st:-unknown}"

say "FULL EVENT STREAM"
curl -sN --max-time 20 "$base/api/conversations/$conv/stream?wait=false" -H "authorization: Bearer $key"

say "STAGES IN ORDER"
curl -sN --max-time 20 "$base/api/conversations/$conv/stream?wait=false" -H "authorization: Bearer $key" \
  | grep -o '"stage":"[a-z_]*"[^}]*"state":"[a-z_]*"' || echo "(none matched)"

say "DID reattach APPEAR AT ALL?"
if curl -sN --max-time 20 "$base/api/conversations/$conv/stream?wait=false" -H "authorization: Bearer $key" | grep -q '"stage":"reattach"'; then
  echo "YES — the reattach path was taken"
else
  echo "NO — reattach never ran, so the difference is upstream of the 426"
fi

say "SPRITZER LOGS"
kubectl logs -n $ns deployment/fountain-spritzer --tail=40 2>&1 | tail -20

say "FOUNTAIN LOGS around reattach/exec"
kubectl logs -n $ns deployment/fountain --tail=200 2>&1 | grep -iE 'reattach|exec|session|websocket|426|upgrade' | tail -20

curl -s -o /dev/null -X POST "$base/api/conversations/$conv/terminate" -H "authorization: Bearer $key" || true
curl -s -o /dev/null -X DELETE "$base/api/agents/$agent" -H "authorization: Bearer $key" || true
echo ""; echo "═══ PROBE COMPLETE ═══"
