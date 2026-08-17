import { useState, useEffect } from 'react';
import { X, Save, Star, Eye, EyeOff, History, ImagePlus, Globe, KeyRound, RefreshCw } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useToastStore } from '@/stores/toastStore';
import { createEntry, updateEntry, getPasswordHistory, getEntryTags } from '@/lib/db';
import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';
import { readFile, remove, writeFile } from '@tauri-apps/plugin-fs';
import type { Entry } from '@/types';
import { getPasswordStrength, generatePassword } from '@/lib/passwordUtils';
import { SpecularButton } from '@/components/SpecularButton';
import { getIconsDir, isLocalMediaPath } from '@/lib/mediaPaths';

export function EntryModal() {
  const { editingEntry, setEditingEntry, setIsEntryModalOpen, folders, tags, refreshAll } = useAppStore();
  const { addToast } = useToastStore();
  const isEditing = !!editingEntry;

  const [form, setForm] = useState<Partial<Entry>>({
    title: '', username: '', password: '', website: '', notes: '', icon: '', folder_id: null, is_favorite: false,
  });
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [showPassword, setShowPassword] = useState(false);
  const [passwordHistory, setPasswordHistory] = useState<any[]>([]);
  const [strength, setStrength] = useState<any>(null);
  const [customIcon, setCustomIcon] = useState<string | null>(null);
  // 密码生成面板状态
  const [showGenPanel, setShowGenPanel] = useState(false);
  const [genLen, setGenLen] = useState(16);
  const [genUpper, setGenUpper] = useState(true);
  const [genLower, setGenLower] = useState(true);
  const [genNumbers, setGenNumbers] = useState(true);
  const [genSymbols, setGenSymbols] = useState(true);
  const [genExclude, setGenExclude] = useState(true);

  useEffect(() => {
    if (editingEntry) {
      setForm({ ...editingEntry });
      setCustomIcon(editingEntry.icon || null);
      loadHistory(editingEntry.id);
      getEntryTags(editingEntry.id).then(setSelectedTags);
    } else {
      setForm({
        title: '', username: '', password: '', website: '', notes: '', icon: '', folder_id: null, is_favorite: false,
      });
      setCustomIcon(null);
      setSelectedTags([]);
      setPasswordHistory([]);
      setStrength(null);
    }
  }, [editingEntry]);

  useEffect(() => {
    if (form.password) setStrength(getPasswordStrength(form.password));
    else setStrength(null);
  }, [form.password]);

  async function loadHistory(entryId: number) {
    const history = await getPasswordHistory(entryId);
    setPasswordHistory(history);
  }

  const handleUploadIcon = async () => {
    const file = await open({
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
    });
    if (!file || typeof file !== 'string') return;

    try {
      const data = await readFile(file);
      const iconsDir = await getIconsDir();

      const ext = file.split('.').pop() || 'png';
      const destName = `icon_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const destPath = `${iconsDir}` + '\\' + destName;

      await writeFile(destPath, data);

      // 删除旧的本地图标文件（如果存在）
      if (customIcon && isLocalMediaPath(customIcon)) {
        try { await remove(customIcon); } catch {}
      }

      setCustomIcon(destPath);
      setForm((prev) => ({ ...prev, icon: destPath }));
    } catch (e) {
      console.error('Icon copy failed:', e);
      addToast('图标保存失败', 'error');
    }
  };

  const fetchFavicon = async (silent = false) => {
    if (faviconBusy) return;
    if (!form.website?.trim()) return;
    setFaviconBusy(true);
    try {
      let url = form.website.trim();
      if (!url.startsWith('http')) url = `https://${url}`;
      const domain = new URL(url).hostname;
      const cleanDomain = domain.replace(/^www\./, '');

      // 多来源并行测试（img 预加载，不受 CORS 限制，3秒超时）
      const sources = [
        `https://www.google.com/s2/favicons?domain=${cleanDomain}&sz=128`,
        `https://icons.duckduckgo.com/ip3/${cleanDomain}.ico`,
        `https://${domain}/favicon.ico`,
        `https://${cleanDomain}/favicon.ico`,
        `https://${domain}/apple-touch-icon.png`,
      ];

      // 并行测试所有源，取第一个成功的
      const results = await Promise.all(sources.map(async (url) => ({
        url,
        ok: await testImage(url),
      })));
      const hit = results.find((r) => r.ok);

      if (hit) {
        // 删除旧本地图标文件（如果存在）
        if (customIcon && isLocalMediaPath(customIcon)) {
          try { await remove(customIcon); } catch {}
        }
        setCustomIcon(hit.url);
        setForm((prev) => ({ ...prev, icon: hit.url }));
        if (!silent) addToast('网站图标已获取', 'success');
        return;
      }
      if (!silent) addToast('无法获取网站图标，请手动上传', 'warning');
    } catch (e) {
      console.error('Favicon fetch failed:', e);
      if (!silent) addToast('无法获取网站图标，请手动上传', 'warning');
    } finally {
      setFaviconBusy(false);
      // 10 秒冷却，避免频繁请求
      setFaviconCooldown(10);
      const interval = setInterval(() => {
        setFaviconCooldown((prev) => {
          if (prev <= 1) { clearInterval(interval); return 0; }
          return prev - 1;
        });
      }, 1000);
    }
  };

  // img 预加载测试图片是否可访问（3秒超时）
  function testImage(src: string): Promise<boolean> {
    return new Promise((resolve) => {
      const img = new Image();
      let done = false;
      const finish = (ok: boolean) => {
        if (!done) { done = true; resolve(ok); }
      };
      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      img.src = src;
      // 3 秒超时兜底，避免被墙的源永久挂起
      setTimeout(() => finish(false), 3000);
    });
  }

  // 输入网址后自动获取 favicon（防抖 600ms）
  useEffect(() => {
    if (!form.website?.trim()) return;
    const timer = setTimeout(() => fetchFavicon(true), 600);
    return () => clearTimeout(timer);
  }, [form.website]);

  // 转换图标路径：http URL 直接显示，本地文件用 convertFileSrc
  const [iconLoadError, setIconLoadError] = useState(false);
  // 获取图标按钮冷却状态
  const [faviconBusy, setFaviconBusy] = useState(false);
  const [faviconCooldown, setFaviconCooldown] = useState(0);
  const displayIconUrl = customIcon && !iconLoadError
    ? (customIcon.startsWith('http') ? customIcon : convertFileSrc(customIcon))
    : null;

  const handleSave = async () => {
    if (!form.title?.trim()) {
      addToast('请填写标题', 'warning');
      return;
    }

    try {
      if (isEditing && editingEntry) {
        await updateEntry(editingEntry.id, { ...form, icon: customIcon || '' }, selectedTags);
        addToast('账号已更新', 'success');
      } else {
        await createEntry({ ...form, icon: customIcon || '' }, selectedTags);
        addToast('账号添加成功', 'success');
      }

      await refreshAll();
      setIsEntryModalOpen(false);
      setEditingEntry(null);
    } catch (e) {
      addToast('保存失败，请重试', 'error');
    }
  };

  const handleGeneratePassword = () => {
    // 先清空密码框再填入新密码
    const pwd = generatePassword({
      length: genLen,
      upper: genUpper,
      lower: genLower,
      numbers: genNumbers,
      symbols: genSymbols,
      excludeAmbiguous: genExclude,
    });
    if (!pwd) {
      addToast('请至少勾选一种字符类型', 'warning');
      return;
    }
    setForm((prev) => ({ ...prev, password: pwd }));
    addToast('密码已生成', 'success');
  };

  const toggleTag = (tagId: number) => {
    setSelectedTags(prev => prev.includes(tagId) ? prev.filter(t => t !== tagId) : [...prev, tagId]);
  };

  const strengthColors = ['#D47070', '#D4B070', '#9B8DB5', '#7DB8D3', '#7DD3C0'];
  const strengthLabels = ['极弱', '弱', '一般', '强', '极强'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => { setIsEntryModalOpen(false); setEditingEntry(null); }} />

      <div className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto p-6"
        style={{
          background: 'var(--glass-bg)',
          border: '1px solid var(--glass-border)',
          borderRadius: '18px',
          backdropFilter: 'blur(var(--glass-blur)) saturate(var(--glass-saturate))',
          boxShadow: '0 0 60px rgba(0,0,0,0.4), 0 0 0 1px rgba(210,210,220,0.05)',
        }}>

        {/* 头部 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl overflow-hidden ring-1 ring-[rgba(210,210,220,0.2)]">
              {displayIconUrl ? (
                <img src={displayIconUrl} alt="" className="w-full h-full object-cover"
                  onError={() => setIconLoadError(true)} />
              ) : (
                <div className="w-full h-full bg-[var(--mint-dim)] flex items-center justify-center">
                  <Globe size={18} style={{ color: 'var(--mint)' }} />
                </div>
              )}
            </div>
            <h2 className="text-xl font-bold text-[var(--moon)]">{isEditing ? '编辑账号' : '新建账号'}</h2>
          </div>
          <button onClick={() => { setIsEntryModalOpen(false); setEditingEntry(null); }}
            className="text-[var(--moon-faint)] hover:text-[var(--moon)] transition-colors p-1 rounded-lg hover:bg-[rgba(192,200,216,0.08)]">
            <X size={22} />
          </button>
        </div>

        <div className="space-y-4">
          {/* 图标上传 */}
          <div className="flex items-center gap-3">
            <button onClick={handleUploadIcon}
              className="w-12 h-12 rounded-xl overflow-hidden flex items-center justify-center border border-dashed border-[rgba(192,200,216,0.2)] hover:border-[var(--mint)] hover:bg-[var(--mint-dim)] transition-all"
              title="上传自定义图标">
              {displayIconUrl ? (
                <img src={displayIconUrl} alt="" className="w-full h-full object-cover"
                  onError={() => setIconLoadError(true)} />
              ) : (
                <ImagePlus size={18} style={{ color: 'var(--moon-faint)' }} />
              )}
            </button>
            <div className="flex-1">
              <label className="text-xs text-[var(--moon-faint)]">标题 *</label>
              <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
                placeholder="例如：Steam 账号" className="rune-input w-full px-3 py-2 text-sm mt-1" />
            </div>
            <button onClick={() => setForm({ ...form, is_favorite: !form.is_favorite })}
              className={`self-end p-2.5 rounded-xl transition-all ${form.is_favorite ? 'text-[var(--mint)] bg-[var(--mint-dim)]' : 'text-[var(--moon-faint)] hover:bg-[rgba(192,200,216,0.08)]'}`}>
              <Star size={18} fill={form.is_favorite ? 'currentColor' : 'none'} />
            </button>
          </div>

          {/* 用户名 */}
          <div>
            <label className="text-xs text-[var(--moon-faint)] mb-1 block">账号 / 用户名</label>
            <input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })}
              placeholder="邮箱、手机号或用户名" className="rune-input w-full px-3 py-2.5 text-sm" />
          </div>

          {/* 密码 */}
          <div>
            <label className="text-xs text-[var(--moon-faint)] mb-1 block">密码</label>
            <div className="relative">
              <input type={showPassword ? 'text' : 'password'} value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                placeholder="输入或生成密码" className="rune-input w-full pl-3 pr-28 py-2.5 text-sm font-mono" />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                <button onClick={() => { setShowGenPanel(!showGenPanel); }}
                  className="p-1.5 rounded-lg text-[var(--moon-faint)] hover:text-[var(--mint)] hover:bg-[rgba(192,200,216,0.08)] transition-all"
                  title="生成密码">
                  <KeyRound size={15} />
                </button>
                <button onClick={() => setShowPassword(!showPassword)}
                  className="p-1.5 rounded-lg text-[var(--moon-faint)] hover:text-[var(--moon)] hover:bg-[rgba(192,200,216,0.08)] transition-all">
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {/* 密码生成面板 */}
            {showGenPanel && (
              <div className="mt-2 p-3 rounded-xl rune-panel">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-[var(--moon-dim)] whitespace-nowrap">长度</span>
                  <input type="range" min={6} max={32} value={genLen}
                    onChange={e => setGenLen(Number(e.target.value))} className="flex-1 accent-[var(--mint)]" />
                  <span className="text-sm font-mono text-[var(--mint)] w-8 text-right">{genLen}</span>
                </div>
                <div className="flex flex-wrap gap-2 mt-2.5">
                  {[
                    { label: '大写 A-Z', on: genUpper, set: setGenUpper },
                    { label: '小写 a-z', on: genLower, set: setGenLower },
                    { label: '数字 0-9', on: genNumbers, set: setGenNumbers },
                    { label: '符号 !@#', on: genSymbols, set: setGenSymbols },
                    { label: '排除易混淆', on: genExclude, set: setGenExclude },
                  ].map((opt) => (
                    <button key={opt.label} onClick={() => opt.set(!opt.on)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-all ${
                        opt.on
                          ? 'border-transparent text-white'
                          : 'border-[rgba(192,200,216,0.15)] text-[var(--moon-faint)] hover:border-[rgba(192,200,216,0.3)]'
                      }`}
                      style={opt.on ? { backgroundColor: 'var(--mint)', color: '#12121E' } : {}}>
                      {opt.label}
                    </button>
                  ))}
                  <button onClick={handleGeneratePassword}
                    className="rune-btn rune-btn-primary px-3 py-1 text-xs flex items-center gap-1 ml-auto">
                    <RefreshCw size={12} /> 生成
                  </button>
                </div>
              </div>
            )}

            {strength && (
              <div className="mt-2 flex items-center gap-3">
                <div className="flex-1 h-1 rounded-full overflow-hidden bg-[rgba(192,200,216,0.1)]">
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${(strength.score + 1) * 20}%`, background: strengthColors[strength.score] }} />
                </div>
                <span className="text-xs" style={{ color: strengthColors[strength.score] }}>{strengthLabels[strength.score]}</span>
              </div>
            )}
          </div>

          {/* 网站 */}
          <div>
            <label className="text-xs text-[var(--moon-faint)] mb-1 block">网站地址（自动获取图标）</label>
            <div className="relative flex gap-2">
              <div className="relative flex-1">
                <Globe size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--moon-faint)]" />
                <input value={form.website} onChange={e => setForm({ ...form, website: e.target.value })}
                  placeholder="example.com 或 https://..." className="rune-input w-full pl-9 pr-3 py-2.5 text-sm" />
              </div>
              <button onClick={() => fetchFavicon(false)} disabled={faviconBusy || faviconCooldown > 0 || !form.website?.trim()}
                className="rune-btn px-3 py-2 text-xs whitespace-nowrap disabled:opacity-40" title={faviconCooldown > 0 ? `请等待 ${faviconCooldown} 秒` : '获取网站图标'}>
                {faviconBusy ? '获取中...' : faviconCooldown > 0 ? `${faviconCooldown}s` : '获取图标'}
              </button>
            </div>
          </div>

          {/* 分类 */}
          <div>
            <label className="text-xs text-[var(--moon-faint)] mb-1 block">所属分类</label>
            <select value={form.folder_id || ''} onChange={e => setForm({ ...form, folder_id: e.target.value ? Number(e.target.value) : null })}
              className="rune-input w-full px-3 py-2.5 text-sm bg-transparent">
              <option value="" style={{ background: '#1A1A2E' }}>未分类</option>
              {folders.map(f => <option key={f.id} value={f.id} style={{ background: '#1A1A2E' }}>{f.name}</option>)}
            </select>
          </div>

          {/* 标签 */}
          <div>
            <label className="text-xs text-[var(--moon-faint)] mb-2 block">标签</label>
            <div className="flex flex-wrap gap-2">
              {tags.map(tag => (
                <button key={tag.id} onClick={() => toggleTag(tag.id)}
                  className={`text-xs px-3 py-1.5 rounded-full transition-all border ${
                    selectedTags.includes(tag.id)
                      ? 'border-transparent text-white'
                      : 'border-[rgba(192,200,216,0.15)] text-[var(--moon-faint)] hover:border-[rgba(192,200,216,0.3)]'
                  }`}
                  style={selectedTags.includes(tag.id) ? { backgroundColor: tag.color } : {}}>
                  {tag.name}
                </button>
              ))}
            </div>
          </div>

          {/* 备注 */}
          <div>
            <label className="text-xs text-[var(--moon-faint)] mb-1 block">备注</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
              placeholder="安全提问答案、备用邮箱等..." rows={3}
              className="rune-input w-full px-3 py-2.5 text-sm resize-none" />
          </div>

          {/* 密码历史 */}
          {isEditing && passwordHistory.length > 0 && (
            <div className="pt-2">
              <label className="text-xs text-[var(--moon-faint)] mb-2 flex items-center gap-1">
                <History size={12} /> 密码历史
              </label>
              <div className="space-y-1">
                {passwordHistory.slice(0, 5).map((h, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-[var(--moon-faint)]">
                    <span>••••{h.old_password.slice(-4)}</span>
                    <span className="text-[var(--moon-faint)] opacity-50">{h.changed_at}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-[rgba(192,200,216,0.08)]">
          <button onClick={() => { setIsEntryModalOpen(false); setEditingEntry(null); }}
            className="rune-btn px-5 py-2.5 text-sm">取消</button>
          <SpecularButton onClick={handleSave} className="px-6 py-2.5 text-sm" style={{ background: 'rgba(210,210,220,0.15)', borderColor: 'rgba(210,210,220,0.35)', color: 'var(--mint)' }}>
            <Save size={16} /> {isEditing ? '保存' : '保存'}
          </SpecularButton>
        </div>
      </div>
    </div>
  );
}
