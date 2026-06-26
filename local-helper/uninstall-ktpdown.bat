@echo off
reg delete "HKCU\Software\Classes\ktpdown" /f >nul 2>nul
echo 已卸载课堂派本地下载助手协议。
pause
