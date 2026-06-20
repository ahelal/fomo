#!/usr/bin/env bash
# Runs before the main postCreate steps.
# Installs Azure CLI inside the devcontainer if it is missing.

set -euo pipefail
if [[ "${DEV_COPILOT_TRACE:-}" == "1" ]]; then set -x; fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$script_dir/install-az-cli.sh"
