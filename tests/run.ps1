param(
  [string]$NodeModules = $env:NODE_PATH,
  [string]$ChromePath = $env:CHROME_PATH,
  [string]$PythonPath = $env:PYTHON_PATH
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
if ($NodeModules) { $env:NODE_PATH = $NodeModules }
if ($PythonPath) { $env:PYTHON_PATH = $PythonPath }
if (-not $ChromePath) { $ChromePath = Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe' }
$taskListener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback,0)
$taskListener.Start()
$taskPort = $taskListener.LocalEndpoint.Port
$taskListener.Stop()
$taskOutput = Join-Path $taskRoot '.test-output'
New-Item -ItemType Directory -Force -Path $taskOutput | Out-Null
$taskProfile = Join-Path $taskOutput "chrome-test-$taskPort"
$taskArguments = @('--headless=new','--disable-gpu','--no-sandbox','--no-first-run','--no-default-browser-check',"--remote-debugging-port=$taskPort", ('--user-data-dir="' + $taskProfile + '"'),'about:blank')
$taskChrome = Start-Process -FilePath $ChromePath -ArgumentList $taskArguments -WindowStyle Hidden -PassThru
$taskPreviousCdp = $env:TEST_CDP_URL
try {
  $env:TEST_CDP_URL = "http://127.0.0.1:$taskPort"
  $taskReady = $false
  for ($i=0; $i -lt 40; $i++) {
    try { Invoke-WebRequest "$env:TEST_CDP_URL/json/version" -UseBasicParsing -TimeoutSec 1 | Out-Null; $taskReady=$true; break } catch { Start-Sleep -Milliseconds 250 }
  }
  if (-not $taskReady) { throw 'Test Chrome did not start.' }
  Push-Location $taskRoot
  try {
    node --test tests/public.test.cjs tests/export.test.cjs tests/browser.test.cjs
    $taskTestExit = $LASTEXITCODE
  } finally { Pop-Location }
} finally {
  $env:TEST_CDP_URL = $taskPreviousCdp
  if (-not $taskChrome.HasExited) { Stop-Process -Id $taskChrome.Id -ErrorAction SilentlyContinue }
}
exit $taskTestExit
