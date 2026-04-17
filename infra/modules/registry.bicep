@description('Azure region')
param location string

@description('Container registry name (5-50 alphanumeric, globally unique)')
param registryName string

param tags object = {}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: registryName
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: true
    publicNetworkAccess: 'Enabled'
  }
}

output id string = registry.id
output loginServer string = registry.properties.loginServer
output adminUsername string = registry.listCredentials().username
#disable-next-line outputs-should-not-contain-secrets
output adminPassword string = registry.listCredentials().passwords[0].value
