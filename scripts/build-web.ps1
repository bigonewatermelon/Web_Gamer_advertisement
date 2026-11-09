param(
    [string]$CreatorPath = $env:COCOS_CREATOR_PATH
)

$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
if (-not $CreatorPath) {
    $CreatorPath = 'C:\ProgramData\cocos\editors\Creator\3.8.5\CocosCreator.exe'
}
if (-not (Test-Path -LiteralPath $CreatorPath -PathType Leaf)) {
    throw 'Cocos Creator 3.8.5 is missing. Set COCOS_CREATOR_PATH to CocosCreator.exe.'
}

$logs = Join-Path $project 'temp/ci-build'
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$config = Join-Path $PSScriptRoot 'web-build.json'
$arguments = '--project "' + $project + '" --build "configPath=' + $config + '"'
# Start-Process -Wait also waits for Electron's descendant processes, which can
# remain alive after a successful command-line build on a hosted Windows runner.
$process = Start-Process -FilePath $CreatorPath -ArgumentList $arguments `
    -WorkingDirectory $project -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput (Join-Path $logs 'stdout.log') `
    -RedirectStandardError (Join-Path $logs 'stderr.log')
$deadline = [DateTime]::UtcNow.AddMinutes(15)
$nextProgress = [DateTime]::UtcNow.AddSeconds(30)
while (-not $process.WaitForExit(1000)) {
    if ([DateTime]::UtcNow -ge $deadline) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        throw 'Cocos build exceeded 15 minutes. See temp/ci-build.'
    }
    if ([DateTime]::UtcNow -ge $nextProgress) {
        Get-Content (Join-Path $logs 'stdout.log') -Tail 5
        $nextProgress = [DateTime]::UtcNow.AddSeconds(30)
    }
}

Get-Content (Join-Path $logs 'stdout.log') -Tail 35
Get-Content (Join-Path $logs 'stderr.log') -Tail 35
# Cocos Creator documents exit code 36 as a successful build.
if ($process.ExitCode -ne 36) {
    throw "Cocos build failed with exit code $($process.ExitCode). See temp/ci-build."
}

$output = Join-Path $project 'build/web-release'
if (-not (Test-Path (Join-Path $output 'index.html'))) {
    throw 'Build did not generate index.html.'
}
$settingsFiles = @(Get-ChildItem (Join-Path $output 'src') -Filter 'settings*.json')
if ($settingsFiles.Count -ne 1) { throw 'Build settings file is missing or ambiguous.' }
$settings = Get-Content $settingsFiles[0].FullName -Raw | ConvertFrom-Json
if ($settings.engine.debug -ne $false) { throw 'Expected a release build with debugging disabled.' }

New-Item -ItemType File -Path (Join-Path $output '.nojekyll') -Force | Out-Null
$commit = if ($env:GITHUB_SHA) { $env:GITHUB_SHA } else { git -C $project rev-parse HEAD }
@{
    commit = $commit
    builtAt = (Get-Date).ToUniversalTime().ToString('o')
    creator = '3.8.5'
} | ConvertTo-Json | Set-Content (Join-Path $output 'version.json') -Encoding utf8
Write-Output "Release build ready: $output ($commit)"
