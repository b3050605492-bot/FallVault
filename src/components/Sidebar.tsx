import { useState } from 'react';
import {
  Folder, Inbox, Star, Hash, ChevronRight, ChevronLeft,
  Plus, Settings, Lock, Gamepad2, MessageCircle, Landmark,
  Briefcase, Sparkles, Edit3, Trash2, Check
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useToastStore } from '@/stores/toastStore';
import { createFolder, updateFolder, deleteFolder, createTag, deleteTag } from '@/lib/db';
import { ShinyText } from '@/components/ShinyText';
import { StrokeText } from '@/components/StrokeText';
import { ClickSpark } from '@/components/ClickSpark';
import { GlareHover } from '@/components/GlareHover';

const iconMap: Record<string, React.ElementType> = {
  Folder, Inbox, Star, Lock, Gamepad2, MessageCircle, Landmark, Briefcase, Hash, Sparkles
};

export function Sidebar() {
  const {
    folders, tags, selectedFolderId, selectedTagId, favorites,
    isSidebarOpen, setIsSidebarOpen, setSelectedFolderId,
    setSelectedTagId, setSearchQuery, setIsSettingsOpen,
    setIsPasswordGeneratorOpen, refreshAll, setConfirmDialog
  } = useAppStore();
  const { addToast } = useToastStore();

  const [newFolderName, setNewFolderName] = useState('');
  const [isAddingFolder, setIsAddingFolder] = useState(false);
  const [editingFolder, setEditingFolder] = useState<number | null>(null);
  const [editFolderName, setEditFolderName] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState('#7DD3C0');
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<number | null>(null);

  const tagColors = ['#7DD3C0', '#9B8DB5', '#C0C8D8', '#D4B070', '#D47070', '#7DB8D3'];

  const handleAddFolder = async () => {
    if (!newFolderName.trim()) return;
    await createFolder(newFolderName.trim());
    setNewFolderName('');
    setIsAddingFolder(false);
    await refreshAll();
    addToast(`分类 "${newFolderName.trim()}" 已创建`, 'success');
  };

  const handleEditFolder = async (id: number) => {
    if (!editFolderName.trim()) return;
    const folder = folders.find(f => f.id === id);
    if (folder) {
      await updateFolder(id, editFolderName.trim(), folder.icon);
      setEditingFolder(null);
      setEditFolderName('');
      await refreshAll();
      addToast('分类已更新', 'success');
    }
  };

  const handleDeleteFolder = (id: number, name: string) => {
    setConfirmDialog({
      open: true,
      title: '删除分类',
      message: `确定要删除分类 "${name}" 吗？该分类下的账号将变为未分类。`,
      confirmText: '确认删除',
      cancelText: '取消',
      onConfirm: async () => {
        await deleteFolder(id);
        await refreshAll();
        addToast('分类已删除', 'success');
        setConfirmDialog({ open: false });
      },
      onCancel: () => setConfirmDialog({ open: false }),
    });
  };

  const handleAddTag = async () => {
    if (!newTagName.trim()) return;
    await createTag(newTagName.trim(), newTagColor);
    setNewTagName('');
    setIsAddingTag(false);
    await refreshAll();
    addToast(`标签 "${newTagName.trim()}" 已创建`, 'success');
  };

  const handleDeleteTag = (id: number, name: string) => {
    setConfirmDialog({
      open: true,
      title: '删除标签',
      message: `确定要删除标签 "${name}" 吗？`,
      confirmText: '确认删除',
      cancelText: '取消',
      onConfirm: async () => {
        await deleteTag(id);
        await refreshAll();
        addToast(`标签 "${name}" 已删除`, 'success');
        setConfirmDialog({ open: false });
      },
      onCancel: () => setConfirmDialog({ open: false }),
    });
  };

  // 收起状态
  if (!isSidebarOpen) {
    return (
      <GlareHover>
        <div
          className="h-full m-3 flex flex-col items-center py-4 gap-3"
          style={{
            width: '52px',
            background: 'var(--glass-bg)',
            border: '1px solid var(--glass-border)',
            borderRadius: '14px',
            backdropFilter: 'blur(var(--glass-blur)) saturate(var(--glass-saturate))',
            boxShadow: '0 0 0 1px rgba(210,210,220,0.03), 0 8px 32px rgba(0,0,0,0.3)',
            animation: 'sidebarCollapse 0.35s cubic-bezier(0.4, 0, 0.2, 1) forwards',
          }}
        >
          {/* Logo 小图标 — 已移除 */}

          <div className="w-6 h-px bg-[rgba(192,200,216,0.1)]" />

          {/* 展开按钮 - 中间位置 */}
          <ClickSpark sparkColor="#7DD3C0" sparkCount={6}>
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="w-10 h-10 rounded-xl flex items-center justify-center text-[var(--moon-dim)] hover:text-[var(--mint)] hover:bg-[rgba(210,210,220,0.1)] transition-all duration-300"
              title="展开侧边栏"
            >
              <ChevronRight size={20} />
            </button>
          </ClickSpark>

          <div className="w-6 h-px bg-[rgba(192,200,216,0.1)]" />

          {/* 常用快捷 */}
          <button
            onClick={() => { setSelectedFolderId(null); setSelectedTagId(null); setSearchQuery(''); }}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-[var(--moon-dim)] hover:text-[var(--mint)] hover:bg-[rgba(210,210,220,0.1)] transition-all"
            title="全部账号"
          >
            <Inbox size={16} />
          </button>
          <button
            onClick={() => setSelectedFolderId(-1)}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-[var(--moon-dim)] hover:text-[var(--mint)] hover:bg-[rgba(210,210,220,0.1)] transition-all"
            title="收藏夹"
          >
            <Star size={16} />
          </button>

          <div className="w-6 h-px bg-[rgba(192,200,216,0.1)] mt-auto" />

          <button
            onClick={() => setIsSettingsOpen(true)}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-[var(--moon-dim)] hover:text-[var(--mint)] hover:bg-[rgba(210,210,220,0.1)] transition-all mb-2"
            title="设置"
          >
            <Settings size={16} />
          </button>
        </div>
      </GlareHover>
    );
  }

  return (
    <aside
      className="h-full m-3 flex flex-col overflow-hidden"
      style={{
        width: '260px',
        background: 'var(--glass-bg)',
        border: '1px solid var(--glass-border)',
        borderRadius: '14px',
        backdropFilter: 'blur(var(--glass-blur)) saturate(var(--glass-saturate))',
        boxShadow: '0 0 0 1px rgba(210,210,220,0.03), 0 8px 32px rgba(0,0,0,0.3)',
        animation: 'sidebarExpand 0.35s cubic-bezier(0.4, 0, 0.2, 1) forwards',
      }}
    >
      {/* Logo 区域 */}
      <div className="p-4 pb-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <StrokeText
            text="FallVault"
            strokeColor="#7DD3C0"
            fontSize={24}
            duration={1.4}
            className="w-full"
          />
          <p className="text-[10px] text-[var(--moon-faint)] mt-0.5">守护你的秘密钥匙</p>
        </div>
        <ClickSpark sparkColor="#7DD3C0" sparkCount={6}>
          <button
            onClick={() => setIsSidebarOpen(false)}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--moon-faint)] hover:text-[var(--mint)] hover:bg-[rgba(210,210,220,0.1)] transition-all"
            title="收起"
          >
            <ChevronLeft size={16} />
          </button>
        </ClickSpark>
      </div>

      {/* 魔法阵装饰线 */}
      <div className="rune-line mx-4 mb-2" />

      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5 min-h-0">
        {/* 快速入口 */}
        <SidebarItem active={selectedFolderId === null && selectedTagId === null} onClick={() => { setSelectedFolderId(null); setSelectedTagId(null); setSearchQuery(''); }} icon={<Inbox size={16} />} label="全部账号" />
        <SidebarItem active={selectedFolderId === -1} onClick={() => setSelectedFolderId(-1)} icon={<Star size={16} />} label="收藏夹" badge={favorites.length || undefined} />

        {/* 分类 */}
        <div className="pt-3">
          <div className="flex items-center justify-between px-3 mb-1.5">
            <span className="text-[10px] text-[var(--moon-faint)] uppercase tracking-[0.2em] font-semibold">分类</span>
            <ClickSpark sparkColor="#7DD3C0" sparkCount={6}>
              <button onClick={() => setIsAddingFolder(!isAddingFolder)} className="w-5 h-5 rounded-md flex items-center justify-center text-[var(--moon-faint)] hover:text-[var(--mint)] hover:bg-[rgba(210,210,220,0.1)] transition-all">
                <Plus size={12} />
              </button>
            </ClickSpark>
          </div>

          {isAddingFolder && (
            <div className="px-3 py-2 space-y-2 mb-1">
              <input autoFocus value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddFolder()} placeholder="新分类名称..." className="rune-input w-full px-3 py-1.5 text-[13px]" />
              <div className="flex gap-2">
                <button onClick={handleAddFolder} className="rune-btn rune-btn-primary px-3 py-1 text-xs">确定</button>
                <button onClick={() => setIsAddingFolder(false)} className="rune-btn px-3 py-1 text-xs">取消</button>
              </div>
            </div>
          )}

          {folders.map(folder => {
            const Icon = iconMap[folder.icon] || Folder;
            const isEditing = editingFolder === folder.id;
            return (
              <div key={folder.id} className="relative group" onMouseEnter={() => setHoveredItem(folder.id)} onMouseLeave={() => setHoveredItem(null)}>
                {isEditing ? (
                  <div className="px-3 py-1.5 flex items-center gap-2">
                    <input autoFocus value={editFolderName} onChange={(e) => setEditFolderName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleEditFolder(folder.id); if (e.key === 'Escape') { setEditingFolder(null); setEditFolderName(''); } }} className="rune-input flex-1 px-2 py-1 text-[13px]" />
                    <button onClick={() => handleEditFolder(folder.id)} className="text-[var(--mint)] hover:bg-[var(--mint-dim)] p-1 rounded">
                      <Check size={14} />
                    </button>
                  </div>
                ) : (
                  <SidebarItem active={selectedFolderId === folder.id} onClick={() => setSelectedFolderId(folder.id)} icon={<Icon size={15} />} label={folder.name} />
                )}
                {!isEditing && hoveredItem === folder.id && folder.id > 5 && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1 bg-[rgba(18,18,30,0.9)] rounded-lg p-0.5">
                    <button onClick={(e) => { e.stopPropagation(); setEditingFolder(folder.id); setEditFolderName(folder.name); }} className="p-1 rounded text-[var(--moon-faint)] hover:text-[var(--mint)] hover:bg-[rgba(210,210,220,0.1)] transition-all"><Edit3 size={12} /></button>
                    <button onClick={(e) => { e.stopPropagation(); handleDeleteFolder(folder.id, folder.name); }} className="p-1 rounded text-[var(--moon-faint)] hover:text-[var(--danger)] hover:bg-[rgba(212,112,112,0.1)] transition-all"><Trash2 size={12} /></button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 标签 */}
        <div className="pt-3">
          <div className="flex items-center justify-between px-3 mb-1.5">
            <span className="text-[10px] text-[var(--moon-faint)] uppercase tracking-[0.2em] font-semibold">标签</span>
            <ClickSpark sparkColor="#7DD3C0" sparkCount={6}>
              <button onClick={() => setIsAddingTag(!isAddingTag)} className="w-5 h-5 rounded-md flex items-center justify-center text-[var(--moon-faint)] hover:text-[var(--mint)] hover:bg-[rgba(210,210,220,0.1)] transition-all">
                <Plus size={12} />
              </button>
            </ClickSpark>
          </div>

          {isAddingTag && (
            <div className="px-3 py-2 space-y-2 mb-1">
              <input value={newTagName} onChange={(e) => setNewTagName(e.target.value)} placeholder="标签名称..." className="rune-input w-full px-3 py-1.5 text-[13px]" />
              <div className="flex gap-1.5 flex-wrap">
                {tagColors.map(c => (
                  <button key={c} onClick={() => setNewTagColor(c)} className="w-5 h-5 rounded-full transition-all" style={{ background: c, boxShadow: newTagColor === c ? `0 0 0 2px var(--void), 0 0 0 4px ${c}` : 'none' }} />
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={handleAddTag} className="rune-btn rune-btn-primary px-3 py-1 text-xs">确定</button>
                <button onClick={() => setIsAddingTag(false)} className="rune-btn px-3 py-1 text-xs">取消</button>
              </div>
            </div>
          )}

          {tags.map(tag => (
            <div key={tag.id} className="relative group">
              <SidebarItem active={selectedTagId === tag.id} onClick={() => setSelectedTagId(tag.id)} icon={<div className="w-2.5 h-2.5 rounded-full" style={{ background: tag.color }} />} label={tag.name} />
              <button onClick={(e) => { e.stopPropagation(); handleDeleteTag(tag.id, tag.name); }} className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--moon-faint)] hover:text-[var(--danger)] hover:bg-[rgba(212,112,112,0.1)] transition-all">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 底部 */}
      <div className="p-2 pb-3 pt-3 border-t border-[rgba(192,200,216,0.06)] space-y-0.5 flex-shrink-0">
        <SidebarItem onClick={() => setIsPasswordGeneratorOpen(true)} icon={<Sparkles size={15} />} label="密码生成器" />
        <SidebarItem onClick={() => setIsSettingsOpen(true)} icon={<Settings size={15} />} label="设置" />
      </div>
    </aside>
  );
}

function SidebarItem({ active, onClick, icon, label, badge }: {
  active?: boolean; onClick: () => void; icon: React.ReactNode; label: string; badge?: number;
}) {
  return (
    <button onClick={onClick} className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-200 ${active ? 'bg-[rgba(210,210,220,0.1)] text-[var(--mint)] shadow-[0_0_12px_rgba(210,210,220,0.1)]' : 'text-[var(--moon-dim)] hover:text-[var(--moon)] hover:bg-[rgba(192,200,216,0.05)]'}`}>
      <span className={active ? 'text-[var(--mint)]' : 'text-[var(--moon-faint)]'}>{icon}</span>
      <span className="text-[13px] font-medium flex-1 text-left">{label}</span>
      {badge !== undefined && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[rgba(210,210,220,0.15)] text-[var(--mint)] font-semibold">{badge}</span>}
    </button>
  );
}
