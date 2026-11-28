@echo off
chcp 65001 >nul
title Eldorado Bot - Yerel kopyayi kaldir
cd /d "%~dp0"
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Eldorado Bot.lnk" >nul 2>&1
call "%~dp0durdur.bat"
echo.
echo Yerel bot durduruldu ve otomatik baslangic kaldirildi.
echo Artik botu yalnizca Render.com uzerinden calistir.
ping -n 4 127.0.0.1 >nul
