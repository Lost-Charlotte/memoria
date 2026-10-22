param(
  [string]$ListFile = '',
  # 2026-10-22 added -Item (user: "the tool should do it in one step").
  # Why: deleting ONE file used to require writing a list file first -- an extra step
  # that made "just use the tool" more work than doing it by hand. -ListFile / -Item
  # are alternatives; at least one is required.
  [string[]]$Item = @(),
  [string[]]$AllowSerial = @('66F2A64D','163AE928','049F5F69'),
  [string[]]$DenyWriteSerial = @(),
  [switch]$AllowLocalDrives,
  [switch]$DryRun,
  [switch]$ShowLimits,
  [switch]$UserApprovedBannedDriveWrite,
  # ---- 2026-09-27 added: PERMANENT delete, behind a hood + a service hatch ----
  # -Permanent ALONE DOES NOTHING: it must be paired with -UserApprovedPurge, and the AI is not
  # allowed to reach for that pair on its own. The archive gate (F30) refuses any command that
  # contains "-Permanent" unless the USER's latest message carries the fixed approval phrase
  # ("approval: <what>" in Chinese). The automatic pipeline (plugin F19) never comes through this
  # script at all -- it removes its own snapshots directly.
  #   => the blade lives inside the pipeline; the AI's hands have none.
  # NOTE: DeletePermanently + 'OnlyErrorDialogs' does NOT show a confirmation dialog (unlike the
  # shell verb InvokeVerb('Delete'), which prompted once per item on 2026-09-27 -- see R35).
  [switch]$Permanent,
  [switch]$UserApprovedPurge
)

# --------------------------------------------------------------------------
# 2026-10-21 guard: PowerShell Core (pwsh 7) MUST NOT attempt the real delete.
#
# Why: this script recycles via [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory /
# DeleteFile with 'SendToRecycleBin'. That is a .NET Framework feature; under .NET Core it
# throws ArgumentException "The path is not of a legal form" (ZH: the path is invalid).
# The message is MISLEADING: it looks like a bad path / bad permissions, and on 2026-10-21 it
# sent the AI hunting path length and ACLs for three rounds before it noticed the edition.
# (Archive: cuowuben R8, 8th occurrence.)
#
# Dry run is safe (it never touches VB), so it stays allowed under any edition.
# NOTE: keep this file pure ASCII (R2) -- no Chinese anywhere, comments included.
# --------------------------------------------------------------------------
if ((-not $DryRun) -and ($PSVersionTable.PSEdition -eq 'Core')) {
  Write-Output "REFUSE: real delete under PowerShell Core is not supported."
  Write-Output "        This script recycles through Microsoft.VisualBasic, which only works on"
  Write-Output "        .NET Framework (Windows PowerShell 5.1). Under pwsh 7 it fails with a"
  Write-Output "        misleading 'The path is not of a legal form' error."
  Write-Output "        Re-run with:  powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" <same args>"
  Write-Output "        (Dry runs and -ShowLimits are fine here.)"
  exit 2
}

