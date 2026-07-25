# ============================================================
# agentteams-dashboard.ps1 — Install / upgrade / uninstall AgentTeams-Dashboard
# as an optional component of an existing AgentTeams deployment (Windows).
#
# Usage:
#   .\agentteams-dashboard.ps1              # interactive install
#   .\agentteams-dashboard.ps1 -Action update
#   .\agentteams-dashboard.ps1 -Action uninstall
#
# Non-interactive:
#   $env:AGENTTEAMS_NON_INTERACTIVE="1"; .\agentteams-dashboard.ps1
# ============================================================
param(
    [ValidateSet("install", "update", "uninstall")]
    [string]$Action = "install",

    [string]$DashboardVersion = "1.2.0-beta.1",
    [int]$Port = 13000,
    [string]$Image = "",
    [string]$ControllerUrl = "http://agentteams-controller:8090",
    [string]$MatrixUrl = "http://agentteams-controller:6167",
    [string]$AiGatewayAdminUrl = "",
    [switch]$LocalOnly
)

$ErrorActionPreference = "Stop"

# ---------- constants ----------
$ContainerName = "agentteams-dashboard"
$NetworkName = "agentteams-net"
$DataVolume = "agentteams-dashboard-data"
$EnvFile = Join-Path $env:USERPROFILE ".agentteams-dashboard.env"
$DefaultRegistry = "higress-registry.cn-hangzhou.cr.aliyuncs.com"

# Derive default image from version if not explicitly set
if (-not $Image) {
    $Image = "$DefaultRegistry/agentteams/agentteams-dashboard:v$DashboardVersion"
}
# Check for env var override
if ($env:AGENTTEAMS_DASHBOARD_IMAGE) {
    $Image = $env:AGENTTEAMS_DASHBOARD_IMAGE
}
if ($env:AGENTTEAMS_DASHBOARD_VERSION) {
    $DashboardVersion = $env:AGENTTEAMS_DASHBOARD_VERSION
}
if ($env:AGENTTEAMS_AI_GATEWAY_ADMIN_URL) {
    $AiGatewayAdminUrl = $env:AGENTTEAMS_AI_GATEWAY_ADMIN_URL
}

# ---------- helpers ----------
function Write-Info($msg)  { Write-Host "[INFO]  $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "[OK]    $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "[WARN]  $msg" -ForegroundColor Yellow }
function Write-Err($msg)   { Write-Host "[ERROR] $msg" -ForegroundColor Red }

function Detect-Docker {
    $dockerCmd = $null
    try {
        docker version *> $null
        if ($LASTEXITCODE -eq 0) { return "docker" }
    } catch {}
    try {
        podman version *> $null
        if ($LASTEXITCODE -eq 0) { return "podman" }
    } catch {}
    Write-Err "Neither docker nor podman found. Please install Docker Desktop."
    exit 1
}

function Invoke-Docker($cmd) {
    $result = & $script:DockerCmd $cmd.Split(" ") 2>&1
    return $result
}

# ---------- uninstall ----------
function Do-Uninstall {
    $script:DockerCmd = Detect-Docker
    $existing = & $DockerCmd ps -a --format '{{.Names}}' 2>$null | Select-String "^$ContainerName$"
    if ($existing) {
        Write-Info "Stopping and removing $ContainerName..."
        & $DockerCmd rm -f $ContainerName *> $null
        Write-Ok "Dashboard container removed."
    } else {
        Write-Warn "Container $ContainerName not found."
    }
}

# ---------- runtime env detection ----------
function Get-ControllerEnv {
    param([string]$ContainerName)
    $envRaw = & $DockerCmd inspect $ContainerName --format '{{range .Config.Env}}{{.}}{{println}}{{end}}' 2>$null
    $envMap = @{}
    foreach ($line in $envRaw) {
        if ($line -match '^([^=]+)=(.*)$') {
            $envMap[$Matches[1]] = $Matches[2]
        }
    }
    return $envMap
}

