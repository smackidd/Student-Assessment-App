[CmdletBinding()]
param(
  [string]$ProjectId = "student-assessment-2d869",
  [string]$InstanceId = "student-assessment-db"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
  throw "Google Cloud SDK is required. Install gcloud, authenticate, and rerun this read-only preflight."
}

$activeAccount = gcloud auth list --filter="status:ACTIVE" --format="value(account)" 2>$null
if (-not $activeAccount) {
  throw "No active gcloud account. Run 'gcloud auth login' before this read-only preflight."
}

Write-Host "Active account: $activeAccount"
Write-Host "Project: $ProjectId"
Write-Host "Instance: $InstanceId"

gcloud sql instances describe $InstanceId `
  --project=$ProjectId `
  --format="yaml(name,region,state,databaseVersion,deletionProtectionEnabled,settings.deletionProtectionEnabled,settings.backupConfiguration)"

gcloud sql backups list `
  --instance=$InstanceId `
  --project=$ProjectId `
  --limit=10 `
  --sort-by="~endTime" `
  --format="table(id,status,type,startTime,endTime,location,description)"
