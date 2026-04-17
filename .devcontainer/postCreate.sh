#!/usr/bin/env bash
# Version: 0.7.1
#
# Runs inside the devcontainer after creation (postCreateCommand).
# Installs/upgrades Node.js and GitHub Copilot CLI, configures trusted folders.
#
# Hooks (place alongside this file):
#   postCreate_pre_hook.sh   – runs before the core steps
#   postCreate_post_hook.sh  – runs after the core steps (receives $POST_CREATE_EXIT_CODE)
#
# Hooks run in a separate bash process; add 'set -euo pipefail' in your hook
# if you want strict error handling.
# Requires root privileges (for package manager operations).
# Supported container distros: Ubuntu, Debian, Alpine.

set -euo pipefail
if [[ "${DEV_COPILOT_TRACE:-}" == "1" ]]; then set -x; fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pre_hook_file="$script_dir/postCreate_pre_hook.sh"
post_hook_file="$script_dir/postCreate_post_hook.sh"

run_hook_if_present() {
	local hook_file="$1"
	local hook_name="$2"

	if [[ -f "$hook_file" ]]; then
		echo "[postCreate] Running $hook_name..."
		bash "$hook_file"
	else
		echo "[postCreate] $hook_name not found. Skipping."
	fi
}

run_post_hook() {
	local original_exit_code="$1"

	if [[ -f "$post_hook_file" ]]; then
		echo "[postCreate] Running postCreate_post_hook.sh..."
		POST_CREATE_EXIT_CODE="$original_exit_code" bash "$post_hook_file"
		return "$?"
	fi

	echo "[postCreate] postCreate_post_hook.sh not found. Skipping."
	return 0
}

on_exit() {
	local exit_code="$?"
	local post_hook_exit_code=0

	trap - EXIT
	set +e
	run_post_hook "$exit_code"
	post_hook_exit_code="$?"

	if [[ "$exit_code" -eq 0 && "$post_hook_exit_code" -ne 0 ]]; then
		exit "$post_hook_exit_code"
	fi

	exit "$exit_code"
}

trap on_exit EXIT

# ---------------------------------------------------------------------------
# Detect the container's Linux distribution.
# Echoes a short ID: "ubuntu", "debian", "alpine", or the /etc/os-release ID.
# Falls back to "unknown" when detection is not possible.
# ---------------------------------------------------------------------------
detect_distro() {
	if [[ -f /etc/alpine-release ]]; then
		echo "alpine"
		return
	fi
	if [[ -f /etc/os-release ]]; then
		local distro_id
		# shellcheck source=/dev/null
		distro_id="$(. /etc/os-release && echo "${ID:-unknown}")"
		echo "$distro_id"
		return
	fi
	echo "unknown"
}

DISTRO="$(detect_distro)"
echo "[postCreate] Detected distro: ${DISTRO}"

case "$DISTRO" in
	ubuntu|debian|alpine)
		;;
	*)
		echo "[postCreate] Warning: distro '${DISTRO}' is not officially supported." >&2
		echo "[postCreate] Supported distros: Ubuntu, Debian, Alpine." >&2
		echo "[postCreate] Proceeding, but some steps may fail." >&2
		;;
esac

run_hook_if_present "$pre_hook_file" "postCreate_pre_hook.sh"

NODE_REQUIRED_MAJOR=24

echo "[postCreate] Checking Node.js (>= v${NODE_REQUIRED_MAJOR}) and npm..."
node_major=0
if command -v node >/dev/null 2>&1; then
	node_major="$(node --version | sed 's/^v//' | cut -d. -f1)"
fi