function Build-EnvArgs {
    param([hashtable]$CtrlEnv)

    $envArgs = @(
        "-e", "AGENTTEAMS_CONTROLLER_URL=$ControllerUrl",
        "-e", "NEXT_PUBLIC_MATRIX_API_URL=$MatrixUrl",
        "-e", "MATRIX_HOMESERVER_ALLOWLIST=agentteams-controller,matrix-local.agentteams.io,matrix.org"
    )

    # Auth token: poll for up to 30s since the token is generated
    # asynchronously during the first controller reconcile loop.
    # Handles both fresh installs (token not yet minted) and older
    # AgentTeams images (< v1.2.0-beta.1) that don't have cli-token at all.
    # For backward compatibility, also try the legacy /var/run/hiclaw/cli-token
    # path used by older HiClaw images.
    $authToken = ""
    $maxWait = 30
    $waited = 0
    while ($waited -lt $maxWait) {
        $tokenOutput = & $DockerCmd exec agentteams-controller sh -c 'cat /var/run/agentteams/cli-token 2>/dev/null || cat /var/run/hiclaw/cli-token 2>/dev/null' 2>$null
        if ($tokenOutput) {
            $authToken = $tokenOutput.Trim()
            if ($authToken) { break }
        }
        Start-Sleep -Seconds 2
        $waited += 2
    }
    if ($authToken) {
        $envArgs += @("-e", "AGENTTEAMS_AUTH_TOKEN=$authToken")
    } else {
        Write-Warn "Could not read controller auth token (timed out after ${maxWait}s)."
        Write-Warn "  This can happen with older AgentTeams/HiClaw images or if the controller is still starting."
        Write-Warn "  Dashboard will still work but some API calls may fail until you log in via Higress Console."
        Write-Warn "  To fix: upgrade AgentTeams to v1.2.0-beta.1+ or set AGENTTEAMS_AUTH_TOKEN manually."
    }

    # Admin credentials
    if ($CtrlEnv.ContainsKey("AGENTTEAMS_ADMIN_USER")) {
        $envArgs += @("-e", "AGENTTEAMS_ADMIN_USER=$($CtrlEnv['AGENTTEAMS_ADMIN_USER'])")
    }
    if ($CtrlEnv.ContainsKey("AGENTTEAMS_ADMIN_PASSWORD")) {
        $envArgs += @("-e", "AGENTTEAMS_ADMIN_PASSWORD=$($CtrlEnv['AGENTTEAMS_ADMIN_PASSWORD'])")
    }

    # MinIO
    $fsEndpoint = if ($CtrlEnv.ContainsKey("AGENTTEAMS_FS_ENDPOINT")) { $CtrlEnv["AGENTTEAMS_FS_ENDPOINT"] } else { $CtrlEnv["AGENTTEAMS_MINIO_ENDPOINT"] }
    $fsAccess   = if ($CtrlEnv.ContainsKey("AGENTTEAMS_FS_ACCESS_KEY")) { $CtrlEnv["AGENTTEAMS_FS_ACCESS_KEY"] } else { $CtrlEnv["AGENTTEAMS_MINIO_USER"] }
    $fsSecret   = if ($CtrlEnv.ContainsKey("AGENTTEAMS_FS_SECRET_KEY")) { $CtrlEnv["AGENTTEAMS_FS_SECRET_KEY"] } else { $CtrlEnv["AGENTTEAMS_MINIO_PASSWORD"] }
    $fsBucket   = if ($CtrlEnv.ContainsKey("AGENTTEAMS_FS_BUCKET")) { $CtrlEnv["AGENTTEAMS_FS_BUCKET"] } else { $CtrlEnv["AGENTTEAMS_MINIO_BUCKET"] }

    if ($fsEndpoint) {
        $fsEndpoint = $fsEndpoint -replace "127\.0\.0\.1", "agentteams-controller" -replace "localhost", "agentteams-controller"
        $envArgs += @("-e", "AGENTTEAMS_FS_ENDPOINT=$fsEndpoint")
    }
    if ($fsAccess) { $envArgs += @("-e", "AGENTTEAMS_FS_ACCESS_KEY=$fsAccess") }
    if ($fsSecret) { $envArgs += @("-e", "AGENTTEAMS_FS_SECRET_KEY=$fsSecret") }
    if ($fsBucket) { $envArgs += @("-e", "AGENTTEAMS_FS_BUCKET=$fsBucket") }

    # LLM
    if ($CtrlEnv.ContainsKey("AGENTTEAMS_LLM_PROVIDER")) { $envArgs += @("-e", "AGENTTEAMS_LLM_PROVIDER=$($CtrlEnv['AGENTTEAMS_LLM_PROVIDER'])") }
    if ($CtrlEnv.ContainsKey("AGENTTEAMS_LLM_API_KEY"))  { $envArgs += @("-e", "AGENTTEAMS_LLM_API_KEY=$($CtrlEnv['AGENTTEAMS_LLM_API_KEY'])") }
    if ($CtrlEnv.ContainsKey("AGENTTEAMS_OPENAI_BASE_URL")) { $envArgs += @("-e", "AGENTTEAMS_OPENAI_BASE_URL=$($CtrlEnv['AGENTTEAMS_OPENAI_BASE_URL'])") }
    if ($CtrlEnv.ContainsKey("AGENTTEAMS_DEFAULT_MODEL")) { $envArgs += @("-e", "AGENTTEAMS_DEFAULT_MODEL=$($CtrlEnv['AGENTTEAMS_DEFAULT_MODEL'])") }

    # Higress Console URL: explicit config takes priority, auto-detect as fallback.
    if ($AiGatewayAdminUrl) {
        # Normalize URL: add http:// prefix if missing
        if ($AiGatewayAdminUrl -notmatch "^https?://") {
            $AiGatewayAdminUrl = "http://$AiGatewayAdminUrl"
        }
        $envArgs += @("-e", "AGENTTEAMS_AI_GATEWAY_ADMIN_URL=$AiGatewayAdminUrl")
    } else {
        $higressCheck = & $DockerCmd exec agentteams-controller wget -q -O- --timeout=2 http://127.0.0.1:8001/ 2>$null
        if ($higressCheck) {
            $envArgs += @("-e", "AGENTTEAMS_AI_GATEWAY_ADMIN_URL=http://agentteams-controller:8001")
            $AiGatewayAdminUrl = "http://agentteams-controller:8001"
        }
    }

    # Verify Higress Console URL reachability (best-effort warning)
    if ($AiGatewayAdminUrl) {
        $gwReachable = $false
        if ($AiGatewayAdminUrl -match "(agentteams-controller|hiclaw-controller|127\.0\.0\.1|localhost)") {
            $gwTest = & $DockerCmd exec agentteams-controller curl -sf --max-time 3 "$AiGatewayAdminUrl/" 2>$null
            if ($gwTest) { $gwReachable = $true }
        } else {
            try {
                $response = Invoke-WebRequest -Uri "$AiGatewayAdminUrl/" -TimeoutSec 3 -UseBasicParsing 2>$null
                if ($response.StatusCode -eq 200) { $gwReachable = $true }
            } catch {
                $gwReachable = $false
            }
        }
        if (-not $gwReachable) {
            Write-Warn "Higress Console URL may not be reachable: $AiGatewayAdminUrl"
            Write-Warn "  Dashboard will still work, but shared login via Higress Console may fail."
            Write-Warn "  To fix: verify the URL is correct and the Higress Console service is running."
        }
    }

    return $envArgs
}

