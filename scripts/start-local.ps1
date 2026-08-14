# start-local.ps1 — sobe a stack completa localmente.
# Uso (após o reboot que ativa o WSL):  powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1
# Idempotente: pode rodar quantas vezes quiser.

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

Write-Host "== Social AI Platform — subida local ==" -ForegroundColor Cyan

# 1) .env
if (-not (Test-Path ".\.env")) {
    Copy-Item ".\.env.example" ".\.env"
    Write-Host "[.env] criado a partir do template (modo degradado — preencha as chaves de IA/Meta depois)." -ForegroundColor Yellow
} else {
    Write-Host "[.env] ja existe." -ForegroundColor Green
}

# 2) Docker Desktop / daemon
$dockerExe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
docker info *> $null
if (-not $?) {
    if (Test-Path $dockerExe) {
        Write-Host "[docker] iniciando Docker Desktop..." -ForegroundColor Yellow
        Start-Process $dockerExe
    }
    Write-Host "[docker] aguardando o daemon (ate ~4min)..." -ForegroundColor Yellow
    $up = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Seconds 8
        docker info *> $null
        if ($?) { $up = $true; break }
    }
    if (-not $up) { throw "Docker daemon nao subiu. Abra o Docker Desktop manualmente e rode de novo." }
}
Write-Host "[docker] daemon OK." -ForegroundColor Green

# 3) Subir a stack (api aplica migrations sozinha no boot)
Write-Host "[compose] build + up (primeira vez baixa imagens .NET/Node — pode demorar)..." -ForegroundColor Yellow
docker compose up --build -d

# 4) Aguardar health dos principais
Write-Host "[health] aguardando api/agents/web..." -ForegroundColor Yellow
function Wait-Url($url, $name) {
    for ($i = 0; $i -lt 40; $i++) {
        try { Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3 *> $null; if ($?) { Write-Host "  $name OK" -ForegroundColor Green; return $true } } catch {}
        Start-Sleep -Seconds 5
    }
    Write-Host "  $name nao respondeu a tempo (veja: docker compose logs $name)" -ForegroundColor Red
    return $false
}
Wait-Url "http://localhost:5080/health" "api"   | Out-Null
Wait-Url "http://localhost:4000/health" "agents" | Out-Null
Wait-Url "http://localhost:3000"        "web"   | Out-Null

Write-Host ""
Write-Host "== No ar ==" -ForegroundColor Cyan
Write-Host "  Web (UI):       http://localhost:3000"
Write-Host "  API (Swagger):  http://localhost:5080/swagger"
Write-Host "  Agents health:  http://localhost:4000/health"
Write-Host "  MinIO console:  http://localhost:9001"
Write-Host ""
Write-Host "Status:  docker compose ps     Logs:  docker compose logs -f"
Start-Process "http://localhost:3000"
