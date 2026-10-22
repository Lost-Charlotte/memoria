param(
  [string]$ListFile = '',
  # 2026-10-22 added -Item: same reason as recycle-del.ps1.
  # Each -Item is ONE list line, same format as in the file: "src|dst" or "src|dst|copy|move".
  # So a single file move no longer needs a list file on disk first.
  [string[]]$Item = @(),
  [string[]]$DenyWriteSerial = @(),
  [switch]$UserApprovedBannedDriveWrite
)
# Copy (and optionally move) files or directories listed in a UTF-8 file:
#     src|dst|<mode>          # mode = copy | move
# mode column (3rd field) is optional: OMIT it entirely -> "copy".
# WARNING: give it but leave it EMPTY (e.g. "a|b||move") -> hard reject "unknown mode ''".
#          (measured 2026-09-23; the 4th field is NOT a second mode)
#
# ================= SAFETY RULES (structural, not reminders) =================
# Why they exist: on 2026-09-14, "Move-Item -Destination <a directory that did
# not exist>" was silently interpreted as a RENAME, and the following -Force
# overwrote the result. Four files were lost for good (overwrite never reaches
# the Recycle Bin). Every rule below removes one of the ways that could happen.
#
#   R1. TWO destination semantics, never mixed (this is where 09-14 died):
#         - dst ends with a slash, or already exists as a directory
#               -> "put the source INTO that directory"
#         - otherwise
#               -> "dst is the new file name"
#   R2. The destination PARENT must be a real directory before anything is
#       copied: if missing it is created, then re-checked; if it still is not a
#       directory the whole run STOPS (fail-closed).
#   R3. If the destination already exists, REFUSE. There is no -Force here and
#       overwriting is not implemented on purpose.
#   R4. Copy first, then verify size + MD5, and ONLY THEN touch the source.
#   R5. The source always goes to the Recycle Bin. Never a permanent delete.
#   R6. Any failure STOPS the entire run. No "skip this one and continue".
#   R7. Single-file mode (added 2026-09-23) so renames can go through this same
#       door instead of someone hand-rolling a move command.
#
# NOTE (2026-09-23): the destination resolution is INLINE on purpose. The first
# version wrapped it in a function that both returned the path and echoed
# progress strings -- PowerShell then returned an array of both, and
# Copy-Item -Destination got an Object[] instead of a String. Caught by the
# mandatory sample dry-run. Do not "tidy" this back into a function without
# making the progress output go somewhere other than the pipeline.
#
# The caller must still resolve src/dst by VOLUME SERIAL before writing this
# list (archive rule X4). ASCII only (PowerShell 5.1 reads .ps1 as ANSI and
# mangles CJK literals).

$ErrorActionPreference = 'Stop'

function Get-PathVolumeSerial([string]$Path) {
  if ((-not $Path) -or ($Path.Length -lt 2) -or ($Path[1] -ne ':')) { return $null }
  $letter = $Path.Substring(0,1).ToUpper()
  try {
    $vol = Get-Volume -DriveLetter $letter -ErrorAction Stop
    if ($vol -and $vol.SerialNumber) { return $vol.SerialNumber.Trim().ToUpper() }
  } catch { }
  try {
    $disk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter ("DeviceID='" + $letter + ":'") -ErrorAction Stop
    if ($disk -and $disk.VolumeSerialNumber) { return $disk.VolumeSerialNumber.Trim().ToUpper() }
  } catch { }
  return $null
}

function Send-FileToRecycleBin([string]$Path) {
  Add-Type -AssemblyName Microsoft.VisualBasic
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($Path, 'OnlyErrorDialogs', 'SendToRecycleBin')
}

