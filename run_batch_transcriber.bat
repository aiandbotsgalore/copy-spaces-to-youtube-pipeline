@echo off
setlocal
cd /d %~dp0

set PYTHON_EXE=C:\Users\Logan\AppData\Local\Programs\Python\Python312\python.exe

echo ========================================================
echo   SpacePipe GPU Batch Transcriber & Speaker Diarizer
echo ========================================================
echo.

if "%~1"=="" (
    echo Usage:
    echo   run_batch_transcriber.bat --url ^<GITHUB_OR_AUDIO_URL^>
    echo   run_batch_transcriber.bat --repo ^<OWNER/REPO^>
    echo   run_batch_transcriber.bat --file ^<LOCAL_AUDIO_PATH^>
    echo   run_batch_transcriber.bat --list ^<URLS_FILE.txt^>
    echo.
    echo Running interactive prompt...
    set /p USER_INPUT="Enter audio URL, GitHub Repo (owner/repo), or local file path: "
    if not "%USER_INPUT%"=="" (
        if exist "%USER_INPUT%" (
            "%PYTHON_EXE%" batch_transcriber.py --file "%USER_INPUT%"
        ) else if "%USER_INPUT:~0,4%"=="http" (
            "%PYTHON_EXE%" batch_transcriber.py --url "%USER_INPUT%"
        ) else (
            "%PYTHON_EXE%" batch_transcriber.py --repo "%USER_INPUT%"
        )
    ) else (
        "%PYTHON_EXE%" batch_transcriber.py --help
    )
) else (
    "%PYTHON_EXE%" batch_transcriber.py %*
)

echo.
pause
