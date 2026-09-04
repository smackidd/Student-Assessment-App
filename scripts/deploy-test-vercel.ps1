param(
  [switch]$Preview
)

$ErrorActionPreference = "Stop"

$appRoot = Split-Path -Parent $PSScriptRoot
$vercelCli = Join-Path $appRoot "node_modules\.bin\vercel.cmd"
$temporaryBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$deploymentRoot = Join-Path $temporaryBase ("student-assessment-test-" + [guid]::NewGuid().ToString("N"))

if (-not (Test-Path -LiteralPath $vercelCli)) {
  throw "Vercel CLI is missing. Run npm install before deploying."
}

New-Item -ItemType Directory -Path $deploymentRoot | Out-Null

try {
  & robocopy $appRoot $deploymentRoot /E /R:1 /W:1 `
    /XD node_modules .git .vercel .next .next-* .tmp out test-results playwright-report `
    /XF *.log .env .env.* firebase-debug.log | Out-Null

  if ($LASTEXITCODE -ge 8) {
    throw "Could not stage the test deployment. Robocopy exit code: $LASTEXITCODE"
  }

  & $vercelCli link `
    --yes `
    --project student-assessment-test `
    --scope stevemackidd-7217s-projects `
    --cwd $deploymentRoot `
    --no-color

  if ($LASTEXITCODE -ne 0) {
    throw "Could not link the staged source to the Vercel test project."
  }

  $deployArguments = @(
    "deploy",
    "--yes",
    "--scope", "stevemackidd-7217s-projects",
    "--cwd", $deploymentRoot,
    "--no-color"
  )

  if (-not $Preview) {
    $deployArguments += "--prod"
  }

  & $vercelCli @deployArguments
  if ($LASTEXITCODE -ne 0) {
    throw "The Vercel test deployment failed."
  }
}
finally {
  if (Test-Path -LiteralPath $deploymentRoot) {
    $resolvedDeploymentRoot = (Resolve-Path -LiteralPath $deploymentRoot).Path
    $isExpectedTemporaryDirectory =
      $resolvedDeploymentRoot.StartsWith($temporaryBase, [StringComparison]::OrdinalIgnoreCase) -and
      (Split-Path -Leaf $resolvedDeploymentRoot).StartsWith(
        "student-assessment-test-",
        [StringComparison]::OrdinalIgnoreCase
      )

    if (-not $isExpectedTemporaryDirectory) {
      throw "Refusing to remove unexpected deployment directory: $resolvedDeploymentRoot"
    }

    $removed = $false
    for ($attempt = 1; $attempt -le 5 -and -not $removed; $attempt++) {
      try {
        Remove-Item -LiteralPath $resolvedDeploymentRoot -Recurse -Force
        $removed = $true
      }
      catch [System.IO.IOException] {
        if ($attempt -eq 5) {
          Write-Warning "Deployment succeeded, but the temporary staging directory is still locked: $resolvedDeploymentRoot"
        }
        else {
          Start-Sleep -Milliseconds 500
        }
      }
    }
  }
}
