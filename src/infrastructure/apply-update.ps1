param([Parameter(Mandatory=$true)][string]$JobFile)
$ErrorActionPreference = 'Stop'
$job = $null; $updateMutex = $null; $locked = $false; $backup = $null; $appMoved = $false; $newAppMoved = $false; $uninstallerMoved = $false; $newUninstallerMoved = $false; $phase='validating'
$registrationChanged=$false; $oldDisplayVersion=$null
function Assert-Directory([string]$value) {
  $resolved = [IO.Path]::GetFullPath($value)
  $cursor = $resolved
  while ($cursor) {
    $entry = Get-Item -LiteralPath $cursor -Force
    if (!$entry.PSIsContainer -or ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Linked update directory rejected.' }
    $parent = [IO.Directory]::GetParent($cursor)
    if (!$parent) { break }; $cursor = $parent.FullName
  }
  return $resolved.TrimEnd('\')
}
function File-Hash([string]$file) {
  $item = Get-Item -LiteralPath $file -Force
  if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Linked update file rejected.' }
  $stream=[IO.File]::OpenRead($file); $algorithm=[Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','').ToLowerInvariant() } finally { $stream.Dispose(); $algorithm.Dispose() }
}
function Write-Result([string]$status,[string]$message) {
  if ($job) {
    $result = @{time=[DateTime]::UtcNow.ToString('o');status=$status;message=$message;version=$job.version;root=$job.root;backup=$backup;phase=$phase}
    [IO.File]::WriteAllText($job.result,($result|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
  }
}
try {
  $jobFileAbsolute = [IO.Path]::GetFullPath($JobFile)
  $job = Get-Content -LiteralPath $jobFileAbsolute -Raw -Encoding UTF8 | ConvertFrom-Json
  if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($job.result)) -ne [IO.Path]::GetDirectoryName($jobFileAbsolute)) { throw 'Result path is outside update state directory.' }
  $root = Assert-Directory $job.root; $stage = Assert-Directory $job.stage
  if ([IO.Path]::GetDirectoryName($stage) -ne $root -or [IO.Path]::GetFileName($stage) -notmatch '^\.ocut-update-[a-zA-Z0-9]+$') { throw 'Invalid update staging path.' }
  if ($job.version -notmatch '^\d{1,5}\.\d{1,5}\.\d{1,5}$' -or $job.manifestSha256 -notmatch '^[a-f0-9]{64}$' -or $job.asarSha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid update identity.' }
  $installedIni = Join-Path $root 'ocut-install.ini'; $ini = Get-Content -LiteralPath $installedIni -Raw -Encoding UTF8
  if ($ini -notmatch '(?m)^id=studio\.ocut\.desktop\r?$') { throw 'Installation ownership is unknown.' }
  $rootHash = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant()))).Replace('-','')
  $updateMutex = [Threading.Mutex]::new($false,('Local\OCUT-Update-'+$rootHash))
  try {$locked=$updateMutex.WaitOne(0)} catch [Threading.AbandonedMutexException] {$locked=$true}
  if (!$locked) { throw 'Another update is already applying.' }
  $appPath = Join-Path $root 'app'; $executable = Join-Path $appPath 'O-CUT.exe'; $uninstaller = Join-Path $root 'Uninstall O-CUT.exe'
  $deadline = [DateTime]::UtcNow.AddSeconds([Math]::Min(86400,[Math]::Max(1,[double]$job.waitSeconds)))
  Write-Result 'waiting' 'Waiting for O-CUT to close. Existing app is unchanged.'
  do {
    $running = @(Get-CimInstance Win32_Process -Filter "Name = 'O-CUT.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.Equals($executable,[StringComparison]::OrdinalIgnoreCase) })
    if (!$running.Count) { break }
    if ([DateTime]::UtcNow -gt $deadline) { throw 'Timed out waiting for app to close; existing app preserved.' }
    Start-Sleep -Milliseconds 500
  } while ($true)
  $null = Assert-Directory $root; $null = Assert-Directory $stage; $null = Assert-Directory $appPath
  $manifestFile = Join-Path $stage 'UPDATE-MANIFEST.json'
  if ((File-Hash $manifestFile) -ne $job.manifestSha256) { throw 'Update manifest hash mismatch.' }
  $manifest = Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($manifest.version -ne $job.version -or $manifest.asarSha256 -ne $job.asarSha256 -or !$manifest.files.Count -or $manifest.files.Count -gt 1000) { throw 'Update manifest identity mismatch.' }
  $seen = @{}
  foreach ($file in $manifest.files) {
    if ($file.file -notmatch '^(app/|Uninstall O-CUT\.exe$)' -or $file.file -match '[\\:"<>|?*\x00-\x1f]' -or @($file.file.Split('/')|Where-Object{!$_ -or $_ -eq '.' -or $_ -eq '..' -or $_ -match '[ .]$'}).Count) { throw 'Unsafe update file name.' }
    if ($seen.ContainsKey($file.file.ToLowerInvariant())) { throw 'Duplicate update file.' }; $seen[$file.file.ToLowerInvariant()]=$true
    $full = [IO.Path]::GetFullPath((Join-Path $stage $file.file))
    if (!$full.StartsWith($stage+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Update path escapes stage.' }
    $null = Assert-Directory ([IO.Path]::GetDirectoryName($full))
    if ((Get-Item -LiteralPath $full).Length -ne $file.bytes -or (File-Hash $full) -ne $file.sha256) { throw ('Update file verification failed: '+$file.file) }
  }
  foreach ($required in @('app/o-cut.exe','app/resources/app.asar','uninstall o-cut.exe')) { if (!$seen.ContainsKey($required)) { throw 'Required update file missing.' } }
  if ((File-Hash (Join-Path $stage 'app/resources/app.asar')) -ne $job.asarSha256) { throw 'App source digest mismatch.' }
  # Reject unlisted files before swapping directories. No source or user file is deleted.
  foreach ($file in Get-ChildItem -LiteralPath (Join-Path $stage 'app') -Recurse -Force) {
    if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked staged content rejected.' }
    if (!$file.PSIsContainer) { $relative=$file.FullName.Substring($stage.Length+1).Replace('\','/').ToLowerInvariant(); if (!$seen.ContainsKey($relative)) { throw 'Unlisted staged file rejected.' } }
  }
  $latestIni = Get-Content -LiteralPath $installedIni -Raw -Encoding UTF8
  if ($latestIni -ne $ini) { throw 'Installation changed while waiting.' }
  $oldVersion = [regex]::Match($ini,'(?m)^version=([^\r\n]+)').Groups[1].Value
  if ([version]$job.version -le [version]$oldVersion) { throw 'Same-version and downgrade updates are rejected.' }
  $backup = Join-Path $root ('backup-update-'+$oldVersion+'-'+[Guid]::NewGuid().ToString('N'))
  if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($backup)) -ne $root) { throw 'Invalid backup path.' }
  $null = New-Item -ItemType Directory -Path $backup
  Copy-Item -LiteralPath $installedIni -Destination (Join-Path $backup 'ocut-install.ini')
  # First checkpoint the complete previous application and its matching uninstaller.
  Move-Item -LiteralPath $appPath -Destination (Join-Path $backup 'app'); $appMoved=$true; $phase='old-app-moved'
  Move-Item -LiteralPath $uninstaller -Destination (Join-Path $backup 'Uninstall O-CUT.exe'); $uninstallerMoved=$true
  Move-Item -LiteralPath (Join-Path $stage 'app') -Destination $appPath; $newAppMoved=$true
  Move-Item -LiteralPath (Join-Path $stage 'Uninstall O-CUT.exe') -Destination $uninstaller; $newUninstallerMoved=$true
  if ((File-Hash (Join-Path $appPath 'resources/app.asar')) -ne $job.asarSha256) { throw 'Activated application does not match verified update.' }
  $newIni = $ini -replace '(?m)^version=[^\r\n]+',('version='+$job.version)
  [IO.File]::WriteAllText($installedIni,$newIni,[Text.UTF8Encoding]::new($false))
  # Only update registration already owned by this exact installation.
  $key='HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\O-CUT'
  if (Test-Path -LiteralPath $key) {
    $registered=Get-ItemProperty -LiteralPath $key
    if ($registered.InstallLocation -and $registered.InstallLocation.TrimEnd('\').Equals($root,[StringComparison]::OrdinalIgnoreCase)) { $oldDisplayVersion=$registered.DisplayVersion;Set-ItemProperty -LiteralPath $key -Name DisplayVersion -Value $job.version;$registrationChanged=$true }
  }
  $phase='activated';Write-Result 'applied' 'Update installed. Previous app and uninstaller are preserved in backup.'
  if ($job.restart) { $env:ELECTRON_RUN_AS_NODE=$null; Start-Process -FilePath $executable -WindowStyle Hidden }
} catch {
  $failure=$_.Exception.Message; $rollbackFailure=$null
  try {
    if ($newAppMoved) { Move-Item -LiteralPath $appPath -Destination (Join-Path $stage 'app') }
    if ($newUninstallerMoved) { Move-Item -LiteralPath $uninstaller -Destination (Join-Path $stage 'Uninstall O-CUT.exe') }
    if ($appMoved) { Move-Item -LiteralPath (Join-Path $backup 'app') -Destination $appPath }
    if ($uninstallerMoved) { Move-Item -LiteralPath (Join-Path $backup 'Uninstall O-CUT.exe') -Destination $uninstaller }
    if ($appMoved) { Copy-Item -LiteralPath (Join-Path $backup 'ocut-install.ini') -Destination $installedIni -Force }
    if ($registrationChanged) { $currentRegistration=Get-ItemProperty -LiteralPath $key;if ($currentRegistration.InstallLocation -ne $root -or $currentRegistration.DisplayVersion -ne $job.version) {throw 'Registration changed during rollback.'};if ($null -eq $oldDisplayVersion) {Remove-ItemProperty -LiteralPath $key -Name DisplayVersion} else {Set-ItemProperty -LiteralPath $key -Name DisplayVersion -Value $oldDisplayVersion} }
  } catch { $rollbackFailure=$_.Exception.Message }
  if ($rollbackFailure) { Write-Result 'recovery_required' ($failure+'; rollback: '+$rollbackFailure) } else { Write-Result 'failed' ($failure+'; previous application preserved.') }
  exit 1
} finally { if ($locked) { $updateMutex.ReleaseMutex() }; if ($updateMutex) { $updateMutex.Dispose() } }
