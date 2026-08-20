// 统一的文件 IO 封装：走 Rust 命令（std::fs），确保能写入 exe 同级目录（数据文件夹）
// 避免 fs 插件作用域限制。
async function inv<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

export async function mkdirAll(path: string): Promise<void> {
  await inv('create_dir_all', { path });
}

export async function writeFileBytes(path: string, data: Uint8Array): Promise<void> {
  await inv('write_file_bytes', { path, data: Array.from(data) });
}

export async function readFileBytes(path: string): Promise<Uint8Array> {
  const arr: number[] = await inv('read_file_bytes', { path });
  return new Uint8Array(arr);
}

export async function copyFile(src: string, dst: string): Promise<void> {
  await inv('copy_file', { src, dst });
}

export async function removePath(path: string): Promise<void> {
  await inv('remove_file', { path });
}

export async function readTextFile(path: string): Promise<string> {
  return inv<string>('read_text_file', { path });
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  await inv('write_text_file', { path, contents: content });
}

export async function fileExists(path: string): Promise<boolean> {
  return inv<boolean>('file_exists', { path });
}

export async function listDir(path: string): Promise<string[]> {
  return inv<string[]>('list_dir_names', { path });
}
