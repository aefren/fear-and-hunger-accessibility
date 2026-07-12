. "$PSScriptRoot\_lib.ps1"

Write-Host "=== Fear & Hunger - Screen Reader Accessibility - Uninstaller ==="
Write-Host ""

$PluginSrc = Join-Path (Split-Path $PSScriptRoot -Parent) 'plugins'

try {
    Write-Step "Looking for the game..."
    $game = Resolve-GameFolder
    Write-Ok "Found game at: $game"

    $pluginsDir = Join-Path $game 'www\js\plugins'
    $pluginsJs  = Join-Path $game 'www\js\plugins.js'
    $backup     = "$pluginsJs.a11y-bak"

    if (Test-Path -LiteralPath $PluginSrc) {
        $names = Get-ModPluginNames $PluginSrc
    } else {
        $names = @('ScreenReaderAccess','WallBump','InteractableElementsMenu','DoorSonar','EnemySonar','ContainerSonar','CorpseSonar','AltarSonar','NoteSonar','TrapWarning','TrapSonar')
    }

    $res = Remove-PluginsFromList -PluginsJsPath $pluginsJs -BackupPath $backup -Names $names
    if ($res -eq 'restored') { Write-Ok "Restored the original plugins.js from backup." }
    else { Write-Ok "Removed the accessibility entries from plugins.js." }

    foreach ($n in $names) {
        $f = Join-Path $pluginsDir ($n + '.js')
        if (Test-Path -LiteralPath $f) { Remove-Item -LiteralPath $f -Force }
    }
    Write-Ok "Removed plugin files."

    if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force }

    Write-Host ""
    Write-Host "DONE. The accessibility mod has been fully removed."
}
catch {
    Write-Host ""
    Write-Err $_.Exception.Message
    exit 1
}