# Send the FILES or DIRECTORIES listed in a UTF-8 text file to the Recycle Bin (recoverable).
#
# Safety valve 1 (drive identity): a path is only touched when the VOLUME SERIAL of its drive is
#   in -AllowSerial. Drive letters drift on every replug, so a letter is NEVER the criterion (X4).
#   Local fixed drives need -AllowLocalDrives (see $localSerials below).
# Safety valve 2 (optional per-volume block): -DenyWriteSerial is EMPTY by default -- the user has
#   full permission to write/delete anywhere (2026-09-15: "you were always allowed; I trust you").
#   The parameter is kept only as a spare switch for temporarily blocking one volume.
#   The real rule is NOT about permission -- it is: never let a move/copy silently become a delete.
#   That is what -DryRun, the recycle bin, and the verification steps in the archive are for.
# Safety valve 3 (recycle-bin limits) -- added 2026-09-15:
#   a) If the Recycle Bin is DISABLED for that volume (NukeOnDelete=1), deleting = permanent.
#   b) If an item is BIGGER than that volume's Recycle Bin quota (MaxCapacity, MB), Windows would
#      either prompt ("too big -- delete permanently?") or fail. With UIOption.OnlyErrorDialogs a
#      prompt can HANG an unattended script, so we refuse up front instead.
#   In both cases the item is reported as CANNOT-RECYCLE and is NOT deleted. This script NEVER
#   falls back to a permanent delete on its own -- a permanent delete needs the user to say so.
#
# NOTE: on the system drive the items land in C:\$Recycle.Bin, so free space does NOT come back
# until the Recycle Bin is emptied -- and emptying it is irreversible. Never empty it on your own.
#
# Usage:
#   ... -ListFile <utf8 list> -DryRun                 (always dry-run first)
#   ... -ListFile <utf8 list>                         (then for real)
#   ... -ListFile <utf8 list> -ShowLimits             (just print each volume's recycle limit)
#
# This file must stay ASCII-only (PowerShell 5.1 reads .ps1 as ANSI and mangles CJK literals).
Add-Type -AssemblyName Microsoft.VisualBasic
$ErrorActionPreference = 'Continue'

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

# Returns @{ MaxBytes = [long] or $null ; NukeOnDelete = $true/$false }
function Get-RecycleBinLimit([string]$driveLetter) {
  $res = @{ MaxBytes = $null; NukeOnDelete = $false }
  try {
    $vol = Get-Volume -DriveLetter $driveLetter -ErrorAction Stop
    $uid = [string]$vol.UniqueId
    if ($uid -match '\{(.+?)\}') {
      $guid = $matches[1]
      $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\BitBucket\Volume\{' + $guid + '}'
      if (Test-Path -Path $key) {
        $p = Get-ItemProperty -Path $key -ErrorAction SilentlyContinue
        if ($p) {
          if ($p.MaxCapacity) { $res.MaxBytes = [long]$p.MaxCapacity * 1MB }
          if ($p.NukeOnDelete -eq 1) { $res.NukeOnDelete = $true }
        }
      }
      if ((-not $res.MaxBytes) -and $vol.Size) { $res.MaxBytes = [long]([double]$vol.Size * 0.05) }
    }
  } catch { }
  try {
    $g = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\BitBucket' -ErrorAction Stop
    if ($g.NukeOnDelete -eq 1) { $res.NukeOnDelete = $true }
  } catch { }
  return $res
}

# Size of a file, or of a directory tree. Stops counting once it is over $stopAbove (perf guard).
function Get-ItemSize([string]$Path, [long]$stopAbove) {
  $total = [long]0
  $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
  if (-not $item) { return [long]0 }
  if (-not $item.PSIsContainer) { return [long]$item.Length }
  $stack = New-Object System.Collections.Stack
  $stack.Push($Path)
  while ($stack.Count -gt 0) {
    $cur = $stack.Pop()
    foreach ($f in (Get-ChildItem -LiteralPath $cur -File -Force -ErrorAction SilentlyContinue)) {
      $total += [long]$f.Length
      if ($total -gt $stopAbove) { return $total }
    }
    foreach ($d in (Get-ChildItem -LiteralPath $cur -Directory -Force -ErrorAction SilentlyContinue)) { $stack.Push($d.FullName) }
  }
  return $total
}

$allow = @()
foreach ($s in $AllowSerial) { if ($s) { $allow += $s.Trim().ToUpper() } }

# Internal fixed volumes of THIS machine (measured 2026-09-15 with the drive-resolver script's
# -ListOnly mode, file "tool-resolve-drive.ps1" in the archive):
#   C: E435C288 / D: F2865BBC / E: 448D161E
# They are volume serials (not letters), so they survive letter drift; but RE-VERIFY after an
# OS reinstall or a disk swap -- the serials will change.
#
# 2026-10-22: fixed volumes are allowed BY DEFAULT now (user: "our own disks cannot jump around,
# this whole mechanism is not needed for them"). The whitelist is still the gate for REMOVABLE
# volumes -- only those drift when replugged, which is what it was ever protecting against.
# -AllowLocalDrives is kept for compatibility and no longer changes anything (the serials below
# are already in $allow).
$localSerials = @('E435C288','F2865BBC','448D161E')
foreach ($s in $localSerials) { $allow += $s }
if ($AllowLocalDrives) { foreach ($s in $localSerials) { $allow += $s } }  # no-op, kept for old command lines

