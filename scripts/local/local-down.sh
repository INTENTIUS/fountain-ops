#!/usr/bin/env bash
# The other half of local-up.sh. Deletes the cluster, which is what makes
# everything `just operators` installs free to undo.
set -euo pipefail
cd "$(dirname "$0")/../.."
exec just down
