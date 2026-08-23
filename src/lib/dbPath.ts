import { invoke } from '@tauri-apps/api/core';

// 数据库路径解析：
// - 普通安装版（如 C:\软件\密码管理器\FallVault\）：沿用 Tauri 默认 AppData 目录（com.fall.fallvault）
// - 调试/测试构建（exe 在 target\release 或 target\debug 下）：改为便携模式，数据库存 exe 同级 data\，
//   与日常版完全隔离，避免测试数据污染正式保险库
let cache: string | null = null;

function isTestBuild(exeDir: string): boolean {
  // 匹配 ...\target\release 或 ...\target\debug（末尾带不带斜杠都算）
  return /[\\/]target[\\/](release|debug)[\\/]?$/i.test(exeDir) || /[\\/]target[\\/](release|debug)$/i.test(exeDir);
}

export async function getDbPath(): Promise<string> {
  if (cache) return cache;
  const exeDir = (await invoke<string>('get_exe_dir')).replace(/[\\/]+$/, '');
  if (isTestBuild(exeDir)) {
    const dir = `${exeDir}/data`;
    await invoke('create_dir_all', { path: dir });
    cache = `sqlite:${dir}/fallvault.db`;
  } else {
    cache = 'sqlite:fallvault.db'; // Tauri 默认 AppData
  }
  return cache;
}
