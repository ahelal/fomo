/**
 * Bootstrap deployment — creates ONLY the Container Registry.
 * Run this before building/pushing the Docker image, then run main.bicep.
 * Uses the exact same naming formula as main.bicep so the name is idempotent.
 */
param projectName string = 'fomo'
param location string = resourceGroup().location
param tags object = {}

module registry './modules/registry.bicep' = {
  name: 'registry-bootstrap'
  params: {
    location: location
    registryName: '${take(replace(projectName, '-', ''), 10)}${take(uniqueString(resourceGroup().id), 13)}'
    tags: tags
  }
}

output loginServer string = registry.outputs.loginServer
output adminUsername string = registry.outputs.adminUsername
#disable-next-line outputs-should-not-contain-secrets
output adminPassword string = registry.outputs.adminPassword
