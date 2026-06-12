$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "`n=== Avent Setup ===" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js not found. Install from https://nodejs.org" -ForegroundColor Red
    exit 1
}

Write-Host "Node: $(node -v) | npm: $(npm -v)"

if (-not (Test-Path "node_modules")) {
    Write-Host "`nInstalling dependencies..." -ForegroundColor Yellow
    npm install
}

Write-Host "`nFixing Expo package versions..." -ForegroundColor Yellow
npx expo install @react-native-async-storage/async-storage expo expo-router expo-splash-screen

$envFile = Join-Path $root ".env"
$exampleFile = Join-Path $root ".env.example"

if (-not (Test-Path $envFile)) {
    Copy-Item $exampleFile $envFile
    Write-Host "Created .env from .env.example" -ForegroundColor Green
}

function Read-EnvValue {
    param([string]$Name, [string]$Prompt, [switch]$Secret)
    $current = (Get-Content $envFile | Where-Object { $_ -match "^$Name=(.*)$" } | ForEach-Object {
        if ($_ -match "^$Name=(.*)$") { $matches[1] }
    } | Select-Object -First 1)

    if ($current -and $current -notmatch '^(REPLACE_|your_|)$') {
        return $current
    }

    if ($Secret) {
        $value = Read-Host $Prompt
    } else {
        $value = Read-Host $Prompt
    }
    return $value
}

Write-Host "`n--- API Keys (press Enter to skip any field) ---" -ForegroundColor Cyan
Write-Host "Skip all if you only want to preview UI. Full features need all keys.`n"

$vars = @(
    @{ Name = "EXPO_PUBLIC_FIREBASE_API_KEY"; Prompt = "Firebase API Key" },
    @{ Name = "EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN"; Prompt = "Firebase Auth Domain (e.g. myapp.firebaseapp.com)" },
    @{ Name = "EXPO_PUBLIC_FIREBASE_PROJECT_ID"; Prompt = "Firebase Project ID" },
    @{ Name = "EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET"; Prompt = "Firebase Storage Bucket" },
    @{ Name = "EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID"; Prompt = "Firebase Messaging Sender ID" },
    @{ Name = "EXPO_PUBLIC_FIREBASE_APP_ID"; Prompt = "Firebase App ID" },
    @{ Name = "EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID"; Prompt = "Firebase Measurement ID (optional)" },
    @{ Name = "EXPO_PUBLIC_GEMINI_API_KEY"; Prompt = "Gemini API Key" },
    @{ Name = "EXPO_PUBLIC_GOOGLE_MAP_KEY"; Prompt = "Google Maps API Key" }
)

$lines = Get-Content $envFile
foreach ($var in $vars) {
    $input = Read-EnvValue -Name $var.Name -Prompt $var.Prompt
    if ($input) {
        $pattern = "^$($var.Name)=.*$"
        $replacement = "$($var.Name)=$input"
        $found = $false
        $lines = $lines | ForEach-Object {
            if ($_ -match $pattern) {
                $found = $true
                $replacement
            } else {
                $_
            }
        }
        if (-not $found) {
            $lines += $replacement
        }
    }
}
$lines | Set-Content $envFile -Encoding utf8

Write-Host "`nSetup complete. Starting Expo on http://localhost:8082 ..." -ForegroundColor Green
Write-Host "Press w for web | Scan QR with Expo Go on phone`n"
npx expo start --port 8082
