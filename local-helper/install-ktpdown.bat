@echo off
setlocal
cd /d "%~dp0"

set "HELPER=%~dp0ktp-local-helper.exe"

echo Installing Ketangpai local helper...
echo.

if not exist "%HELPER%" (
  echo ERROR: ktp-local-helper.exe was not found.
  echo Please unzip ktp-local-helper.zip first, then run install-ktpdown.bat from the extracted folder.
  echo.
  pause
  exit /b 1
)

reg add "HKCU\Software\Classes\ktpdown" /ve /d "URL:Ketangpai Downloader" /f
if errorlevel 1 goto fail
reg add "HKCU\Software\Classes\ktpdown" /v "URL Protocol" /d "" /f
if errorlevel 1 goto fail
reg add "HKCU\Software\Classes\ktpdown\DefaultIcon" /ve /d "%HELPER%,0" /f
if errorlevel 1 goto fail
reg add "HKCU\Software\Classes\ktpdown\shell\open\command" /ve /d "\"%HELPER%\" \"%%1\"" /f
if errorlevel 1 goto fail

echo.
echo Installed successfully.
echo You can now return to the website and click Ketangpai Download.
echo.
pause
exit /b 0

:fail
echo.
echo ERROR: Installation failed.
echo Please right-click install-ktpdown.bat and choose Run as administrator, then try again.
echo.
pause
exit /b 1
