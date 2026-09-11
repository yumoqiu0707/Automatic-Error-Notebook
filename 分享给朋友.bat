@echo off
REM ---------------------------------------------------------------
REM  Cuotiji Assistant - Share to a friend
REM  Double-click this file to get a public HTTPS link.
REM  Keep this window OPEN while your friend is using it.
REM  NOTE: this file must stay pure ASCII (cmd.exe reads it as GBK)
REM ---------------------------------------------------------------
setlocal
cd /d "%~dp0"
title Cuotiji Assistant - Sharing

set "NODE_EXE="
where node >nul 2>nul
if not errorlevel 1 set "NODE_EXE=node"

if not defined NODE_EXE if exist "D:\Program Files\node.exe" set "NODE_EXE=D:\Program Files\node.exe"
if not defined NODE_EXE if exist "C:\Program Files\nodejs\node.exe" set "NODE_EXE=C:\Program Files\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"

if not defined NODE_EXE goto nonode

echo.
"%NODE_EXE%" share.js
echo.
echo  Sharing stopped.
pause
goto :eof

:nonode
echo.
echo   [ERROR] Node.js was not found on this computer.
echo.
echo   Install it from https://nodejs.org  (pick the LTS version),
echo   then double-click this file again.
echo.
pause
