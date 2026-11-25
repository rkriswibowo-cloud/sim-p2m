$ErrorActionPreference = 'Stop'
$config = Join-Path $env:LOCALAPPDATA 'SIM-P2M\dev.env'
$entry = Get-Content -LiteralPath $config | Where-Object { $_ -like 'SIMP2M_DB_DSN=*' }
if (!$entry) { throw 'SIMP2M_DB_DSN belum ada di konfigurasi database lokal.' }

$previousDSN = $env:SIMP2M_DB_DSN
$previousTrialDSN = $env:SIMP2M_TRIAL_DSN
$env:SIMP2M_DB_DSN = ($entry -split '=', 2)[1]
$trialEntry = Get-Content -LiteralPath $config | Where-Object { $_ -like 'SIMP2M_TRIAL_DSN=*' }
if ($trialEntry) { $env:SIMP2M_TRIAL_DSN = ($trialEntry -split '=', 2)[1] }
Push-Location (Join-Path $PSScriptRoot '..\backend')
try {
    go run ./cmd/api
    if ($LASTEXITCODE -ne 0) { throw 'API SIM-P2M berhenti dengan error.' }
} finally {
    Pop-Location
    $env:SIMP2M_DB_DSN = $previousDSN
    $env:SIMP2M_TRIAL_DSN = $previousTrialDSN
}
