# push-env-vercel.ps1
# Lee .env.local y sube cada variable no-vacía a Vercel (environment: production)
# Uso: .\scripts\push-env-vercel.ps1

$env:NODE_OPTIONS = "--use-system-ca"
$envFile = Join-Path $PSScriptRoot "..\\.env.local"

if (-not (Test-Path $envFile)) {
    Write-Error "No se encontró .env.local en la raíz del proyecto."
    exit 1
}

$lineas = Get-Content $envFile

foreach ($linea in $lineas) {
    # Ignorar comentarios y líneas vacías
    if ($linea -match '^\s*#' -or $linea.Trim() -eq '') { continue }

    # Separar KEY=VALUE (el valor puede tener = adentro)
    $idx   = $linea.IndexOf('=')
    if ($idx -lt 1) { continue }

    $key   = $linea.Substring(0, $idx).Trim()
    $value = $linea.Substring($idx + 1).Trim()

    # Ignorar variables vacías
    if ($value -eq '' -or $value -eq $null) {
        Write-Host "  SKIP  $key  (sin valor)" -ForegroundColor DarkGray
        continue
    }

    Write-Host "  SET   $key" -ForegroundColor Cyan
    $value | & npx vercel env add $key production --force 2>&1 | Out-Null
}

Write-Host ""
Write-Host "Listo. Recuerda hacer redeploy:" -ForegroundColor Green
Write-Host '  $env:NODE_OPTIONS="--use-system-ca"; npx vercel --prod' -ForegroundColor Yellow
