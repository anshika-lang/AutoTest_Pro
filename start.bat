@echo off
title AutoTest Pro - Autonomous Vehicle Simulator
cls
echo ======================================================================
echo   AUTOTEST PRO - Autonomous Vehicle Proving Ground Simulator
echo ======================================================================
echo.

:: 1. Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not found on your system!
    echo.
    echo To run this simulator, you just need Node.js installed once:
    echo 1. Download the free installer (LTS version) from:
    echo    https://nodejs.org/
    echo 2. Run the installer and click 'Next' until finished.
    echo 3. Double-click this 'start.bat' file again!
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js found:
node -v
echo.

:: 2. Check if dependencies are installed
if not exist "node_modules\" (
    echo [SETUP] First-time setup: Installing required libraries...
    echo (This usually takes about 15-20 seconds)
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install encountered an error. Please check your internet connection.
        pause
        exit /b 1
    )
    echo [OK] Installation complete!
    echo.
) else (
    echo [OK] Dependencies are ready.
    echo.
)

:: 3. Launch the Simulator and open the browser
echo [LAUNCH] Starting local simulator server...
echo [BROWSER] Opening http://localhost:5173/ in your browser...
echo.
echo ======================================================================
echo   Keep this window open while testing the simulator!
echo   Press Ctrl + C or close this window to stop the server.
echo ======================================================================
echo.

timeout /t 2 >nul
start http://localhost:5173/
call npm run dev
pause
