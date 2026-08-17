@echo off
rem FallVault 一键启动（自动选最新构建版本）
if exist "%~dp0src-tauri\target\release\fallvault.exe" (
  start "" "%~dp0src-tauri\target\release\fallvault.exe"
) else (
  echo [错误] 未找到编译好的程序，请先运行: npx tauri build
  pause
)
