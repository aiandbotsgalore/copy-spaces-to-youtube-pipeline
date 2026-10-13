Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "pwsh.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\Users\Logan\copy-spaces-to-youtube-pipeline\launch-app.ps1""", 0, False
