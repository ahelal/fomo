@description('Azure region')
param location string

@description('Storage account name (3-24 alphanumeric, globally unique)')
param accountName string

@description('Extra origins allowed to call the Table API from a browser (e.g. local dev servers, custom domains)')
param extraCorsOrigins array = []

param tags object = {}

// ─── Storage Account ──────────────────────────────────────────────────────────
// Everything FOMO needs lives here: Table Storage holds the data, and the static
// website ($web) serves the PWA. The browser talks to Table Storage directly with
// a SAS token, so shared-key access (which SAS relies on) must stay enabled.
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: accountName
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: true
    supportsHttpsTrafficOnly: true
    publicNetworkAccess: 'Enabled'
  }
}

// Static website origin, without the trailing slash (e.g. https://acct.z1.web.core.windows.net)
var webEndpoint = storageAccount.properties.primaryEndpoints.web
var webOrigin = endsWith(webEndpoint, '/') ? take(webEndpoint, length(webEndpoint) - 1) : webEndpoint

// ─── Table Service ────────────────────────────────────────────────────────────
resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    cors: {
      corsRules: [
        {
          allowedOrigins: concat([webOrigin], extraCorsOrigins)
          allowedMethods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'MERGE', 'DELETE', 'OPTIONS']
          allowedHeaders: ['*']
          exposedHeaders: ['*']
          maxAgeInSeconds: 3600
        }
      ]
    }
  }
}

// The web app's SAS token can't create tables, so they're all provisioned here.
resource tables 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = [
  for name in ['updates', 'settings', 'topics', 'todos']: {
    parent: tableService
    name: name
  }
]

// ─── Outputs ──────────────────────────────────────────────────────────────────
output id string = storageAccount.id
output name string = storageAccount.name
output tableEndpoint string = storageAccount.properties.primaryEndpoints.table
output webUrl string = webEndpoint
