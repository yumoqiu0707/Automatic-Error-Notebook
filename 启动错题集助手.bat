@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Cuotiji Assistant

set "NODE_EXE="

where node >nul 2>nul
if not errorlevel 1 set "NODE_EXE=node"

if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE if exist "D:\Program Files\node.exe" set "NODE_EXE=D:\Program Files\node.exe"
if not defined NODE_EXE if exist "D:\Program Files\nodejs\node.exe" set "NODE_EXE=D:\Program Files\nodejs\node.exe"
if not defined NODE_EXE if exist "D:\nodejs\node.exe" set "NODE_EXE=D:\nodejs\node.exe"
if not defined NODE_EXE if exist "C:\nodejs\node.exe" set "NODE_EXE=C:\nodejs\node.exe"

if not defined NODE_EXE goto nonode

echo.
echo   Starting Cuotiji Assistant ...
echo.
echo   Keep this window OPEN while you use it.
echo   Closing this window stops the service (your data is already saved).
echo.

"%NODE_EXE%" server.js --open

echo.
echo   Service stopped. Your mistake book is saved in data\db.json
echo.
pause
exit /b 0

:nonode
echo.
echo   [ERROR] Node.js was not found on this computer.
echo.
echo   Please install Node.js 18 or newer from:
echo       https://nodejs.org
echo.
echo   After installing, close this window and run this file again.
echo.
pause
exit /b 1
