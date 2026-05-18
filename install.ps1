param(
  [string]$Version = $env:SHAPE_VERSION,
  [string]$InstallDir = $env:SHAPE_INSTALL_DIR,
  [string]$Repository = $env:SHAPE_REPO
)

$ErrorActionPreference = "Stop"

$DefaultVersion = "__SHAPE_DEFAULT_VERSION__"
$Placeholder = "__SHAPE_DEFAULT_" + "VERSION__"
if ($DefaultVersion -eq $Placeholder) {
  $DefaultVersion = "latest"
}

if ([string]::IsNullOrWhiteSpace($Version)) {
  $Version = $DefaultVersion
}

if ([string]::IsNullOrWhiteSpace($InstallDir)) {
  $InstallDir = Join-Path $HOME ".local\bin"
}

if ([string]::IsNullOrWhiteSpace($Repository)) {
  $Repository = "timbrinded/shapelang"
}

if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne [System.Runtime.InteropServices.Architecture]::X64) {
  throw "No shp release asset is published for this Windows architecture."
}

$Asset = "shp-windows-x64.tar.gz"
if ($Version -eq "latest") {
  $BaseUrl = "https://github.com/$Repository/releases/latest/download"
} else {
  $BaseUrl = "https://github.com/$Repository/releases/download/$Version"
}

$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $TempDir | Out-Null

try {
  $AssetPath = Join-Path $TempDir $Asset
  $ChecksumsPath = Join-Path $TempDir "checksums.txt"

  Write-Host "downloading $Asset from $Repository $Version"
  Invoke-WebRequest -Uri "$BaseUrl/$Asset" -OutFile $AssetPath
  Invoke-WebRequest -Uri "$BaseUrl/checksums.txt" -OutFile $ChecksumsPath

  $ChecksumLine = Get-Content $ChecksumsPath | Where-Object {
    $_ -match "\s(\./)?$([regex]::Escape($Asset))$"
  } | Select-Object -First 1

  if ([string]::IsNullOrWhiteSpace($ChecksumLine)) {
    throw "Checksum for $Asset not found."
  }

  $Expected = ($ChecksumLine -split "\s+")[0]
  $Actual = (Get-FileHash -Algorithm SHA256 $AssetPath).Hash.ToLowerInvariant()

  if ($Expected.ToLowerInvariant() -ne $Actual) {
    throw "Checksum verification failed for $Asset."
  }

  tar -xzf $AssetPath -C $TempDir

  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  Copy-Item -Force (Join-Path $TempDir "shp.exe") (Join-Path $InstallDir "shp.exe")

  if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_PATH)) {
    Add-Content -Path $env:GITHUB_PATH -Value $InstallDir
  }

  Write-Host "installed shp.exe to $InstallDir"

  $PathEntries = $env:PATH -split [System.IO.Path]::PathSeparator
  if ($PathEntries -notcontains $InstallDir) {
    Write-Host "add shp to your PATH with:"
    Write-Host "  `$env:PATH = `"$InstallDir;$env:PATH`""
  }
} finally {
  Remove-Item -Recurse -Force $TempDir
}
