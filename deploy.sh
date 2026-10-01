#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Deploy FOMO to Azure (a single Storage Account, no compute)
#
#   • Table Storage  — the data (updates, topics, settings, todos)
#   • Static website — the web app / installable PWA ($web container)
#
# Fetching and Copilot digests run locally in the `fomo` TUI.
#
# Prerequisites: az login, jq, node + pnpm
#
# Usage:
#   ./deploy.sh <resource-group> [location] [-y|--yes] [--cleanup-legacy]
#
#   --yes             Skip the what-if confirmation prompt
#   --cleanup-legacy  Delete the Container Apps, Container Apps environment,
#                     Log Analytics workspace and Container Registry created by
#                     earlier FOMO releases (the storage account and its data stay)
# =============================================================================
set -euo pipefail

YES=false
CLEANUP_LEGACY=false
ARGS=()
for arg in "$@"; do
  case "$arg" in
    -y|--yes) YES=true ;;
    --cleanup-legacy) CLEANUP_LEGACY=true ;;
    -*) echo "Unknown option: $arg" >&2; exit 1 ;;
    *) ARGS+=("$arg") ;;
  esac
done

RG="${ARGS[0]:?Usage: ./deploy.sh <resource-group> [location] [-y] [--cleanup-legacy]}"
LOCATION="${ARGS[1]:-swedencentral}"
PROJECT="fomo"
PNPM="${PNPM:-pnpm}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST="$ROOT/packages/web/dist"

for cmd in az jq; do
  command -v "$cmd" >/dev/null || { echo "ERROR: '$cmd' is required"; exit 1; }
done

echo "═══════════════════════════════════════════════════"
echo " Deploying FOMO → resource group: $RG ($LOCATION)"
echo "═══════════════════════════════════════════════════"

# ── 1. Build the web app (fail fast before touching Azure) ────────────────────
echo "▶ Building web app…"
(cd "$ROOT" && $PNPM --filter @fomo/web build)
[[ -f "$DIST/index.html" ]] || { echo "ERROR: $DIST/index.html not found after build"; exit 1; }
echo "✓ Web app built"

# ── 2. Resource group ─────────────────────────────────────────────────────────
az group create --name "$RG" --location "$LOCATION" --output none
echo "✓ Resource group ready"

# ── 3. What-if ────────────────────────────────────────────────────────────────
DEPLOY_ARGS=(
  --resource-group "$RG"
  --name "$PROJECT"
  --template-file "$ROOT/infra/main.bicep"
  --parameters "$ROOT/infra/main.bicepparam"
  --parameters projectName="$PROJECT" location="$LOCATION"
)

echo ""
echo "▶ Running what-if…"
az deployment group what-if "${DEPLOY_ARGS[@]}"

echo ""
if [[ "$YES" == "true" ]]; then
  echo "▶ Auto-confirming (--yes flag set)"
else
  read -rp "Apply this deployment? [y/N] " confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }
fi

# ── 4. Deploy infrastructure ──────────────────────────────────────────────────
echo "▶ Deploying storage account…"
DEPLOY_OUT=$(az deployment group create "${DEPLOY_ARGS[@]}" --output json)
ACCOUNT=$(jq -r '.properties.outputs.storageAccountName.value' <<<"$DEPLOY_OUT")
WEB_URL=$(jq -r '.properties.outputs.webUrl.value' <<<"$DEPLOY_OUT")
echo "✓ Storage account: $ACCOUNT"

# Data-plane commands below authenticate with the account key.
export AZURE_STORAGE_ACCOUNT="$ACCOUNT"
AZURE_STORAGE_KEY=$(az storage account keys list -g "$RG" -n "$ACCOUNT" --query '[0].value' -o tsv)
export AZURE_STORAGE_KEY

# ── 5. Static website ─────────────────────────────────────────────────────────
echo "▶ Enabling static website…"
az storage blob service-properties update \
  --static-website --index-document index.html --404-document index.html \
  --only-show-errors --output none

