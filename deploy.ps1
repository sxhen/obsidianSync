# ============================================================
# Obsidian LAN Sync - 一键构建部署脚本 (PowerShell)
# 首次运行会自动将仓库路径写入下方 $VaultPath 变量
# ============================================================

# >>> 自动写入区域，首次运行后会被替换 <<<
$VaultPath = "D:\documents\obsidianLib"

$PluginId  = "lan-sync"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition

# ---------- 首次运行：交互写入仓库路径 ----------
if ($VaultPath -eq "__NOT_SET__") {
    $inputPath = Read-Host "请输入 Obsidian 仓库路径（例如 D:\my-vault）"

    # 去掉末尾斜杠
    $inputPath = $inputPath -replace '[\\/]+$', ''

    if (-not (Test-Path (Join-Path $inputPath ".obsidian"))) {
        Write-Host "错误: 未找到 $inputPath\.obsidian 目录，请确认路径正确" -ForegroundColor Red
        exit 1
    }

    # 将路径写回脚本自身（保留 UTF-8 BOM）
    $scriptFile = $MyInvocation.MyCommand.Definition
    $bytes = [System.IO.File]::ReadAllBytes($scriptFile)
    $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
    $enc = New-Object System.Text.UTF8Encoding($hasBom)
    $raw = $enc.GetString($bytes)
    $raw = $raw.Replace("`$VaultPath = `"__NOT_SET__`"", "`$VaultPath = `"$inputPath`"")
    [System.IO.File]::WriteAllBytes($scriptFile, $enc.GetBytes($raw))
    Write-Host "✓ 仓库路径已保存到脚本: $inputPath"
    $VaultPath = $inputPath
}

$TargetDir = Join-Path $VaultPath ".obsidian\plugins\$PluginId"

Write-Host ""
Write-Host "========== 构建 =========="
Set-Location $ScriptDir
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "错误: 构建失败" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========== 部署 =========="
if (-not (Test-Path $TargetDir)) {
    New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
}

Copy-Item -Path "main.js"       -Destination $TargetDir -Force
Copy-Item -Path "manifest.json" -Destination $TargetDir -Force
if (Test-Path "styles.css") {
    Copy-Item -Path "styles.css" -Destination $TargetDir -Force
}

Write-Host ""
Write-Host "✓ 部署完成 -> $TargetDir"
