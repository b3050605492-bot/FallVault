import { useAppStore } from '@/stores/appStore';
import { EntryCard } from './EntryCard';
import { Lock, Loader2 } from 'lucide-react';

export function EntryList() {
  const { entries, isLoading, searchQuery, selectedFolderId, favorites, selectedTagId } = useAppStore();

  const displayEntries = selectedFolderId === -1 ? favorites : entries;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Loader2 className="animate-spin" size={32} style={{ color: 'var(--mint)' }} />
        <span className="text-sm text-[var(--moon-faint)]">加载中...</span>
      </div>
    );
  }

  if (displayEntries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-[var(--moon-faint)]" style={{ opacity: 0.6 }}>
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-5"
          style={{ background: 'rgba(192, 200, 216, 0.06)' }}>
          <Lock size={32} style={{ color: 'var(--moon-faint)' }} />
        </div>
        <p className="text-base font-medium text-[var(--moon-dim)]">
          {searchQuery ? '没有找到匹配的账号' : '还没有保存任何账号'}
        </p>
        <p className="text-sm mt-2 text-[var(--moon-faint)]">
          {searchQuery ? '换个关键词试试看~' : '点击右上角 "+" 开始添加吧'}
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pb-20">
      {displayEntries.map((entry, i) => (
        <div key={entry.id} className="fade-up" style={{ animationDelay: `${i * 0.05}s`, animationFillMode: 'both' }}>
          <EntryCard entry={entry} index={i} />
        </div>
      ))}
    </div>
  );
}
