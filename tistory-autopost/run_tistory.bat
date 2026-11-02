@echo off
chcp 65001 > nul
title Tistory Auto Post
cd /d "%~dp0"
python tistory_poster.py %*
pause