$deny = @()
foreach ($s in $DenyWriteSerial) { if ($s) { $deny += $s.Trim().ToUpper() } }
$serialCache = @{}
$limitCache = @{}

if ($Item.Count -gt 0) {
  $lines = $Item
} elseif ($ListFile -and (Test-Path -LiteralPath $ListFile)) {
  $lines = [System.IO.File]::ReadAllLines($ListFile, [System.Text.Encoding]::UTF8)
} else {
  Write-Host 'ERROR: give -Item <path>[,<path>...] or -ListFile <utf8 list>. Neither was usable.'
  Write-Host '  example: recycle-del.ps1 -Item "C:\path\to\file.txt" -AllowLocalDrives -DryRun'
  exit 2
}

# Parse once, so both the pre-flight and the work loop see the same entries.
$entries = @()
foreach ($raw in $lines) {
  $p = $raw.Trim()
  if ((-not $p) -or $p.StartsWith('#') -or $p.Length -lt 3 -or ($p[1] -ne ':')) { continue }
  $letter = $p.Substring(0,1).ToUpper()
  if (-not $serialCache.ContainsKey($letter)) { $serialCache[$letter] = Get-PathVolumeSerial $p }
  if (-not $limitCache.ContainsKey($letter)) { $limitCache[$letter] = Get-RecycleBinLimit $letter }
  $e = New-Object psobject
  $e | Add-Member -MemberType NoteProperty -Name Path   -Value $p
  $e | Add-Member -MemberType NoteProperty -Name Letter -Value $letter
  $e | Add-Member -MemberType NoteProperty -Name Serial -Value $serialCache[$letter]
  $entries += $e
}

if ($ShowLimits) {
  "volume recycle-bin limits:"
  foreach ($letter in ($limitCache.Keys | Sort-Object)) {
    $lim = $limitCache[$letter]
    $mb = 'unknown'
    if ($lim.MaxBytes) { $mb = [string][math]::Round($lim.MaxBytes / 1MB, 0) + ' MB' }
    "  " + $letter + ":  max=" + $mb + "  recycleDisabled=" + $lim.NukeOnDelete
  }
  return
}

# ---- pre-flight 0: PERMANENT delete needs the explicit user-approved switch (2026-09-27) ----
if ($Permanent -and (-not $UserApprovedPurge)) {
  "ABORT: -Permanent needs -UserApprovedPurge (a human must approve a permanent delete)."
  "Nothing was touched. Run WITHOUT -Permanent to send items to the Recycle Bin instead."
  exit 1
}
if ($Permanent) {
  "WARNING: PERMANENT delete mode is ON (user approved). Items will NOT go to the Recycle Bin."
  if (-not $DryRun) {
    $purgeDir = Join-Path $env:USERPROFILE '.dsh'
    $null = New-Item -ItemType Directory -Force -Path $purgeDir
    $purgeLog = Join-Path $purgeDir ('memoria-purge-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.txt')
    $entries | ForEach-Object { $_.Path } | Set-Content -LiteralPath $purgeLog -Encoding UTF8
    "purge list written (kept as evidence): $purgeLog"
  }
}

