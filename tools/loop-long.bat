@echo off
chcp 65001 >nul
rem ⏩ نسخة طويلة من مقطع Loop على ويندوز (محتاج ffmpeg: winget install ffmpeg)
rem الاستخدام: اسحب ملف المقطع على الملف ده، أو: loop-long.bat clip.mp4 120
if "%~1"=="" (echo اسحب ملف المقطع على الملف ده & pause & exit /b 1)
set MINS=%~2
if "%MINS%"=="" set MINS=60
set /a SECS=%MINS%*60
ffmpeg -hide_banner -loglevel error -stats -stream_loop -1 -i "%~1" -c copy -t %SECS% -movflags +faststart "%~dpn1_%MINS%min.mp4"
echo تم: "%~dpn1_%MINS%min.mp4"
pause
