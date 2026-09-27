# Install kandy on Windows — https://hiteshbandhu.github.io/kandy/
#
#   irm https://hiteshbandhu.github.io/kandy/install.ps1 | iex
#
# Checks for Node 22+, installs the newest release from GitHub with npm, then
# asks the first-run questions — only on a machine that hasn't answered them,
# so running this again just updates.

$ErrorActionPreference = "Stop"
$url = "https://github.com/hiteshbandhu/kandy/releases/latest/download/kandy.tgz"

function Fail([string]$msg, [string[]]$more = @()) {
  Write-Host ""
  Write-Host "  $msg" -ForegroundColor Red
  foreach ($l in $more) { Write-Host "  $l" }
  Write-Host ""
  # Not `exit`: under `| iex` that would close the user's PowerShell window.
  throw "kandy was not installed."
}

Write-Host ""
Write-Host "  installing kandy"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Fail "kandy needs Node.js 22 or newer, and there's no node here." @("Get it from https://nodejs.org (or: winget install OpenJS.NodeJS.LTS), then run this again.")
}
$major = [int](node -p "process.versions.node.split('.')[0]")
if ($major -lt 22) {
  Fail "kandy needs Node.js 22 or newer; this is $(node -v)." @("Update it from https://nodejs.org, then run this again.")
}

if (Get-Command kandy -ErrorAction SilentlyContinue) { try { kandy stop *> $null } catch {} }

npm install -g --no-fund --no-audit --no-update-notifier --no-progress --loglevel=error $url
if ($LASTEXITCODE -ne 0) { Fail "npm couldn't install kandy." @("See the error above, then run this again.") }

# npm's global folder may be new on PATH; pick it up for this session.
$prefix = (npm prefix -g).Trim()
if (-not (($env:Path -split ';') -contains $prefix)) { $env:Path = "$prefix;$env:Path" }

Write-Host "  kandy $(kandy --version) installed"
kandy setup --first-run
Write-Host ""
