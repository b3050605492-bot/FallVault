import { useEffect } from 'react';
import { initDatabase } from '@/lib/db';
import { useAppStore } from '@/stores/appStore';

export function useDatabase() {
  const refreshAll = useAppStore((s) => s.refreshAll);
  const selectedFolderId = useAppStore((s) => s.selectedFolderId);
  const selectedTagId = useAppStore((s) => s.selectedTagId);
  const searchQuery = useAppStore((s) => s.searchQuery);

  useEffect(() => {
    let mounted = true;
    async function init() {
      await initDatabase();
      if (mounted) {
        await refreshAll();
      }
    }
    init();
    return () => { mounted = false; };
  }, [refreshAll]);

  // 分类/标签/搜索变化时自动刷新列表
  useEffect(() => {
    refreshAll();
  }, [selectedFolderId, selectedTagId, searchQuery, refreshAll]);
}