# ---------- install / update ----------
function Do-Install {
    $script:DockerCmd = Detect-Docker

    # Check network
    $netExists = & $DockerCmd network inspect $NetworkName 2>$null
    if (-not $netExists) {
        Write-Err "Docker network '$NetworkName' not found. Install AgentTeams first."
        exit 1
    }
    Write-Ok "Network '$NetworkName' found."

    # Interactive prompts
    if (-not $env:AGENTTEAMS_NON_INTERACTIVE) {
        $input = Read-Host "Install AgentTeams-Dashboard? [Y/n]"
        if ($input -match "^[nN0]$") { Write-Info "Skipped."; exit 0 }

        $verInput = Read-Host "Dashboard version [$DashboardVersion]"
        if ($verInput) { $DashboardVersion = $verInput }

        $portInput = Read-Host "Dashboard port [$Port]"
        if ($portInput) { $Port = [int]$portInput }

        # Derive default image from version
        $defaultImage = "$DefaultRegistry/agentteams/agentteams-dashboard:v$DashboardVersion"
        $imgInput = Read-Host "Dashboard image [$defaultImage]"
        if ($imgInput) { $Image = $imgInput } else { $Image = $defaultImage }

        # Higress Console URL prompt
        $higressDefault = ""
        if ($AiGatewayAdminUrl) {
            $higressDefault = $AiGatewayAdminUrl
        } else {
            $higressCheck = & $DockerCmd exec agentteams-controller wget -q -O- --timeout=2 http://127.0.0.1:8001/ 2>$null
            if ($higressCheck) {
                $higressDefault = "http://agentteams-controller:8001"
            }
        }
        $higressInput = Read-Host "Higress Console URL (for shared login) [$($higressDefault -replace '^$', '<skip>')]"
        if ($higressInput) { $AiGatewayAdminUrl = $higressInput } elseif ($higressDefault) { $AiGatewayAdminUrl = $higressDefault }
    }

    # Remove existing container
    $existing = & $DockerCmd ps -a --format '{{.Names}}' 2>$null | Select-String "^$ContainerName$"
    if ($existing) {
        Write-Info "Removing existing $ContainerName..."
        & $DockerCmd rm -f $ContainerName *> $null
    }

    # Pull image if needed
    $imgExists = & $DockerCmd image inspect $Image 2>$null
    if (-not $imgExists) {
        Write-Info "Pulling image $Image..."
        & $DockerCmd pull $Image
        if ($LASTEXITCODE -ne 0) {
            Write-Err "Failed to pull image. Aborting."
            exit 1
        }
    }

    # Detect controller env
    $ctrlRunning = & $DockerCmd ps --format '{{.Names}}' 2>$null | Select-String "^agentteams-controller$"
    $ctrlEnv = @{}
    if ($ctrlRunning) {
        Write-Info "Detecting runtime environment from agentteams-controller..."
        $ctrlEnv = Get-ControllerEnv -ContainerName "agentteams-controller"
    }

    $envArgs = Build-EnvArgs -CtrlEnv $ctrlEnv

    # Port binding (default to localhost only)
    $portBind = "127.0.0.1:{0}:3000" -f $Port
    if (-not $LocalOnly -and $env:AGENTTEAMS_LOCAL_ONLY -ne "1") {
        $portBind = "{0}:3000" -f $Port
    }

    $portArg = "{0}:3000" -f $portBind

    Write-Info "Starting $ContainerName..."
    & $DockerCmd run -d `
        --name $ContainerName `
        --restart unless-stopped `
        --network $NetworkName `
        -p $portArg `
        @envArgs `
        $Image

    if ($LASTEXITCODE -ne 0) {
        Write-Err "Failed to start container."
        exit 1
    }

    # Wait for readiness
    Write-Info "Waiting for Dashboard to become ready..."
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -TimeoutSec 3 -UseBasicParsing -ErrorAction SilentlyContinue
            if ($response.StatusCode -eq 200) { $ready = $true; break }
        } catch {}
        Start-Sleep -Seconds 2
    }

    if ($ready) {
        Write-Ok "Dashboard is ready at http://127.0.0.1:$Port/"
    } else {
        Write-Warn "Dashboard did not respond within 60s. Check: $DockerCmd logs $ContainerName"
    }
}

# ---------- main ----------
switch ($Action) {
    "uninstall" { Do-Uninstall }
    "update"    { Do-Install }
    default     { Do-Install }
}
