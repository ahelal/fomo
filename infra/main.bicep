// ─── Parameters ───────────────────────────────────────────────────────────────
@description('Azure region for all resources')
param location string = resourceGroup().location

@description('Short slug used to name all resources, e.g. "fomo"')
param projectName string = 'fomo'

@description('Environment tag, e.g. prod / staging')
param environmentName string = 'prod'

@description('Google OAuth 2.0 Client ID')
@secure()
param googleClientId string

@description('Google OAuth 2.0 Client Secret')
@secure()
param googleClientSecret string

@description('Session signing secret (random string, ≥32 chars)')
@secure()
param sessionSecret string

@description('Cron schedule for the scraper job (UTC, standard cron syntax)')
param scraperCronSchedule string = '0 * * * *'   // every hour

// ─── Modules ──────────────────────────────────────────────────────────────────

module storage './modules/storage.bicep' = {
  name: 'storage'
  params: {
    location: location
    // Storage account names must be 3-24 alphanumeric chars, globally unique
    accountName: '${take(replace(projectName, '-', ''), 10)}${take(uniqueString(resourceGroup().id), 13)}'
    tags: { project: projectName, environment: environmentName }
  }
}

module registry './modules/registry.bicep' = {
  name: 'registry'
  params: {
    location: location
    registryName: '${take(replace(projectName, '-', ''), 10)}${take(uniqueString(resourceGroup().id), 13)}'
    tags: { project: projectName, environment: environmentName }
  }
}

module containerEnv './modules/container-env.bicep' = {
  name: 'container-env'
  params: {
    location: location
    envName: '${projectName}-env'
    tags: { project: projectName, environment: environmentName }
  }
}

module app './modules/app.bicep' = {
  name: 'app'
  params: {
    location: location
    appName: '${projectName}-app'
    containerEnvId: containerEnv.outputs.id
    registryServer: registry.outputs.loginServer
    registryUsername: registry.outputs.adminUsername
    registryPassword: registry.outputs.adminPassword
    storageConnectionString: storage.outputs.connectionString
    googleClientId: googleClientId
    googleClientSecret: googleClientSecret
    sessionSecret: sessionSecret
    tags: { project: projectName, environment: environmentName }
  }
}

module scraperJob './modules/scraper-job.bicep' = {
  name: 'scraper-job'
  params: {
    location: location
    jobName: '${projectName}-scraper'
    containerEnvId: containerEnv.outputs.id
    registryServer: registry.outputs.loginServer
    registryUsername: registry.outputs.adminUsername
    registryPassword: registry.outputs.adminPassword
    storageConnectionString: storage.outputs.connectionString
    cronSchedule: scraperCronSchedule
    tags: { project: projectName, environment: environmentName }
  }
}

// ─── Outputs ──────────────────────────────────────────────────────────────────

@description('FOMO URL (serves both API and Web UI)')
output url string = app.outputs.url

@description('Container registry login server')
output registryServer string = registry.outputs.loginServer
