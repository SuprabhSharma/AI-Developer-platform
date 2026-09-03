param(
    [Parameter(Mandatory=$true)][string]$Zip,
    [string]$Dest = (Get-Location).Path,
    [switch]$WhatIf   # preview only: show what would change, copy nothing
)

# Folders that should never be synced file-by-file: they're either reinstalled
# (node_modules, .venv) or regenerated (.next, public/monaco-editor, __pycache__).
$ExcludeDirNames = @("node_modules", ".next", ".git", "__pycache__", ".venv", "venv", "monaco-editor")

$Temp = Join-Path $env:TEMP ("sync-" + [guid]::NewGuid())
Write-Host "Extracting $Zip ..." -ForegroundColor Cyan
Expand-Archive -LiteralPath $Zip -DestinationPath $Temp -Force

$Root = Get-ChildItem -LiteralPath $Temp -Recurse -Directory -Filter "frontend" |
    Where-Object { $ExcludeDirNames -notcontains $_.Parent.Name } |
    Select-Object -First 1 -ExpandProperty Parent
if (-not $Root) { Write-Error "Couldn't find a 'frontend' folder inside the zip."; Remove-Item -LiteralPath $Temp -Recurse -Force; exit 1 }

Write-Host "Scanning source files under $($Root.FullName) ..." -ForegroundColor Cyan
$SourceFiles = Get-ChildItem -LiteralPath $Root.FullName -Recurse -File |
    Where-Object {
        $relativeDirs = $_.DirectoryName.Substring($Root.FullName.Length).Split([IO.Path]::DirectorySeparatorChar)
        -not ($relativeDirs | Where-Object { $ExcludeDirNames -contains $_ })
    }

$total = $SourceFiles.Count
if ($total -eq 0) { Write-Warning "No source files found (after excluding node_modules/.next/etc)."; Remove-Item -LiteralPath $Temp -Recurse -Force; exit 0 }
Write-Host "Comparing $total files against $Dest ..." -ForegroundColor Cyan

$copied  = New-Object System.Collections.Generic.List[string]
$added   = New-Object System.Collections.Generic.List[string]
$skipped = 0
$i = 0

foreach ($file in $SourceFiles) {
    $i++
    if ($i % 10 -eq 0 -or $i -eq $total) {
        Write-Progress -Activity "Comparing files" -Status "$i / $total" -PercentComplete (($i / $total) * 100)
    }

    $relative = $file.FullName.Substring($Root.FullName.Length + 1)
    $destPath = Join-Path $Dest $relative

    # Only re-copy when the file is new or its content actually differs.
    # Size is checked first (cheap) before hashing (more expensive), since
    # most unchanged files will already differ in size if they differ at all.
    $needsCopy = $true
    if (Test-Path -LiteralPath $destPath) {
        $srcLen  = $file.Length
        $destLen = (Get-Item -LiteralPath $destPath).Length
        if ($srcLen -eq $destLen) {
            $srcHash  = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
            $destHash = (Get-FileHash -LiteralPath $destPath -Algorithm SHA256).Hash
            $needsCopy = $srcHash -ne $destHash
        }
    } else {
        $added.Add($relative) | Out-Null
    }

    if ($needsCopy) {
        if (-not $WhatIf) {
            New-Item -ItemType Directory -Force -Path (Split-Path $destPath) | Out-Null
            Copy-Item -LiteralPath $file.FullName -Destination $destPath -Force
        }
        $copied.Add($relative) | Out-Null
    } else {
        $skipped++
    }
}
Write-Progress -Activity "Comparing files" -Completed

if ($copied.Count -gt 0) {
    Write-Host "`nChanged files:" -ForegroundColor Yellow
    $copied | ForEach-Object {
        $tag = if ($added -contains $_) { "[new]    " } else { "[updated]" }
        Write-Host "  $tag $_"
    }
} else {
    Write-Host "`nNo differences found." -ForegroundColor Green
}

Remove-Item -LiteralPath $Temp -Recurse -Force

if ($WhatIf) {
    Write-Host "`n(-WhatIf) Would copy $($copied.Count) file(s), leave $skipped unchanged." -ForegroundColor Magenta
} else {
    Write-Host "`nCopied $($copied.Count) file(s), left $skipped unchanged." -ForegroundColor Green
}