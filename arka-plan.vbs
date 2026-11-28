' Eldorado Telegram botunu arka planda (gorunmez pencere) calistirir.
' Beklenmedik sekilde kapanirsa 15 saniye sonra yeniden baslatir.
' Durdurmak icin durdur.bat dosyasina cift tikla.

Option Explicit

Dim fso, sh, dir, stopFlag
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
stopFlag = dir & "\data\stop.flag"

' Baska bir kopya zaten calisiyorsa ikinci kez baslatma.
If PortBusy(7788) Then WScript.Quit 0

Do
  sh.Run "cmd /c node src\index.js", 0, True
  If fso.FileExists(stopFlag) Then Exit Do
  If PortBusy(7788) Then Exit Do
  WScript.Sleep 15000
Loop

' Kilit portu dinleniyor mu? (bot zaten calisiyor demektir)
Function PortBusy(port)
  PortBusy = (sh.Run("cmd /c netstat -ano | findstr /C:"":" & port & " """, 0, True) = 0)
End Function
