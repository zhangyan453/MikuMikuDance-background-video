@echo off
rem ============================================================
rem MMDBG 一键打包发布脚本
rem 生成干净的 zip 分发包（剔除隐私/运行时文件），双击运行即可
rem ============================================================
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "STAGE=%TEMP%\mmdbg-pack-stage"
set "OUT=MMDBG-v1.0-release.zip"

echo [1/4] 清理旧的打包目录和产物...
if exist "%STAGE%" rmdir /s /q "%STAGE%"
if exist "%OUT%" del /q "%OUT%"
mkdir "%STAGE%"

echo [2/4] 复制项目文件（剔除隐私和运行时产物）...
rem 核心代码和资源
xcopy /e /i /q "server.mjs" "%STAGE%\" >nul
xcopy /e /i /q "public" "%STAGE%\public\" >nul
xcopy /e /i /q "docs" "%STAGE%\docs\" >nul
xcopy /e /i /q "licenses" "%STAGE%\licenses\" >nul
xcopy /e /i /q "runtime" "%STAGE%\runtime\" >nul
rem 根目录文档和启动脚本
copy /y "README.md" "%STAGE%\" >nul
copy /y "README_EN.md" "%STAGE%\" >nul
copy /y "LICENSE" "%STAGE%\" >nul
copy /y "THIRD-PARTY-NOTICES.md" "%STAGE%\" >nul
copy /y "启动工具.bat" "%STAGE%\" >nul

rem 确保没有把隐私/临时文件带进去（config 含本机 MMD 路径，port.txt 是运行产物）
if exist "%STAGE%\mmdbg-config.json" del /q "%STAGE%\mmdbg-config.json"
if exist "%STAGE%\port.txt" del /q "%STAGE%\port.txt"

echo [3/4] 正在压缩（这可能需要一两分钟）...
powershell -NoProfile -Command "Compress-Archive -Path '%STAGE%\*' -DestinationPath '%OUT%' -CompressionLevel Optimal" || goto :fail

echo [4/4] 清理临时目录...
rmdir /s /q "%STAGE%"

echo.
echo ============================================
echo 打包完成！文件位于: %CD%\%OUT%
for %%A in ("%OUT%") do echo 文件大小: %%~zA bytes
echo 请上传到 GitHub Release 作为附件。
echo ============================================
pause
exit /b 0

:fail
echo.
echo [错误] 打包失败，请检查上方提示。
pause
exit /b 1