# ---- pre-flight 1: refuse to touch a banned (write-ban) volume ----
$banned = 0
foreach ($e in $entries) { if ($e.Serial -and ($deny -contains $e.Serial)) { "PREFLIGHT DENY: volume " + $e.Serial + " is under a WRITE BAN -> " + $e.Path; $banned++ } }
if (($banned -gt 0) -and (-not $UserApprovedBannedDriveWrite)) {
  "ABORT: $banned path(s) sit on a banned volume. Nothing was touched."
  "While the ban is on, copy the files OUT and keep the source (move-verify.ps1, mode=copy)."
  "If the user has explicitly said the private drives may be written again, re-run with -UserApprovedBannedDriveWrite"
  exit 1
}
if ($UserApprovedBannedDriveWrite -and $banned -gt 0) { "WARNING: write-ban override is ON (user approved). Denied entries: $banned" }

# ---- pre-flight 2: which items CANNOT go to the Recycle Bin ----
$cannotRecycle = @()
foreach ($e in $entries) {
  if ($Permanent) { continue }   # permanent mode: the Recycle Bin is not involved at all
  if (-not (Test-Path -LiteralPath $e.Path)) { continue }
  $lim = $limitCache[$e.Letter]
  if ($lim.NukeOnDelete) {
    $cannotRecycle += $e.Path
    "PREFLIGHT CANNOT-RECYCLE (recycle bin disabled on " + $e.Letter + ":) -> " + $e.Path
    continue
  }
  if ($lim.MaxBytes) {
    $size = Get-ItemSize -Path $e.Path -stopAbove ([long]$lim.MaxBytes)
    if ($size -gt [long]$lim.MaxBytes) {
      $cannotRecycle += $e.Path
      "PREFLIGHT CANNOT-RECYCLE (bigger than the " + $e.Letter + ": limit " + [string][math]::Round($lim.MaxBytes/1MB,0) + " MB; item is " + [string][math]::Round($size/1MB,0) + " MB) -> " + $e.Path
    }
  }
}

# ---- work ----
$ok = 0; $fail = 0; $skip = 0; $norecycle = 0
foreach ($e in $entries) {
  $path = $e.Path
  if (-not $e.Serial) { $skip++; "SKIP (serial unreadable on " + $e.Letter + ":): $path"; continue }
  if ($allow -notcontains $e.Serial) { $skip++; "SKIP (serial " + $e.Serial + " not allowed): $path"; continue }
  if (-not (Test-Path -LiteralPath $path)) { $skip++; "SKIP (missing): $path"; continue }
  if ($cannotRecycle -contains $path) { $norecycle++; "SKIP (cannot be recycled -- see pre-flight): $path"; continue }
  $item = Get-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
  $isDir = $false
  if ($item -and $item.PSIsContainer) { $isDir = $true }
  if ($DryRun) {
    $ok++
    if ($isDir) { "DRYRUN would recycle DIR : $path" } else { "DRYRUN would recycle FILE: $path" }
    continue
  }
  try {
    $vbOpt = 'SendToRecycleBin'
    if ($Permanent) { $vbOpt = 'DeletePermanently' }
    if ($isDir) {
      [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($path, 'OnlyErrorDialogs', $vbOpt)
      if ($Permanent) { "   DIR  PERMANENTLY deleted: $path" } else { "   DIR  sent to Recycle Bin: $path" }
    } else {
      [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($path, 'OnlyErrorDialogs', $vbOpt)
      if ($Permanent) { "   FILE PERMANENTLY deleted: $path" }
    }
    $ok++
  } catch {
    $fail++
    "FAIL: $path  ->  $($_.Exception.Message)"
  }
}

if ($DryRun) { "---- dry-run: would-recycle: $ok   failed: $fail   skipped: $skip   cannot-recycle: $norecycle" }
elseif ($Permanent) { "---- PERMANENTLY deleted: $ok   failed: $fail   skipped: $skip" }
else { "---- deleted-to-recyclebin: $ok   failed: $fail   skipped: $skip   cannot-recycle: $norecycle" }
if ($norecycle -gt 0) {
  "!! $norecycle item(s) CANNOT go to the Recycle Bin and were NOT deleted (fail-safe)."
  "   Do NOT just switch to a permanent delete. Either:"
  "     1) ask the user explicitly whether that item may be deleted for good, or"
  "     2) keep it but rename/move it (e.g. into a '_to-review' folder) until the user decides."
}