if [[ "$node_major" -lt "$NODE_REQUIRED_MAJOR" ]]; then
	if [[ "$(id -u)" -ne 0 ]]; then
		echo "[postCreate] Error: root privileges required to install Node.js." >&2
		exit 1
	fi
	echo "[postCreate] Node.js v${node_major} is too old (need >= v${NODE_REQUIRED_MAJOR}). Installing v${NODE_REQUIRED_MAJOR}..."

	case "$DISTRO" in
		ubuntu|debian)
			apt-get update -y
			apt-get install -y curl ca-certificates
			# Note: curl|bash for NodeSource setup; pin a known image if supply-chain risk is a concern.
			curl -fsSL "https://deb.nodesource.com/setup_${NODE_REQUIRED_MAJOR}.x" | bash -
			apt-get install -y nodejs
			;;
		alpine)
			apk add --no-cache curl ca-certificates nodejs npm
			# Check if the installed version meets the requirement; if not, try edge/community.
			local_node_major=0
			if command -v node >/dev/null 2>&1; then
				local_node_major="$(node --version | sed 's/^v//' | cut -d. -f1)"
			fi
			if [[ "$local_node_major" -lt "$NODE_REQUIRED_MAJOR" ]]; then
				echo "[postCreate] Alpine default repos have Node.js v${local_node_major}; trying Alpine edge/community..."
				apk add --no-cache \
					--repository https://dl-cdn.alpinelinux.org/alpine/edge/community \
					nodejs npm
			fi
			;;
		*)
			echo "[postCreate] Error: cannot automatically install Node.js on '${DISTRO}'." >&2
			echo "[postCreate] Please install Node.js >= v${NODE_REQUIRED_MAJOR} in your image or a pre-hook." >&2
			exit 1
			;;
	esac
else
	echo "[postCreate] Node.js v${node_major} is already sufficient."
fi

echo "[postCreate] Checking GitHub Copilot CLI..."
installed_version="$(npm -g list @github/copilot --depth=0 2>/dev/null | awk -F@ '/@github\/copilot@/ {print $3; exit}' || true)"
latest_version="$(npm view @github/copilot version 2>/dev/null || true)"

if [[ -z "$installed_version" ]]; then
	echo "[postCreate] Copilot CLI not installed. Installing latest..."
	npm install -g @github/copilot@latest
elif [[ -n "$latest_version" && "$installed_version" != "$latest_version" ]]; then
	echo "[postCreate] Copilot CLI outdated ($installed_version → $latest_version). Updating..."
	npm install -g @github/copilot@latest
else
	echo "[postCreate] Copilot CLI is up to date (${installed_version:-unknown})."
fi

echo "[postCreate] Ensuring Copilot trusts /workspace..."
copilot_config_dir="${COPILOT_HOME:-$HOME/.copilot}"
copilot_config_file="$copilot_config_dir/config.json"
mkdir -p "$copilot_config_dir"

if [[ ! -f "$copilot_config_file" ]]; then
	cat > "$copilot_config_file" <<'JSON'
{
  "trusted_folders": [
    "/workspace"
  ]
}
JSON
	echo "[postCreate] Created $copilot_config_file with trusted_folders: [/workspace]"
else
	if command -v node >/dev/null 2>&1; then
		if node - "$copilot_config_file" <<'JS'
const fs = require("fs");

const path = process.argv[2];
const workspace = "/workspace";

let data;
try {
  const raw = fs.readFileSync(path, "utf8");
  data = JSON.parse(raw);
} catch (err) {
  process.exit(2);
}

if (!data || typeof data !== "object" || Array.isArray(data)) {
  process.stderr.write("Warning: " + path + " has unexpected format; resetting to object\n");
  data = {};
}

let trusted = data.trusted_folders;
if (!Array.isArray(trusted)) {
  trusted = [];
}

if (!trusted.includes(workspace)) {
  trusted.push(workspace);
}

data.trusted_folders = trusted;
fs.writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
JS
		then
			echo "[postCreate] Ensured /workspace is in trusted_folders in $copilot_config_file"
		else
			echo "[postCreate] Warning: Could not parse $copilot_config_file (possibly JSONC/comments)."
			echo "[postCreate] Please add '/workspace' to trusted_folders manually."
		fi
	else
		echo "[postCreate] Warning: node not available; cannot safely update existing $copilot_config_file"
		echo "[postCreate] Please add '/workspace' to trusted_folders manually."
	fi
fi
