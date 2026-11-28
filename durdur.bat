@echo off
chcp 65001 >nul
title Eldorado Bot - Durdur
cd /d "%~dp0"
echo durdur > "data\stop.flag"
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort 7788 -State Listen -ErrorAction SilentlyContinue; if ($c) { Stop-Process -Id $c.OwningProcess -Force }"
ping -n 5 127.0.0.1 >nul
del /q "data\stop.flag" >nul 2>&1
echo.
echo Bot durduruldu.
ping -n 3 127.0.0.1 >nul
