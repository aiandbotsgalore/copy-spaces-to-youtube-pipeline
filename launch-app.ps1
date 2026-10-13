# SpacePipe Studio App Launcher
$ErrorActionPreference = 'SilentlyContinue'
$projectDir = "C:\Users\Logan\copy-spaces-to-youtube-pipeline"
$url = "http://127.0.0.1:5000"

function Test-ServerReady {
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $tcp.Connect("127.0.0.1", 5000)
        $tcp.Close()
        return $true
    } catch {
        return $false
    }
}

# 1. If server is not running, start it in the background
if (-not (Test-ServerReady)) {
    Start-Process -FilePath "cmd.exe" `
        -ArgumentList "/c npm run dev" `
        -WorkingDirectory $projectDir `
        -WindowStyle Hidden

    $timeout = 15
    $elapsed = 0
    while (-not (Test-ServerReady) -and ($elapsed -lt $timeout)) {
        Start-Sleep -Milliseconds 300
        $elapsed += 0.3
    }
}

# 2. Launch in dedicated app window mode
$chromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
$edgePath64 = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"

if (Test-Path $chromePath) {
    Start-Process $chromePath -ArgumentList "--app=$url"
} elseif (Test-Path $edgePath) {
    Start-Process $edgePath -ArgumentList "--app=$url"
} elseif (Test-Path $edgePath64) {
    Start-Process $edgePath64 -ArgumentList "--app=$url"
} else {
    Start-Process $url
}
