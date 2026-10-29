@echo off
chcp 65001 >nul
setlocal
title 雨课堂自动阅读 - 一键安装

cd /d "%~dp0"

set "USFILE="
for %%f in ("*.user.js") do if not defined USFILE set "USFILE=%%~ff"
if not defined USFILE (
    echo [错误] 当前文件夹里没有 .user.js 文件。
    echo 请确认脚本和本安装器在同一个文件夹。
    pause
    exit /b 1
)

set "SERVE_DIR=%TEMP%\yuketang-userscript-install"
if not exist "%SERVE_DIR%" mkdir "%SERVE_DIR%" >nul 2>&1
copy /y "%USFILE%" "%SERVE_DIR%\auto-read.user.js" >nul

echo.
echo 正在启动临时安装服务...
python -X utf8 -c "import http.server,os,sys,threading,webbrowser,msvcrt,functools;d=sys.argv[1] if len(sys.argv)>1 else os.getcwd();http.server.SimpleHTTPRequestHandler.log_message=lambda *a,**k:None;h=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(http.server.SimpleHTTPRequestHandler,directory=d));url='http://127.0.0.1:'+str(h.server_address[1])+'/auto-read.user.js';threading.Thread(target=h.serve_forever,daemon=True).start();print('安装页：'+url,flush=True);print('浏览器已打开，请在 Tampermonkey 中确认安装。',flush=True);print('安装完成后按任意键，立即停止服务并关闭窗口。',flush=True);webbrowser.open(url);msvcrt.getch();os._exit(0)" "%SERVE_DIR%"
if errorlevel 1 (
    echo.
    echo [错误] 临时安装服务未能启动。
    echo 请确认已安装 Python；或改用 Tampermonkey 管理面板 - 实用工具 - 从文件导入。
    pause
)

del /q "%SERVE_DIR%\auto-read.user.js" >nul 2>&1
rmdir "%SERVE_DIR%" >nul 2>&1
exit /b 0