# Hashed assets first (immutable, cached forever) so index.html never points at
# a file that isn't uploaded yet; then the app shell with no-cache so updates
# and the service worker are picked up on the next launch.
echo "▶ Uploading web app…"
if [[ -d "$DIST/assets" ]]; then
  az storage blob upload-batch --destination '$web' --destination-path assets \
    --source "$DIST/assets" --overwrite \
    --content-cache-control 'public, max-age=31536000, immutable' \
    --no-progress --only-show-errors --output none
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
find "$DIST" -maxdepth 1 -type f ! -name 'manifest.webmanifest' -exec cp {} "$STAGE/" \;
az storage blob upload-batch --destination '$web' --source "$STAGE" --overwrite \
  --content-cache-control 'no-cache' \
  --no-progress --only-show-errors --output none
if [[ -f "$DIST/manifest.webmanifest" ]]; then
  az storage blob upload --container-name '$web' --name manifest.webmanifest \
    --file "$DIST/manifest.webmanifest" --overwrite \
    --content-type 'application/manifest+json' --content-cache-control 'no-cache' \
    --no-progress --only-show-errors --output none
fi

# Remove hashed assets left over from previous deployments.
CURRENT_ASSETS="$(cd "$DIST" && find assets -type f 2>/dev/null | LC_ALL=C sort)"
STALE=$(az storage blob list --container-name '$web' --prefix assets/ --query '[].name' -o tsv --only-show-errors \
  | LC_ALL=C sort | LC_ALL=C comm -23 - <(echo "$CURRENT_ASSETS"))
for blob in $STALE; do
  az storage blob delete --container-name '$web' --name "$blob" --only-show-errors --output none
done
echo "✓ Web app uploaded"

# ── 6. Legacy Container Apps resources ────────────────────────────────────────
LEGACY=(
  "Microsoft.App/containerApps:${PROJECT}-app"
  "Microsoft.App/jobs:${PROJECT}-scraper"
  "Microsoft.App/managedEnvironments:${PROJECT}-env"
  "Microsoft.OperationalInsights/workspaces:${PROJECT}-env-logs"
  "Microsoft.ContainerRegistry/registries:${ACCOUNT}"
)
FOUND=()
for entry in "${LEGACY[@]}"; do
  type="${entry%%:*}"; name="${entry#*:}"
  if az resource show -g "$RG" -n "$name" --resource-type "$type" --output none 2>/dev/null; then
    FOUND+=("$entry")
  fi
done

if [[ ${#FOUND[@]} -gt 0 ]]; then
  if [[ "$CLEANUP_LEGACY" == "true" ]]; then
    echo "▶ Removing legacy Container Apps resources…"
    for entry in "${FOUND[@]}"; do
      type="${entry%%:*}"; name="${entry#*:}"
      echo "  - $name ($type)"
      az resource delete -g "$RG" -n "$name" --resource-type "$type" --output none
    done
    echo "✓ Legacy resources removed"
  else
    echo ""
    echo "ℹ Legacy resources from the Container Apps deployment are still running:"
    for entry in "${FOUND[@]}"; do echo "  - ${entry#*:} (${entry%%:*})"; done
    echo "  Re-run with --cleanup-legacy to delete them (your data in Table Storage is kept)."
  fi
fi

echo ""
echo "✅ Deployment complete!"
echo "   Web app : $WEB_URL"
echo ""
echo "Next steps:"
echo "  1. Copy the storage connection string:"
echo "       az storage account show-connection-string -g $RG -n $ACCOUNT -o tsv"
echo "  2. Run fomo and paste it when asked."
echo "  3. Press c, set \"Web app URL\" (under This computer) to $WEB_URL"
echo "  4. Choose \"Link a device\" to get a magic link / QR code for your browser or phone."
echo "  5. Press f any time to fetch updates and group them with Copilot."
