import { openUrl } from '@tauri-apps/plugin-opener';

export async function openExternalWebsite(website: string): Promise<void> {
  const raw = website.trim();
  if (!raw) throw new Error('empty website');

  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = new URL(candidate);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('unsupported website protocol');
  }

  await openUrl(url.toString());
}
