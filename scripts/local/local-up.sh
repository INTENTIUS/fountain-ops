#!/usr/bin/env bash
# The k3d cluster's lifecycle, where behold looks for it.
#
# behold offers a one-click Bring up on a substrate pill only when the project
# ships a script at this path (src/substrates.ts), so this exists to be found.
# It is a wrapper, not a second way to create the cluster: `just cluster-up` is
# the one implementation, and a second one would be a thing to keep in step.
set -euo pipefail
cd "$(dirname "$0")/../.."
exec just cluster-up
