' Cuotiji Assistant - silent launcher
' Starts the local service in the background (no console window) and opens the browser.
' To stop it, run "stop.bat" (the file with a Chinese name starting with the stop character).
Option Explicit

Dim sh, fso, base, rc

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

base = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = base

' Check that Node.js is available
rc = sh.Run("cmd /c where node >nul 2>nul", 0, True)
If rc <> 0 Then
  If Not fso.FileExists("D:\Program Files\node.exe") Then
    MsgBox "Node.js was not found on this computer." & vbCrLf & vbCrLf & _
           "Please install Node.js 18 or newer from:" & vbCrLf & _
           "    https://nodejs.org" & vbCrLf & vbCrLf & _
           "After installing, run this file again.", _
           16, "Cuotiji Assistant"
    WScript.Quit 1
  End If
End If

' 0 = hidden window, False = do not wait
sh.Run "cmd /c chcp 65001 >nul & node server.js --open", 0, False
