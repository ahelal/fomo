// FOMO infrastructure: a single Storage Account.
//   • Table Storage  — updates, topics (Copilot digest), settings, todos
//   • Static website — the installable PWA, served from the $web container
// Fetching and digesting run locally in the `fomo` TUI; there is no compute.

// ─── Parameters ───────────────────────────────────────────────────────────────
@description('Azure region for all resources')
param location string = resourceGroup().location

@description('Short slug used to name all resources, e.g. "fomo"')
param projectName string = 'fomo'

@description('Environment tag, e.g. prod / staging')
param environmentName string = 'prod'

@description('Extra browser origins allowed to call Table Storage (the static website origin is always allowed)')
param extraCorsOrigins array = [
  'http://localhost:5173'
  'http://localhost:4173'
]

// ─── Modules ──────────────────────────────────────────────────────────────────
module storage './modules/storage.bicep' = {
  name: 'storage'
  params: {
    location: location
    // Storage account names must be 3-24 alphanumeric chars, globally unique.
    // Same formula as earlier releases so existing data is kept.
    accountName: '${take(replace(projectName, '-', ''), 10)}${take(uniqueString(resourceGroup().id), 13)}'
    extraCorsOrigins: extraCorsOrigins
    tags: { project: projectName, environment: environmentName }
  }
}

// ─── Outputs ──────────────────────────────────────────────────────────────────
@description('Storage account name')
output storageAccountName string = storage.outputs.name

@description('Table Storage endpoint')
output tableEndpoint string = storage.outputs.tableEndpoint

@description('Static website URL (the FOMO web app)')
output webUrl string = storage.outputs.webUrl
