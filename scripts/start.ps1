# 一键启动脚本：统一初始化配置并启动后端与前端
# 使用说明：在项目根目录执行 .\scripts\start.ps1
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path  # 项目根目录
$pythonExe = 'python'  # 优先使用 python；若不可用则回退到 py -3
$backendArgs = 'server.py'
try { & $pythonExe --version | Out-Null } catch { if (Get-Command py -ErrorAction SilentlyContinue) { $pythonExe = 'py'; $backendArgs = '-3 server.py' } }
$configPath = Join-Path $root 'config.local.js'  # 配置文件路径
if (-not (Test-Path $configPath)) { & $pythonExe (Join-Path $root 'init_config.py') | Out-Null }
$apiBase = 'http://localhost:8001/api'
try { $cfg = Get-Content $configPath -Raw; $m = [regex]::Match($cfg, 'API_BASE"\s*:\s*"([^"]+)"'); if ($m.Success) { $apiBase = $m.Groups[1].Value } } catch {}
$backend = Start-Process -FilePath $pythonExe -ArgumentList $backendArgs -WorkingDirectory $root -PassThru  # 启动后端
Start-Sleep -Seconds 1
$ok = $false
for ($i=0; $i -lt 10; $i++) { try { $r = Invoke-WebRequest -Uri ($apiBase + '/healthz') -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200) { $ok = $true; break } } catch { Start-Sleep -Milliseconds 500 } }

# 启动前端（优先使用 Vite）
$frontendDir = Join-Path $root 'frontend'
$vitePort = 5173
$npmCmd = $null
try { $npmCmd = (Get-Command npm -ErrorAction Stop).Source } catch { $npmCmd = $null }
if ($npmCmd -ne $null -and (Test-Path (Join-Path $frontendDir 'package.json'))) {
  $frontend = Start-Process -FilePath $npmCmd -ArgumentList 'run dev' -WorkingDirectory $frontendDir -PassThru
  Start-Sleep -Seconds 1
  Start-Process ("http://localhost:" + $vitePort + "/")
} else {
  # 回退：旧版静态前端
  $frontend = Start-Process -FilePath $pythonExe -ArgumentList '-m http.server 8000' -WorkingDirectory $root -PassThru
  if (Test-Path (Join-Path $root 'index.html')) { Start-Process 'http://localhost:8000/' }
}
Write-Output ('API ' + $apiBase + ' ok=' + $ok)
