#!/usr/bin/env bash
# Version: 0.7.1
#
# Runs on the LOCAL machine before the devcontainer starts (initializeCommand).
# Writes .devcontainer/.env with GITHUB_TOKEN and ensures ~/.copilot exists.
#
# Hooks (place alongside this file):
#   initialize_pre_hook.sh   – runs before the core steps
#   initialize_post_hook.sh  – runs after the core steps (receives $INITIALIZE_EXIT_CODE)
#
# Hooks run in a separate bash process; add 'set -euo pipefail' in your hook
# if you want strict error handling.

set -euo pipefail
if [[ "${DEV_COPILOT_TRACE:-}" == "1" ]]; then set -x; fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pre_hook_file="$script_dir/initialize_pre_hook.sh"
post_hook_file="$script_dir/initialize_post_hook.sh"

run_hook_if_present() {
	local hook_file="$1"
	local hook_name="$2"

	if [[ -f "$hook_file" ]]; then
		echo "[initialize] Running $hook_name..."
		bash "$hook_file"
	else
		echo "[initialize] $hook_name not found. Skipping."
	fi
}

run_post_hook() {
	local original_exit_code="$1"

	if [[ -f "$post_hook_file" ]]; then
		echo "[initialize] Running initialize_post_hook.sh..."
		INITIALIZE_EXIT_CODE="$original_exit_code" bash "$post_hook_file"
		return "$?"
	fi

	echo "[initialize] initialize_post_hook.sh not found. Skipping."
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

run_hook_if_present "$pre_hook_file" "initialize_pre_hook.sh"

echo "[initialize] Writing .devcontainer/.env with GITHUB_TOKEN..."
if ! command -v gh >/dev/null 2>&1; then
	echo "[initialize] Error: 'gh' CLI not found. Install it from https://cli.github.com" >&2
	exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
	echo "[initialize] Error: Not authenticated with GitHub. Run 'gh auth login' first." >&2
	exit 1
fi
echo "GITHUB_TOKEN=$(gh auth token)" > "$script_dir/.env"
if [[ "${DEV_COPILOT_TRACE:-}" == "1" ]]; then
	echo "DEV_COPILOT_TRACE=1" >> "$script_dir/.env"
fi

echo "[initialize] Ensuring ~/.copilot exists..."
mkdir -p "${HOME}/.copilot"
