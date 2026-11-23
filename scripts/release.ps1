<#
.SYNOPSIS
  Alza la versione «di base» di Prisma (minor o major). Le release vere le fa GitHub Actions.

.EXAMPLE
  .\scripts\release.ps1 0.2.0      # il prossimo push su main pubblica la 0.2.0
  .\scripts\release.ps1 0.2.0 -LocalOnly   # solo l'installer sul PC, senza commit né push

.DESCRIPTION
  A ogni push su main il workflow .github/workflows/release.yml pubblica una nuova versione
  da solo, alzando la patch (0.1.0 → 0.1.1 → …) e usando i messaggi dei commit come note.
  Questo script serve solo per passare a una minor o major: scrive la versione in
  apps\desktop\package.json, fa il commit e il push; il workflow pubblica quella versione.
  Con -LocalOnly costruisce solo l'installer in apps\desktop\release\<versione>.
#>
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
    [switch]$LocalOnly
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$packagePath = Join-Path $root 'apps\desktop\package.json'

Push-Location $root
try {
    if (-not $LocalOnly) {
        if (git status --porcelain) { throw "Ci sono modifiche non committate: committale prima" }
        if ((git rev-parse --abbrev-ref HEAD) -ne 'main') { throw "Le versioni si alzano da main" }
    }

    $package = Get-Content $packagePath -Raw -Encoding utf8
    $package = [regex]::Replace($package, '"version":\s*"[^"]*"', "`"version`": `"$Version`"", 1)
    [System.IO.File]::WriteAllText($packagePath, $package, (New-Object System.Text.UTF8Encoding $false))

    if ($LocalOnly) {
        & pnpm.cmd --filter '@prisma-app/desktop' dist
        if ($LASTEXITCODE -ne 0) { throw "Build dell'installer non riuscita" }
        git checkout -- $packagePath
        Write-Host "Installer pronto in apps\desktop\release\$Version" -ForegroundColor Green
        exit 0
    }

    git add $packagePath
    git commit -m "chore: versione $Version"
    if ($LASTEXITCODE -ne 0) { throw "Commit della versione non riuscito" }
    git push origin main
    if ($LASTEXITCODE -ne 0) { throw "Push non riuscito" }
    Write-Host "Inviato: GitHub Actions pubblica la $Version (https://github.com/Code965/Prisma/actions)" -ForegroundColor Green
} finally {
    Pop-Location
}
