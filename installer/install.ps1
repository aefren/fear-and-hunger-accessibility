. "$PSScriptRoot\_lib.ps1"

Write-Host "=== Fear & Hunger - Screen Reader Accessibility - Installer ==="
Write-Host ""

$PluginSrc = Join-Path (Split-Path $PSScriptRoot -Parent) 'plugins'
if (-not (Test-Path -LiteralPath $PluginSrc)) {
    Write-Err "Cannot find the 'plugins' folder next to the installer."
    exit 1
}

try {
    Write-Step "Looking for the game..."
    $game = Resolve-GameFolder
    Write-Ok "Found game at: $game"

    $pluginsDir = Join-Path $game 'www\js\plugins'
    $pluginsJs  = Join-Path $game 'www\js\plugins.js'
    $backup     = "$pluginsJs.a11y-bak"

    $names = Get-ModPluginNames $PluginSrc
    Write-Step ("Installing " + $names.Count + " plugins...")

    if (-not (Test-Path -LiteralPath $backup)) {
        Copy-Item -LiteralPath $pluginsJs -Destination $backup -Force
        Write-Ok "Saved a backup: plugins.js.a11y-bak"
    }

    Copy-Item -Path (Join-Path $PluginSrc '*.js') -Destination $pluginsDir -Force
    Write-Ok "Copied plugin files."

    $res = Add-PluginsToList -PluginsJsPath $pluginsJs -Names $names
    if ($res -eq 'already') { Write-Ok "Plugins were already registered." }
    else { Write-Ok "Registered plugins in plugins.js." }

    Write-Host ""
    Write-Host "SUCCESS. Launch Fear & Hunger with your screen reader running."
}
catch {
    Write-Host ""
    Write-Err $_.Exception.Message
    Write-Host "Nothing was changed permanently; you can try again or install manually (see README)."
    exit 1
}
