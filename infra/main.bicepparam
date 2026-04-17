using './main.bicep'

param projectName = 'fomo'
param environmentName = 'prod'
param location = 'swedencentral'

// Set via env or --parameters at deployment time
param googleClientId = readEnvironmentVariable('GOOGLE_CLIENT_ID', '')
param googleClientSecret = readEnvironmentVariable('GOOGLE_CLIENT_SECRET', '')
param sessionSecret = readEnvironmentVariable('SESSION_SECRET', '')

param scraperCronSchedule = '0 * * * *'   // every hour on the hour (UTC)
