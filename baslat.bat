@echo off
chcp 65001 >nul
title Eldorado Telegram Bot
cd /d "%~dp0"
echo Eldorado Telegram botu baslatiliyor...
echo Kapatmak icin bu pencereyi kapat veya Ctrl+C bas.
echo.
node src\index.js
echo.
echo Bot durdu. Cikmak icin bir tusa bas.
pause >nul
