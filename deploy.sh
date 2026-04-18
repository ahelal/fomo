#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Build, push, and deploy FOMO to Azure
#
# Prerequisites:
#   az login
#   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET env vars set
#
# Usage:
#   ./deploy.sh <resource-group> [location]
# =============================================================================
set -euo pipefail

YES=false
ARGS=()
for arg in "$@"; do
  case "$arg" in
    -y|--yes) YES=true ;;
    *) ARGS+=("$arg") ;;
  esac
done

RG="${ARGS[0]:?Usage: ./deploy.sh <resource-group> [location] [-y]}"
LOCATION="${ARGS[1]:-swedencentral}"
PROJECT="fomo"
APP_NAME="${PROJECT}-app"   # Container App name as defined in Bicep app module

for var in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET SESSION_SECRET; do
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: $var must be set"
    exit 1
  fi
done

echo "═══════════════════════════════════════════════════"
echo " Deploying FOMO → resource group: $RG ($LOCATION)"
echo "═══════════════════════════════════════════════════"

# ── 1. Create resource group ──────────────────────────────────────────────────
az group create --name "$RG" --location "$LOCATION" --output none
echo "✓ Resource group ready"

# ── 2. Show what-if plan ──────────────────────────────────────────────────────
echo ""
echo "▶ Running what-if…"
az deployment group create \
  --resource-group "$RG" \
  --template-file infra/main.bicep \
  --parameters infra/main.bicepparam \
  --parameters googleClientId="$GOOGLE_CLIENT_ID" googleClientSecret="$GOOGLE_CLIENT_SECRET" sessionSecret="$SESSION_SECRET" location="$LOCATION" \
  --what-if \
  --output table

echo ""
if [[ "$YES" == "true" ]]; then
  echo "▶ Auto-confirming (--yes flag set)"
else
  read -rp "Apply this deployment? [y/N] " confirm
  [[ "$confirm" =~ ^[Yy]$ ]] || { echo "Aborted."; exit 0; }
fi

# ── 3. Bootstrap: deploy registry FIRST so we can push the image ──────────────
#    Uses the same naming formula as main.bicep → idempotent on re-runs.
echo "▶ Deploying container registry…"
BOOTSTRAP_OUT=$(az deployment group create \
  --resource-group "$RG" \
  --name "bootstrap" \
  --template-file infra/bootstrap.bicep \
  --parameters projectName="$PROJECT" location="$LOCATION" \
  --output json)

REGISTRY=$(echo "$BOOTSTRAP_OUT" | jq -r '.properties.outputs.loginServer.value')
echo "✓ Registry: $REGISTRY"

# ── 4. Build and push image via ACR remote build (no local Docker needed) ─────
echo "▶ Building image remotely on ACR…"
az acr build \
  --registry "${REGISTRY%%.*}" \
  --image "$PROJECT:latest" \
  --file Dockerfile \
  . \
  --no-logs
echo "✓ Image built and pushed"

# ── 5. Deploy full infrastructure (image exists → Container App succeeds) ──────
echo "▶ Deploying full infrastructure…"
DEPLOY_OUT=$(az deployment group create \
  --resource-group "$RG" \
  --template-file infra/main.bicep \
  --parameters infra/main.bicepparam \
  --parameters googleClientId="$GOOGLE_CLIENT_ID" googleClientSecret="$GOOGLE_CLIENT_SECRET" sessionSecret="$SESSION_SECRET" location="$LOCATION" \
  --output json)

FOMO_URL=$(echo "$DEPLOY_OUT" | jq -r '.properties.outputs.url.value')

# ── 6. Force a new revision so the Container App picks up the pushed image ─────
#    (Needed on re-deploys when only the image changed, not the Bicep config.)
echo "▶ Refreshing Container App revision…"
az containerapp update \
  --resource-group "$RG" \
  --name "$APP_NAME" \
  --image "$REGISTRY/$PROJECT:latest" \
  --output none

echo ""
echo "✅ Deployment complete!"
echo "   FOMO : $FOMO_URL"
echo ""
echo "Next steps:"
echo "  # Configure the CLI to use Azure Storage directly:"
echo "  fomo config set --connection-string '<your-storage-connection-string>'"

