# Build an APK without Gradle: aapt2 + javac + d8 + zipalign + apksigner
# Usage (from deepseek-app): powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-apk.ps1
# NOTE: keep this file ASCII-only. Windows PowerShell 5.1 reads .ps1 as ANSI and chokes on UTF-8.

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

$tc = (Resolve-Path '.\.toolchain').Path
$jdk = Join-Path $tc 'jdk'
$bt = Join-Path $tc 'sdk\build-tools\35.0.0'
$androidJar = Join-Path $tc 'sdk\platforms\android-35\android.jar'

if (-not (Test-Path $androidJar)) { throw 'android.jar missing; run: node scripts/fetch-toolchain.mjs' }

$env:JAVA_HOME = $jdk
$env:PATH = "$jdk\bin;$bt;$env:PATH"

$build = Join-Path (Get-Location) 'build-android'
$android = Join-Path (Get-Location) 'android'
$outDir = Join-Path (Get-Location) 'release'

if (Test-Path $build) { Remove-Item -Recurse -Force $build }
New-Item -ItemType Directory -Force -Path $build, $outDir | Out-Null

Write-Host '[1/7] stage web assets'
if (-not (Test-Path '.\dist\index.html')) { throw 'dist missing; run rspack build first' }
$androidAssets = Join-Path $android 'assets'
if (Test-Path $androidAssets) { Remove-Item -Recurse -Force $androidAssets }
$assetsWww = Join-Path $androidAssets 'www'
New-Item -ItemType Directory -Force -Path $assetsWww | Out-Null
Copy-Item -Recurse -Force '.\dist\*' $assetsWww
$fileCount = (Get-ChildItem -Recurse -File $assetsWww).Count
Write-Host "      $fileCount files"

Write-Host '[2/7] aapt2 compile'
$resZip = Join-Path $build 'res.zip'
& aapt2 compile --dir (Join-Path $android 'res') -o $resZip
if ($LASTEXITCODE -ne 0) { throw 'aapt2 compile failed' }

Write-Host '[3/7] aapt2 link'
$baseApk = Join-Path $build 'base.apk'
# NOTE: intentionally no -A flag. On Windows aapt2 writes asset entry names with
# backslashes (assets/www\index.html), which AssetManager cannot resolve. Static
# assets are added by scripts/pack-apk.mjs using forward slashes instead.
& aapt2 link -o $baseApk `
    -I $androidJar `
    --manifest (Join-Path $android 'AndroidManifest.xml') `
    --min-sdk-version 24 `
    --target-sdk-version 35 `
    --version-code 14 `
    --version-name '0.2.3' `
    $resZip
if ($LASTEXITCODE -ne 0) { throw 'aapt2 link failed' }

Write-Host '[4/7] javac'
$classes = Join-Path $build 'classes'
New-Item -ItemType Directory -Force -Path $classes | Out-Null
$javaFiles = Get-ChildItem -Recurse -File -Filter *.java (Join-Path $android 'java') | ForEach-Object { $_.FullName }
& javac -nowarn -Xlint:-options -source 8 -target 8 -classpath $androidJar -d $classes $javaFiles
if ($LASTEXITCODE -ne 0) { throw 'javac failed' }

Write-Host '[5/7] d8'
$dexDir = Join-Path $build 'dex'
New-Item -ItemType Directory -Force -Path $dexDir | Out-Null
$classFiles = Get-ChildItem -Recurse -File -Filter *.class $classes | ForEach-Object { $_.FullName }
& d8 --lib $androidJar --min-api 24 --output $dexDir @classFiles
if ($LASTEXITCODE -ne 0) { throw 'd8 failed' }

Write-Host '[6/7] package + sign'
$unsigned = Join-Path $build 'unsigned.apk'
& node 'scripts\pack-apk.mjs' $baseApk (Join-Path $dexDir 'classes.dex') $unsigned (Join-Path (Get-Location) 'dist')
if ($LASTEXITCODE -ne 0) { throw 'pack failed' }

$aligned = Join-Path $build 'aligned.apk'
& zipalign -p -f 4 $unsigned $aligned
if ($LASTEXITCODE -ne 0) { throw 'zipalign failed' }

# Self-use signing key. MUST live outside build-android: that directory is wiped on
# every build, and a fresh key means newer APKs can no longer update older installs
# (INSTALL_FAILED_UPDATE_INCOMPATIBLE / -7). Fixed password, do not reuse elsewhere.
$keystoreDir = Join-Path $android 'keystore'
New-Item -ItemType Directory -Force -Path $keystoreDir | Out-Null
$keystore = Join-Path $keystoreDir 'self.keystore'
if (-not (Test-Path $keystore)) {
    & keytool -genkeypair -v -keystore $keystore -alias app `
        -keyalg RSA -keysize 2048 -validity 10000 `
        -storepass android -keypass android `
        -dname 'CN=DeepSeek Local, O=Local, C=CN' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'keytool failed' }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
$final = Join-Path $outDir "deepseek-$stamp.apk"
& apksigner sign --ks $keystore --ks-key-alias app `
    --ks-pass pass:android --key-pass pass:android `
    --out $final $aligned
if ($LASTEXITCODE -ne 0) { throw 'apksigner sign failed' }

Write-Host '[7/7] verify'
& apksigner verify --verbose $final
if ($LASTEXITCODE -ne 0) { throw 'signature verification failed' }

$size = [math]::Round((Get-Item $final).Length / 1MB, 2)
Write-Host ''
Write-Host "OK: $final ($size MB)"












