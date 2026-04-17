@description('Azure region')
param location string

@description('Container App name (serves web UI and API routes in one container)')
param appName string

param containerEnvId string
param registryServer string
param registryUsername string

@secure()
param registryPassword string

@secure()
param storageConnectionString string

@secure()
param googleClientId string

@secure()
param googleClientSecret string

@secure()
param sessionSecret string

param tags object = {}

// Single image serves the Hono server (API routes) and the Vite-built Web UI
var imageName = '${registryServer}/fomo:latest'

resource apiApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  tags: tags
  properties: {
    environmentId: containerEnvId
    configuration: {
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        {
          server: registryServer
          username: registryUsername
          passwordSecretRef: 'registry-password'
        }
      ]
      secrets: [
        { name: 'registry-password', value: registryPassword }
        { name: 'storage-connection-string', value: storageConnectionString }
        { name: 'google-client-id', value: googleClientId }
        { name: 'google-client-secret', value: googleClientSecret }
        { name: 'session-secret', value: sessionSecret }
      ]
    }
    template: {
      containers: [
        {
          name: 'fomo'
          image: imageName
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            { name: 'PORT', value: '3000' }
            { name: 'AZURE_STORAGE_CONNECTION_STRING', secretRef: 'storage-connection-string' }
            { name: 'GOOGLE_CLIENT_ID', secretRef: 'google-client-id' }
            { name: 'GOOGLE_CLIENT_SECRET', secretRef: 'google-client-secret' }
            { name: 'SESSION_SECRET', secretRef: 'session-secret' }
          ]
          probes: [
            {
              type: 'Liveness'
              httpGet: { path: '/health', port: 3000 }
              initialDelaySeconds: 5
              periodSeconds: 15
            }
          ]
        }
      ]
      scale: {
        minReplicas: 0   // scale to zero when idle
        maxReplicas: 3
        rules: [
          {
            name: 'http-scaling'
            http: { metadata: { concurrentRequests: '20' } }
          }
        ]
      }
    }
  }
}

output id string = apiApp.id
output url string = 'https://${apiApp.properties.configuration.ingress.fqdn}'
