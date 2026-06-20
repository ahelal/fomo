#!/usr/bin/env bash
# Installs Azure CLI inside the devcontainer when it is missing.
# Requires root privileges.

set -euo pipefail
if [[ "${DEV_COPILOT_TRACE:-}" == "1" ]]; then set -x; fi

if command -v az >/dev/null 2>&1; then
    echo "[az-cli] Azure CLI already installed: $(az version --query '"azure-cli"' -o tsv 2>/dev/null || echo unknown)"
    if az account show >/dev/null 2>&1; then
        echo "[az-cli] Azure CLI is already logged in."
    else
        echo "[az-cli] Azure CLI is installed but not logged in. Run 'az login' before deploying."
    fi
    exit 0
fi

if [[ "$(id -u)" -ne 0 ]]; then
    echo "[az-cli] Error: root privileges required to install Azure CLI." >&2
    exit 1
fi

if [[ -f /etc/os-release ]]; then
    # shellcheck source=/dev/null
    . /etc/os-release
else
    echo "[az-cli] Error: /etc/os-release not found." >&2
    exit 1
fi

case "${ID:-unknown}" in
    ubuntu|debian)
        echo "[az-cli] Installing Azure CLI via Microsoft apt repository..."
        apt-get update -y
        apt-get install -y ca-certificates curl apt-transport-https lsb-release gnupg
        curl -sL https://aka.ms/InstallAzureCLIDeb | bash
        apt-get install -y azure-cli
        ;;
    *)
        echo "[az-cli] Warning: unsupported distro '${ID:-unknown}' for automatic Azure CLI install." >&2
        echo "[az-cli] Please install Azure CLI manually and run 'az login' before deploying." >&2
        exit 1
        ;;
esac

echo "[az-cli] Azure CLI installed."
if az account show >/dev/null 2>&1; then
    echo "[az-cli] Azure CLI is already logged in."
else
    echo "[az-cli] Azure CLI is installed; run 'az login' before deploying."
fi
