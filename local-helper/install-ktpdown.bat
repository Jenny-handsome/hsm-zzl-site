@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "HELPER=%~dp0ktp-local-helper.exe"

if not exist "%HELPER%" (
  echo 未找到 ktp-local-helper.exe。
  echo 请先完整解压 ktp-local-helper.zip，再运行本安装脚本。
  pause
  exit /b 1
)

reg add "HKCU\Software\Classes\ktpdown" /ve /d "URL:Ketangpai Downloader" /f >nul
reg add "HKCU\Software\Classes\ktpdown" /v "URL Protocol" /d "" /f >nul
reg add "HKCU\Software\Classes\ktpdown\DefaultIcon" /ve /d "%HELPER%,0" /f >nul
reg add "HKCU\Software\Classes\ktpdown\shell\open\command" /ve /d "\"%HELPER%\" \"%%1\"" /f >nul

echo 已安装课堂派本地下载助手。
echo 现在可以回到网站点击“课堂派下载”。
pause