function Send-DirToRecycleBin([string]$Path) {
  Add-Type -AssemblyName Microsoft.VisualBasic
  [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($Path, 'OnlyErrorDialogs', 'SendToRecycleBin')
}

$deny = @()
foreach ($s in $DenyWriteSerial) { if ($s) { $deny += $s.Trim().ToUpper() } }

if ($Item.Count -gt 0) {
  $lines = $Item
} elseif ($ListFile -and (Test-Path -LiteralPath $ListFile)) {
  $lines = [System.IO.File]::ReadAllLines($ListFile, [System.Text.Encoding]::UTF8)
} else {
  Write-Host 'ERROR: give -Item "src|dst"[, ...] or -ListFile <utf8 list>. Neither was usable.'
  Write-Host '  example: move-verify.ps1 -Item "C:\a.txt|D:\b.txt"'
  exit 2
}
$items = @()
foreach ($line in $lines) {
  if (-not $line.Trim()) { continue }
  if ($line.Trim().StartsWith('#')) { continue }
  $f = $line.Split('|')
  if ($f.Count -lt 2) { continue }
  $mode = 'copy'
  if ($f.Count -gt 2) { $mode = $f[2].Trim() }
  if ($mode -ne 'copy' -and $mode -ne 'move') {
    "STOP: unknown mode '$mode' (allowed: copy | move)"
    exit 1
  }
  $obj = New-Object psobject
  $obj | Add-Member -MemberType NoteProperty -Name Src  -Value $f[0].Trim()
  $obj | Add-Member -MemberType NoteProperty -Name Dst  -Value $f[1].Trim()
  $obj | Add-Member -MemberType NoteProperty -Name Mode -Value $mode
  $items += $obj
}
"items: $($items.Count)"

# ---- pre-flight: refuse to write onto a banned (or unverifiable) volume ----
$blocked = 0
foreach ($it in $items) {
  $dserial = Get-PathVolumeSerial $it.Dst
  if (-not $dserial) {
    "PREFLIGHT BLOCK: cannot resolve the destination volume -> " + $it.Dst
    $blocked++
    continue
  }
  if ($deny -contains $dserial) {
    "PREFLIGHT DENY: destination volume " + $dserial + " is under a WRITE BAN -> " + $it.Dst
    $blocked++
  }
}
if (($blocked -gt 0) -and (-not $UserApprovedBannedDriveWrite)) {
  "ABORT: $blocked destination(s) blocked or unverifiable. NOTHING was copied."
  "If the user has explicitly said the private drives may be written again, re-run with -UserApprovedBannedDriveWrite"
  exit 1
}
if ($UserApprovedBannedDriveWrite -and $blocked -gt 0) { "WARNING: write-ban override is ON (user approved). Blocked entries: $blocked" }

# ---- do the work ----
foreach ($it in $items) {
  $src = $it.Src
  $dst = $it.Dst
  $mode = $it.Mode
  "==== $mode : $src  ->  $dst"
  if (-not (Test-Path -LiteralPath $src)) { "SKIP: source missing -> $src"; continue }

  $srcIsFile = (Test-Path -LiteralPath $src -PathType Leaf)

  if ($srcIsFile) {
    # ---------------- single file mode (R7) ----------------
    # R1: decide the two destination semantics EXPLICITLY (09-14 died here)
    $dstIsDirLike = $false
    if ($dst.EndsWith('\') -or $dst.EndsWith('/')) { $dstIsDirLike = $true }
    elseif (Test-Path -LiteralPath $dst -PathType Container) { $dstIsDirLike = $true }

    if ($dstIsDirLike) {
      $target = Join-Path $dst (Split-Path -Leaf $src)
      $parent = $dst
      "   dst is a directory -> target file name taken from the source"
    } else {
      $target = $dst
      $parent = Split-Path -Parent $dst
      "   dst is a new file name"
    }
    "   target: $target"

    if (-not $parent) { "STOP: cannot determine the destination parent -> $dst"; exit 1 }

    # R2: the parent must be a real directory (create, then re-check)
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
      "   parent missing -> creating: $parent"
      New-Item -ItemType Directory -Path $parent -Force | Out-Null
      if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        "STOP: destination parent is still not a directory after create -> $parent"
        exit 1
      }
      "   parent OK (created)"
    } else {
      "   parent OK (exists): $parent"
    }

    # R3: never overwrite
    if (Test-Path -LiteralPath $target) {
      "STOP: destination already exists, refusing to overwrite -> $target"
      exit 1
    }

    # R4: copy, then verify, and only then touch the source
    Copy-Item -LiteralPath $src -Destination $target -ErrorAction Stop
    "   copied -> $target"

    $s = Get-Item -LiteralPath $src -Force
    $t = Get-Item -LiteralPath $target -Force
    $ok = 0; $bad = 0
    if ($t.Length -ne $s.Length) {
      $bad++
      "      size mismatch: src=$($s.Length) dst=$($t.Length)"
    } elseif ((Get-FileHash -LiteralPath $src -Algorithm MD5).Hash -ne (Get-FileHash -LiteralPath $target -Algorithm MD5).Hash) {
      $bad++
      "      md5 mismatch"
    } else { $ok++ }
    "   verify: ok=$ok bad=$bad"

    if ($bad -gt 0) { "STOP: verification failed, source kept -> $src"; exit 1 }

    # R5
    if ($mode -eq 'move') {
      Send-FileToRecycleBin $src
      "   source sent to Recycle Bin (verified)"
    } else {
      "   source kept (copy mode)"
    }
  }
  else {
    # ---------------- directory mode (original behaviour) ----------------
    # R3 for directories (added 2026-09-26): if the destination directory
    # ALREADY EXISTS, REFUSE -- exactly the same rule as single-file mode.
    # Why: robocopy /E would silently MERGE the source into the existing tree,
    # and then R5 would send the source to the Recycle Bin -- the "rename +
    # overwrite" shape of 2026-09-14, one level up. Measured 2026-09-26:
    # an existing destination gained the source's files and the source still
    # went to the Recycle Bin. Same-day, same-file copies (src == dst) are also
    # caught here, because dst exists by definition.
    if (Test-Path -LiteralPath $dst) {
      "STOP: destination already exists, refusing to merge into it -> $dst"
      "      (directory mode refuses when the destination path exists at all;"
      "       to place it INTO an existing directory, pass the full new path)"
      exit 1
    }
    $rc = robocopy $src $dst /E /R:1 /W:1 /NFL /NDL /NJH /NP
    "   robocopy exit=$LASTEXITCODE"

    $ok = 0; $bad = 0; $badList = New-Object System.Collections.ArrayList
    foreach ($file in (Get-ChildItem -LiteralPath $src -Recurse -File -Force -ErrorAction SilentlyContinue)) {
      $rel = $file.FullName.Substring($src.Length)
      $t = Join-Path $dst $rel
      if (-not (Test-Path -LiteralPath $t)) { $bad++; [void]$badList.Add("missing: $rel"); continue }
      $ti = Get-Item -LiteralPath $t -Force
      if ($ti.Length -ne $file.Length) { $bad++; [void]$badList.Add("size: $rel"); continue }
      $h1 = (Get-FileHash -LiteralPath $file.FullName -Algorithm MD5).Hash
      $h2 = (Get-FileHash -LiteralPath $t -Algorithm MD5).Hash
      if ($h1 -eq $h2) { $ok++ } else { $bad++; [void]$badList.Add("md5: $rel") }
    }
    "   verify: ok=$ok bad=$bad"
    if ($bad -gt 0) { foreach ($b in ($badList | Select-Object -First 10)) { "      $b" } }

    # R6
    if ($bad -gt 0) { "STOP: verification failed, source kept -> $src"; exit 1 }

    if ($mode -eq 'move' -and $ok -gt 0) {
      Send-DirToRecycleBin $src
      "   source sent to Recycle Bin (verified)"
    } elseif ($mode -eq 'move') {
      "   nothing to verify (empty source?) -> refusing to delete the source"
      exit 1
    } else {
      "   source kept (copy mode)"
    }
  }
}
"DONE"
