@echo off
chcp 65001 > nul
title Daily Collector Bot
color 0A
cls
echo ========================================================
echo           Daily Product Collector Bot 🚀
echo ========================================================
echo.
echo [1/2] Moving to project directory...
cd /d "c:\Users\User\.gemini\antigravity\playground\primal-equinox"

echo [2/2] Running Python script...
echo.
"C:\Users\User\AppData\Local\Programs\Python\Python312\python.exe" daily_collector.py

echo.
echo ========================================================
echo                 Work Finished! (Check Admin Page)
echo ========================================================
pause
