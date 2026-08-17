# FallVault 🍂🔐

> 一款现代化的本地密码管理器，守护你的秘密钥匙。

![License](https://img.shields.io/badge/License-MIT-blue.svg)
![Tauri](https://img.shields.io/badge/Built%20with-Tauri-FFC131?logo=tauri)
![React](https://img.shields.io/badge/Frontend-React-61DAFB?logo=react)
![Platform](https://img.shields.io/badge/Platform-Windows-0078D6)

## ✨ 功能特性

- 🎨 **毛玻璃 UI** - 三套主题（黑白 / 二次元少女 / 二次元蓝）+ 毛玻璃透明度调节
- 🌊 **动态背景** - 线条波浪 / 粒子星空 / 自定义图片 / **视频壁纸**（支持导入 Wallpaper Engine 壁纸文件夹）
- 📁 **文件夹分类** - 游戏、银行、社交等分类管理，支持增删改
- 🏷️ **标签系统** - 多维度打标签，快速筛选
- ⭐ **收藏置顶** - 常用账号一键置顶
- 🔍 **全局搜索** - 实时搜索标题、账号、网站
- 🔒 **密码强度检测** - 集成 zxcvbn，预估破解时间
- ⚡ **密码生成器** - 自定义规则生成强密码
- 📜 **密码历史** - 自动保存旧密码，支持回溯
- 📤 **导出功能** - 一键导出账号为 Excel (.xlsx) / 文本 (.txt)，格式整洁规范
- 🖼️ **网站图标自动获取** - 输入网址自动识别 logo，或上传自定义图标
- 🌐 **多语言** - 中文 / English 实时切换
- 💾 **SQLite 本地存储** - 单文件数据库，零服务器依赖
- 📂 **数据目录自定义** - 图标/背景统一存放，可自定义路径方便备份

## 📸 界面预览

| 主界面 | 设置面板 |
|--------|----------|
| 待补充 | 待补充 |

## 🚀 快速开始

### 环境要求
- Node.js 18+
- Rust 1.70+

### 开发运行
```bash
# 1. 克隆仓库
git clone https://github.com/Fall/FallVault.git
cd FallVault

# 2. 安装前端依赖
npm install

# 3. 启动开发服务器
npm run tauri dev
```

### 构建安装包
```bash
npm run tauri build
```
构建完成后，安装包位于 `src-tauri/target/release/bundle/`

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | [Tauri 2.0](https://tauri.app/) |
| 前端 | React 18 + TypeScript + Tailwind CSS |
| 状态管理 | Zustand |
| 数据库 | SQLite (tauri-plugin-sql) |
| 密码强度 | zxcvbn |
| 表格导出 | ExcelJS |
| 图标 | Lucide React |

## 📂 数据存储

所有数据存储在本地：

- **数据库**：`fallvault.db`（应用数据目录）
- **媒体文件**：统一存放在数据文件夹（默认 `AppData/media/`）：
  - `icons/` - 账号自定义图标
  - `backgrounds/` - 自定义背景（图片/视频）
- 可在 **设置 → 数据文件夹** 中自定义存放路径

## 🔐 安全说明

**已启用主密码 + AES-256-GCM 加密**：
- 敏感字段（密码 / 用户名 / 备注 / 密码历史）**AES-256-GCM 加密存储**
- 主密码通过 **PBKDF2（15 万次迭代）** 派生密钥，密钥仅在内存中持有
- **主密码无法找回**：忘记主密码 = 数据永久丢失，请务必妥善保管
- 标题 / 网站保留明文以支持快速搜索
- 数据仍只存本地，不上传任何服务器

## 🗺️ 路线图

- [x] 基础 CRUD（增删改查）
- [x] 文件夹 & 标签
- [x] 收藏 & 搜索
- [x] 密码生成器 & 强度检测
- [x] 密码历史记录
- [x] 毛玻璃 & 三套主题
- [x] 动态背景（线浪/粒子/视频壁纸）
- [x] 多语言切换
- [x] 数据导出（xlsx/txt）
- [x] 数据目录自定义
- [x] 主密码 + AES-256-GCM 加密
- [ ] 自动锁定 & 剪贴板清理
- [ ] TOTP 验证码支持

## 📄 开源协议

MIT License © 2026 Fall

---

Made with 💖 by Fall
