@echo off
chcp 65001 >nul
title FallVault 壁纸录制工具

echo =============================================
echo   FallVault 壁纸录制工具
echo =============================================
echo.
echo 使用说明：
echo   1. 先在 Wallpaper Engine 里把想要的壁纸设为当前壁纸（桌面显示）
echo   2. 关闭/最小化其他窗口，让桌面壁纸完全露出来
echo   3. 按任意键开始录制，30 秒后自动停止
echo.
pause

echo.
echo 3 秒后开始录制...
timeout /t 3 /nobreak >nul

set "outname=wallpaper_%date:~0,4%%date:~5,2%%date:~8,2%_%time:~0,2%%time:~3,2%%time:~6,2%.mp4"

echo.
echo 正在录制中... 30 秒后自动停止
ffmpeg -y -f gdigrab -framerate 30 -i desktop -t 30 ^
  -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p ^
  "%outname%" 2>nul

if exist "%outname%" (
  echo.
  echo 录制完成！
  echo 文件: %CD%\%outname%
  echo 打开 FallVault → 设置 → 背景 → 自定义 → 上传视频 即可使用
) else (
  echo.
  echo 录制失败：请确认 ffmpeg 已安装并在 PATH 中
)
echo.
pause
