$ErrorActionPreference = 'Stop'
$config = Join-Path $env:LOCALAPPDATA 'SIM-P2M\dev.env'
$entry = Get-Content -LiteralPath $config | Where-Object { $_ -like 'SIMP2M_MIGRATION_DSN=*' }
if (!$entry) { throw 'SIMP2M_MIGRATION_DSN is missing from the local database configuration.' }

$email = Read-Host 'Email Superadmin'
$name = Read-Host 'Nama Superadmin'
$password = Read-Host 'Kata sandi Superadmin (minimal 12 karakter)' -AsSecureString

$env:SIMP2M_BOOTSTRAP_DSN = ($entry -split '=', 2)[1]
$env:SIMP2M_BOOTSTRAP_EMAIL = $email
$env:SIMP2M_BOOTSTRAP_NAME = $name
$env:SIMP2M_BOOTSTRAP_PASSWORD = [System.Net.NetworkCredential]::new('', $password).Password
Push-Location (Join-Path $PSScriptRoot '..\backend')
try {
    go run ./cmd/bootstrap
    if ($LASTEXITCODE -ne 0) { throw 'Bootstrap Superadmin gagal.' }
} finally {
    Pop-Location
    Remove-Item Env:SIMP2M_BOOTSTRAP_DSN, Env:SIMP2M_BOOTSTRAP_EMAIL, Env:SIMP2M_BOOTSTRAP_NAME, Env:SIMP2M_BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
    $password.Dispose()
}
