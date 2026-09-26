# =====================================================================
# ACHAki Creative Node — Instalador Local para Windows
# =====================================================================

Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host "  🖥️  ACHAki Creative Node — Instalador Local para Windows" -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan

$CurrentDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ProjectRoot = Resolve-Path "$CurrentDir\.."
Set-Location $ProjectRoot

Write-Host "1. Verificando ambiente..." -ForegroundColor Yellow
$nodeDir = "$ProjectRoot\data\creative-node"
if (!(Test-Path $nodeDir)) {
    New-Item -ItemType Directory -Force -Path $nodeDir | Out-Null
    New-Item -ItemType Directory -Force -Path "$nodeDir\workflows" | Out-Null
    New-Item -ItemType Directory -Force -Path "$nodeDir\models" | Out-Null
    New-Item -ItemType Directory -Force -Path "$nodeDir\comfyui" | Out-Null
    New-Item -ItemType Directory -Force -Path "$nodeDir\output" | Out-Null
    Write-Host "   ✓ Diretórios locais criados com sucesso." -ForegroundColor Green
}

Write-Host "2. Detectando hardware..." -ForegroundColor Yellow
$osInfo = (Get-CimInstance Win32_OperatingSystem).Caption
$cpuInfo = (Get-CimInstance Win32_Processor).Name
$gpuInfo = (Get-CimInstance Win32_VideoController | Select-Object -First 1).Name
$ramGb = [math]::Round((Get-CimInstance Win32_OperatingSystem).TotalVisibleMemorySize / 1MB, 1)

Write-Host "   OS  : $osInfo" -ForegroundColor White
Write-Host "   CPU : $cpuInfo" -ForegroundColor White
Write-Host "   GPU : $gpuInfo" -ForegroundColor White
Write-Host "   RAM : $ramGb GB" -ForegroundColor White

Write-Host "3. Instalando workflows oficiais do ACHAki..." -ForegroundColor Yellow
$wfSource = "$ProjectRoot\src\services\creative-node\workflows"
if (Test-Path $wfSource) {
    Copy-Item "$wfSource\*.json" "$nodeDir\workflows\" -Force
    Write-Host "   ✓ Workflows 9:16 instalados com sucesso." -ForegroundColor Green
}

Write-Host "4. Configurando inicialização e registros..." -ForegroundColor Yellow
& node -e "import('./src/services/creative-node/node-installer.js').then(m => m.CreativeNodeInstaller.install()).then(r => console.log('✓ Node registrado:', r.status)).catch(e => console.error(e))"

Write-Host "`n✅ ACHAki Creative Node instalado e pronto no Windows!" -ForegroundColor Green
