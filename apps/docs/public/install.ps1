# Install kandy on Windows — https://hiteshbandhu.github.io/kandy/
#
#   irm https://hiteshbandhu.github.io/kandy/install.ps1 | iex
#
# Checks for Node 22.13+, installs the newest release from GitHub with npm,
# then asks the first-run questions — only on a machine that hasn't answered
# them, so running this again just updates.

$ErrorActionPreference = "Stop"
$url = if ($env:KANDY_TGZ) { $env:KANDY_TGZ } else { "https://github.com/hiteshbandhu/kandy/releases/latest/download/kandy.tgz" }
$trouble = "https://hiteshbandhu.github.io/kandy/guide/troubleshooting"

function Fail([string]$msg, [string[]]$more = @()) {
  Write-Host ""
  Write-Host "  $msg" -ForegroundColor Red
  foreach ($l in $more) { Write-Host "  $l" }
  Write-Host ""
  # Not `exit`: under `| iex` that would close the user's PowerShell window.
  throw "kandy was not installed."
}

# Stop this machine's kandy and team runner, so the new version is what
# starts next. Asked of the daemon itself (its /health says its pid) and of
# the runner's pid file, not of the old kandy's commands: `kandy stop` only
# exists from 0.2.0-alpha.2, and an older kandy took "stop" for a note to run.
# No double quotes in it: Windows PowerShell mangles them on the way to node.
$stopJs = @'
const os = require(`os`), fs = require(`fs`), path = require(`path`)
const base = (v, f) => (v && path.isAbsolute(v) ? v : path.join(os.homedir(), f))
const state = path.join(base(process.env.XDG_STATE_HOME, `.local/state`), `kandy`)
const alive = (p) => { try { process.kill(p, 0); return true } catch { return false } }
const pids = []
;(async () => {
  try {
    const r = await fetch(`http://127.0.0.1:4477/health`, { signal: AbortSignal.timeout(1500) })
    const b = await r.json()
    if (typeof b.pid === `number`) pids.push(b.pid)
  } catch {}
  try {
    const p = Number(fs.readFileSync(path.join(state, `runner.pid`), `utf8`).trim())
    if (p > 0 && alive(p)) pids.push(p)
  } catch {}
  for (const p of pids) { try { process.kill(p, `SIGTERM`) } catch {} }
  for (let i = 0; i < 40 && pids.some(alive); i++) await new Promise((r) => setTimeout(r, 250))
  process.stdout.write(String(pids.length))
})()
'@

function Install-Kandy {
  # npm.cmd and kandy.cmd, not the .ps1 shims npm also writes: those are
  # scripts, and a machine that doesn't allow scripts refuses them.
  $old = $null
  if (Get-Command kandy.cmd -ErrorAction SilentlyContinue) { try { $old = (kandy.cmd --version 2>$null | Out-String).Trim() } catch {} }

  Write-Host ""
  if ($old) { Write-Host "  kandy $old is installed — updating to the newest release" } else { Write-Host "  installing kandy" }

  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Fail "kandy needs Node.js 22.13 or newer, and there's no node here." @("Get it from https://nodejs.org (or: winget install OpenJS.NodeJS.LTS), then run this again.")
  }
  $nodeV = (node -p "process.versions.node" | Out-String).Trim()
  if ([version]$nodeV -lt [version]"22.13.0") {
    Fail "kandy needs Node.js 22.13 or newer; this is Node $nodeV." @("Update it from https://nodejs.org (or: winget upgrade OpenJS.NodeJS.LTS), then run this again.")
  }
  if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    Fail "npm is missing — it ships with Node.js." @("Reinstall Node from https://nodejs.org, then run this again.")
  }

  $stopped = "0"
  try { $stopped = (node -e $stopJs | Out-String).Trim() } catch {}
  if ($stopped -and $stopped -ne "0") {
    Write-Host "  stopped the running kandy — notes it was running show as interrupted; Resume carries on"
  }

  npm.cmd install -g --no-fund --no-audit --no-update-notifier --no-progress --loglevel=error $url
  if ($LASTEXITCODE -ne 0) { Fail "npm couldn't install kandy." @("See the error above, then run this again.", $trouble) }

  # npm's global folder may be new on PATH. It's added here for this window
  # only — a new window reads PATH from Windows, and needs it there.
  $prefix = (npm.cmd prefix -g | Out-String).Trim()
  if (-not (($env:Path -split ';') -contains $prefix)) {
    $env:Path = "$prefix;$env:Path"
    Write-Host "  added $prefix to PATH for this window only. To keep it, run:" -ForegroundColor Yellow
    Write-Host "    [Environment]::SetEnvironmentVariable('Path', `"$prefix;`" + [Environment]::GetEnvironmentVariable('Path', 'User'), 'User')"
  }

  $new = ""
  try { $new = (kandy.cmd --version 2>$null | Out-String).Trim() } catch {}
  if (-not $new) { Fail "kandy installed, but running it failed." @("Run kandy --version to see why, or see $trouble") }
  if (-not $old) { Write-Host "  kandy $new installed" }
  elseif ($old -eq $new) { Write-Host "  kandy $new — already the newest" }
  else { Write-Host "  kandy updated: $old → $new" }

  # Typing `kandy` in PowerShell runs npm's kandy.ps1, which a machine that
  # doesn't allow scripts refuses. Said now rather than on the first command.
  $policy = Get-ExecutionPolicy
  if ($policy -eq "Restricted" -or $policy -eq "AllSigned") {
    Write-Host "  PowerShell won't run kandy here yet (execution policy: $policy). Allow it once:" -ForegroundColor Yellow
    Write-Host "    Set-ExecutionPolicy -Scope CurrentUser RemoteSigned"
  }

  kandy.cmd setup --first-run
  Write-Host ""
}

try {
  Install-Kandy
} catch [System.Management.Automation.PSSecurityException] {
  Fail "PowerShell refused to run a script: $($_.Exception.Message)" @("Allow scripts you've installed, then run this again:", "  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned")
} catch {
  if ($_.Exception.Message -match "running scripts is disabled|execution polic") {
    Fail "PowerShell refused to run a script: $($_.Exception.Message)" @("Allow scripts you've installed, then run this again:", "  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned")
  }
  throw
}
