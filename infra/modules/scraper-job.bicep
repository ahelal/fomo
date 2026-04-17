@description('Azure region')
param location string

@description('Container Apps Job name')
param jobName string

param containerEnvId string
param registryServer string
param registryUsername string

@secure()
param registryPassword string

@secure()
param storageConnectionString string

@description('Cron expression (UTC) for the scrape schedule')
param cronSchedule string = '0 * * * *'

param tags object = {}

// Reuses the same combined image (job entrypoint: dist/server/job.js)
var imageName = '${registryServer}/fomo:latest'

resource scraperJob 'Microsoft.App/jobs@2024-03-01' = {
  name: jobName
  location: location
  tags: tags
  properties: {
    environmentId: containerEnvId
    configuration: {
      triggerType: 'Schedule'
      scheduleTriggerConfig: {
        cronExpression: cronSchedule
        parallelism: 1
        replicaCompletionCount: 1
      }
      replicaTimeout: 300        // 5 minutes max per run
      replicaRetryLimit: 2
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
      ]
    }
    template: {
      containers: [
        {
          name: 'scraper'
          image: imageName
          command: ['node', 'packages/web/dist/server/job.js']
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
          env: [
            { name: 'AZURE_STORAGE_CONNECTION_STRING', secretRef: 'storage-connection-string' }
          ]
        }
      ]
    }
  }
}

output id string = scraperJob.id
output name string = scraperJob.name
