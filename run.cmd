@echo off
rem Sushi Rain - start the local server and open it in the browser.
setlocal
cd /d "%~dp0"
where py >nul 2>nul && (set "PY=py -3") || (set "PY=python")
start "Sushi Rain server" %PY% server.py
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:8777/"
