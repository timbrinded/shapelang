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
  $ParserAssets = Join-Path $TempDir "tree-sitter-language-pack"
  if (-not (Test-Path -LiteralPath $ParserAssets -PathType Container)) {
    throw "Release archive is missing tree-sitter-language-pack parser assets."
  }

  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  $TargetBinary = Join-Path $InstallDir "shp.exe"
  $InstallParserAssets = Join-Path $InstallDir "tree-sitter-language-pack"
  $Token = [System.Guid]::NewGuid().ToString("N")
  $StagedBinary = Join-Path $InstallDir ".shp.exe.update-$Token"
  $StagedParserAssets = Join-Path $InstallDir ".tree-sitter-language-pack.update-$Token"
  $PreviousBinary = Join-Path $InstallDir ".shp.exe.previous-$Token"
  $PreviousParserAssets = Join-Path $InstallDir ".tree-sitter-language-pack.previous-$Token"
  $InstallCommitted = $false
  $FinalSwapStarted = $false
  try {
    Remove-Item -Force $StagedBinary, $PreviousBinary -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force $StagedParserAssets, $PreviousParserAssets -ErrorAction SilentlyContinue
    Copy-Item -Force (Join-Path $TempDir "shp.exe") $StagedBinary
    Copy-Item -Recurse -Force $ParserAssets $StagedParserAssets

    $FinalSwapStarted = $true
    if (Test-Path -LiteralPath $TargetBinary) {
      Move-Item -Force $TargetBinary $PreviousBinary
    }
    if (Test-Path -LiteralPath $InstallParserAssets) {
      Move-Item -Force $InstallParserAssets $PreviousParserAssets
    }
    Move-Item -Force $StagedParserAssets $InstallParserAssets
    Move-Item -Force $StagedBinary $TargetBinary
    $InstallCommitted = $true
  } finally {
    Remove-Item -Force $StagedBinary -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force $StagedParserAssets -ErrorAction SilentlyContinue
    if ($InstallCommitted) {
      Remove-Item -Force $PreviousBinary -ErrorAction SilentlyContinue
      Remove-Item -Recurse -Force $PreviousParserAssets -ErrorAction SilentlyContinue
    } elseif ($FinalSwapStarted) {
      Remove-Item -Force $TargetBinary -ErrorAction SilentlyContinue
      Remove-Item -Recurse -Force $InstallParserAssets -ErrorAction SilentlyContinue
      if (Test-Path -LiteralPath $PreviousBinary) {
        Move-Item -Force $PreviousBinary $TargetBinary
      }
      if (Test-Path -LiteralPath $PreviousParserAssets) {
        Move-Item -Force $PreviousParserAssets $InstallParserAssets
      }
    }
  }

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
