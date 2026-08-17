import os, sys, shutil, time
from playwright.sync_api import sync_playwright

OUT = r"D:\Aopenclaw\FallVault\assets\screenshots"
os.makedirs(OUT, exist_ok=True)
PROFILE = r"D:\Aopenclaw\FallVault\assets\edge-profile-shot"
if os.path.exists(PROFILE):
    shutil.rmtree(PROFILE)

with sync_playwright() as p:
    context = p.chromium.launch_persistent_context(
        user_data_dir=PROFILE,
        channel="msedge",
        headless=False,
        ignore_default_args=["--enable-automation", "--disable-blink-features=AutomationControlled"],
        args=["--disable-blink-features=AutomationControlled", "--no-first-run",
              "--no-default-browser-check", "--disable-sync"],
        viewport={"width": 1280, "height": 800},
        locale="zh-CN",
        timezone_id="Asia/Shanghai",
    )
    page = context.new_page()
    page.goto("http://localhost:5174/", wait_until="load", timeout=30000)
    time.sleep(8)  # 等 WebGL 背景 + 动画

    # 主界面
    page.screenshot(path=os.path.join(OUT, "01-main.png"))
    print("01-main done")

    # 设置面板 - 侧边栏底部"设置"
    try:
        page.click("text=设置")
        time.sleep(2)
        page.screenshot(path=os.path.join(OUT, "02-settings.png"))
        print("02-settings done")
        page.keyboard.press("Escape")
        time.sleep(1)
    except Exception as e:
        print("settings skip:", e)

    # 新建账号弹窗 - rune-btn-primary
    try:
        page.click("button.rune-btn-primary")
        time.sleep(2)
        page.screenshot(path=os.path.join(OUT, "03-new-entry.png"))
        print("03-new-entry done")
        page.keyboard.press("Escape")
        time.sleep(1)
    except Exception as e:
        print("new-entry skip:", e)

    # 密码生成器
    try:
        page.click("text=密码生成器")
        time.sleep(1.5)
        page.screenshot(path=os.path.join(OUT, "04-password-gen.png"))
        print("04-password-gen done")
    except Exception as e:
        print("pwd-gen skip:", e)

    time.sleep(1)
    context.close()
print("ALL DONE")
