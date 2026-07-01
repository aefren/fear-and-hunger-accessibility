# Shared helpers for the Fear & Hunger accessibility installer / uninstaller.
# Written for Windows PowerShell 5.1 (ships with Windows) -- no pwsh required.

$ErrorActionPreference = 'Stop'

function Write-Step { param([string]$Msg) Write-Host "  $Msg" }
function Write-Ok   { param([string]$Msg) Write-Host "[OK] $Msg" }
function Write-Err  { param([string]$Msg) Write-Host "[ERROR] $Msg" }

# Locate the Fear & Hunger install folder by inspecting Steam's library list.
# Returns the game folder path, or $null if not found.
function Find-GameFolder {
    $libraries = @()

    $steamPath = $null
    try { $steamPath = (Get-ItemProperty 'HKCU:\Software\Valve\Steam' -Name SteamPath -ErrorAction Stop).SteamPath } catch {}
    if (-not $steamPath) {
        try { $steamPath = (Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Valve\Steam' -Name InstallPath -ErrorAction Stop).InstallPath } catch {}
    }
    if ($steamPath) {
        $libraries += $steamPath
        $vdf = Join-Path $steamPath 'steamapps\libraryfolders.vdf'
        if (Test-Path -LiteralPath $vdf) {
            $found = Select-String -LiteralPath $vdf -Pattern '"path"\s+"([^"]+)"' -AllMatches
            foreach ($line in $found) {
                foreach ($m in $line.Matches) { $libraries += ($m.Groups[1].Value -replace '\\\\', '\') }
            }
        }
    }

    # Common default in case the registry lookup fails.
    $libraries += 'C:\Program Files (x86)\Steam'

    foreach ($lib in ($libraries | Select-Object -Unique)) {
        $game = Join-Path $lib 'steamapps\common\Fear & Hunger'
        if (Test-Path -LiteralPath (Join-Path $game 'www\js\plugins.js')) { return $game }
    }
    return $null
}

# Auto-detect, or ask the user to paste the path if detection fails.
function Resolve-GameFolder {
    $game = Find-GameFolder
    if ($game) { return $game }

    Write-Host ""
    Write-Host "Could not find Fear & Hunger automatically."
    Write-Host "Paste the full path to the game folder (the one that contains 'www') and press Enter:"
    $manual = (Read-Host "Game folder").Trim().Trim('"')
    if ($manual -and (Test-Path -LiteralPath (Join-Path $manual 'www\js\plugins.js'))) { return $manual }
    throw "That folder does not contain www\js\plugins.js. Aborting."
}

# The mod's plugin names, taken from the shipped 'plugins' folder.
# ScreenReaderAccess is forced first because the others rely on the globals it defines.
function Get-ModPluginNames {
    param([string]$PluginSrc)
    $names = @(Get-ChildItem -LiteralPath $PluginSrc -Filter *.js | ForEach-Object { $_.BaseName })
    $ordered = @()
    if ($names -contains 'ScreenReaderAccess') { $ordered += 'ScreenReaderAccess' }
    $ordered += @($names | Where-Object { $_ -ne 'ScreenReaderAccess' } | Sort-Object)
    return $ordered
}

# Read/write helpers that never emit a UTF-8 BOM (which some loaders choke on).
function Read-Text  { param([string]$Path) return [System.IO.File]::ReadAllText($Path) }
function Write-Text { param([string]$Path, [string]$Text) [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false))) }

# Append the mod's plugin entries at the end of the $plugins array (after every
# other plugin, as the load order requires). Idempotent and JSON-validated.
function Add-PluginsToList {
    param([string]$PluginsJsPath, [string[]]$Names)
    $s = Read-Text $PluginsJsPath
    $eol = if ($s.Contains("`r`n")) { "`r`n" } else { "`n" }

    $todo = @($Names | Where-Object { -not $s.Contains('"name":"' + $_ + '"') })
    if ($todo.Count -eq 0) { return 'already' }

    $entries = ($todo | ForEach-Object { '{"name":"' + $_ + '","status":true,"description":"","parameters":{}}' }) -join (',' + $eol)

    $anchor = $s.IndexOf('$plugins')
    if ($anchor -lt 0) { throw 'plugins.js does not look like an RPG Maker plugin list.' }
    $arrEnd = $s.LastIndexOf('];')
    if ($arrEnd -lt 0) { throw 'Could not find the end of the $plugins array.' }

    $head = $s.Substring(0, $arrEnd).TrimEnd()
    $tail = $s.Substring($arrEnd)   # starts at the closing ']'

    # We only ever insert immediately before the array's closing bracket, so the
    # only way to corrupt the file is to splice at a bad boundary. Verify the
    # character right before the insertion point is a complete-object '}' (normal
    # case) or the array-opening '[' (empty array). Anything else -> abort.
    # (Full ConvertFrom-Json validation is unusable here: Windows PowerShell 5.1
    # rejects the game's own entries, which use empty/duplicate JSON keys.)
    $lastChar = $head[$head.Length - 1]
    if ($lastChar -eq '[') {
        $new = $head + $eol + $entries + $eol + $tail
    } elseif ($lastChar -eq '}') {
        $new = $head + ',' + $eol + $entries + $eol + $tail
    } else {
        throw "Unexpected character '$lastChar' before the end of the plugins array; aborting to avoid corruption."
    }

    # Sanity-check our own additions are well-formed JSON (always true, but cheap).
    foreach ($e in $todo) {
        $null = ('{"name":"' + $e + '","status":true,"description":"","parameters":{}}' | ConvertFrom-Json)
    }

    Write-Text $PluginsJsPath $new
    return 'patched'
}

# Undo the registration: restore the backup if present, otherwise strip our
# exact entries back out of the array.
function Remove-PluginsFromList {
    param([string]$PluginsJsPath, [string]$BackupPath, [string[]]$Names)
    if (Test-Path -LiteralPath $BackupPath) {
        Copy-Item -LiteralPath $BackupPath -Destination $PluginsJsPath -Force
        return 'restored'
    }
    $s = Read-Text $PluginsJsPath
    $eol = if ($s.Contains("`r`n")) { "`r`n" } else { "`n" }
    foreach ($n in $Names) {
        $entry = '{"name":"' + $n + '","status":true,"description":"","parameters":{}}'
        $s = $s.Replace(',' + $eol + $entry, '')
        $s = $s.Replace($entry + ',' + $eol, '')
        $s = $s.Replace($entry, '')
    }
    Write-Text $PluginsJsPath $s
    return 'cleaned'
}
