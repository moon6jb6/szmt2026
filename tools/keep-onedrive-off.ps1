# OneDrive 看门狗：一旦 OneDrive 被更新任务重新拉起，5 秒内结束它。
# 用法（当前用户即可，无需管理员）：
#   powershell -ExecutionPolicy Bypass -File tools\keep-onedrive-off.ps1
# 停止：Ctrl+C 或关闭窗口。
# 说明：只在本次开机/本次窗口有效；OneDrive 的更新计划任务需要管理员权限才能永久禁用：
#   schtasks /Change /TN "OneDrive Per-Machine Standalone Update Task" /DISABLE
$log = Join-Path $env:LOCALAPPDATA 'Microsoft\OneDrive\logs\keep-off.log'
"$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') watchdog start" | Add-Content -Path $log -Encoding UTF8
while ($true) {
  $p = Get-Process OneDrive -ErrorAction SilentlyContinue
  if ($p) {
    $p | Stop-Process -Force -ErrorAction SilentlyContinue
    "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') killed OneDrive pid=$($p.Id -join ',')" | Add-Content -Path $log -Encoding UTF8
  }
  Start-Sleep -Seconds 5
}
