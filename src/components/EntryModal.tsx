import { useState, useEffect } from 'react';
import { X, Save, Star, Eye, EyeOff, History, ImagePlus, Globe, KeyRound, RefreshCw } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { useToastStore } from '@/stores/toastStore';
import { createEntry, updateEntry, getPasswordHistory, getEntryTags, getAttachments, addAttachment, deleteAttachment } from '@/lib/db';
import { parseGoogleMigration, parseOtpAuth } from '@/lib/totp';
import { encryptAttachment, decryptAttachment } from '@/lib/crypto';
import { Paperclip, Download, Trash2 } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { convertFileSrc } from '@tauri-apps/api/core';
import { readFile } from '@tauri-apps/plugin-fs';
import type { Entry } from '@/types';
import { getPasswordStrength, generatePassword } from '@/lib/passwordUtils';
import { SpecularButton } from '@/components/SpecularButton';
import { getIconsDir, getAttachmentsDir, isLocalMediaPath } from '@/lib/mediaPaths';
import { writeFileBytes, removePath, readFileBytes } from '@/lib/rustFs';
import { BUILTIN_TEMPLATES } from '@/lib/templates';

export function EntryModal() {
  const { editingEntry, setEditingEntry, setIsEntryModalOpen, folders, tags, refreshAll } = useAppStore();
  const { addToast } = useToastStore();
  const isEn = useAppStore((s) => s.settings?.language === 'en');
  const isEditing = !!editingEntry;

  const [form, setForm] = useState<Partial<Entry>>({
    title: '', username: '', password: '', website: '', notes: '', icon: '', folder_id: null, is_favorite: false,
  });
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [showPassword, setShowPassword] = useState(false);
  const [passwordHistory, setPasswordHistory] = useState<any[]>([]);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [attachBusy, setAttachBusy] = useState(false);
  const [strength, setStrength] = useState<any>(null);
  const [customIcon, setCustomIcon] = useState<string | null>(null);
  const [customFields, setCustomFields] = useState<{ key: string; value: string; hidden?: boolean }[]>([]);
  // 密码生成面板状态
  const [showGenPanel, setShowGenPanel] = useState(false);
  const [genLen, setGenLen] = useState(16);
  const [genUpper, setGenUpper] = useState(true);
  const [genLower, setGenLower] = useState(true);
  const [genNumbers, setGenNumbers] = useState(true);
  const [genSymbols, setGenSymbols] = useState(true);
  const [genExclude, setGenExclude] = useState(true);
  const [totpInfo, setTotpInfo] = useState<{ name?: string; fromMigration: boolean } | null>(null);

  useEffect(() => {
    if (editingEntry) {
      setForm({ ...editingEntry });
      setCustomIcon(editingEntry.icon || null);
      setCustomFields(editingEntry.customFields && editingEntry.customFields.length ? editingEntry.customFields.map((f) => ({ ...f })) : []);
      loadHistory(editingEntry.id);
      getEntryTags(editingEntry.id).then(setSelectedTags);
      getAttachments(editingEntry.id).then(setAttachments);
    } else {
      setForm({
        title: '', username: '', password: '', website: '', notes: '', icon: '', folder_id: null, is_favorite: false,
      });
      setCustomIcon(null);
      setCustomFields([]);
      setSelectedTags([]);
      setPasswordHistory([]);
      setStrength(null);
      setTotpInfo(null);
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

      await writeFileBytes(destPath, data);

      // 删除旧的本地图标文件（如果存在）
      if (customIcon && isLocalMediaPath(customIcon)) {
        try { await removePath(customIcon); } catch {}
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
          try { await removePath(customIcon); } catch {}
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

  // ---- 附件：上传（加密存储）/ 下载（解密）/ 删除 ----
  const handleAttachUpload = async () => {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const file = await open({ multiple: false });
    if (!file || typeof file !== 'string') return;
    setAttachBusy(true);
    try {
      const data = await readFile(file);
      const bytes = new Uint8Array(data);
      const { encrypted } = await encryptAttachment(bytes);
      const attDir = await getAttachmentsDir();
      const name = file.split(/[\\/]/).pop() || 'attachment';
      const destName = `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.fa`;
      const destPath = `${attDir}\\${destName}`;
      await writeFileBytes(destPath, encrypted);

      let entryId = editingEntry?.id;
      if (!entryId) {
        // 未保存的新账号：暂存状态，保存时写入
        setAttachments((prev) => [...prev, { _pending: true, file_name: name, file_path: destPath, file_size: bytes.length }]);
        addToast('附件已暂存，保存账号后生效', 'success');
        setAttachBusy(false);
        return;
      }
      await addAttachment(entryId, name, destPath, bytes.length);
      setAttachments(await getAttachments(entryId));
      addToast('附件已加密保存', 'success');
    } catch (e) {
      console.error('attach upload failed', e);
      addToast('附件上传失败', 'error');
    } finally {
      setAttachBusy(false);
    }
  };

  const handleAttachDownload = async (att: any) => {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const buf = await readFileBytes(att.file_path);
      const decrypted = await decryptAttachment(new Uint8Array(buf));
      const filePath = await save({
        defaultPath: att.file_name,
        filters: [{ name: 'All files', extensions: ['*'] }],
      });
      if (!filePath) return;
      await writeFileBytes(filePath, decrypted);
      addToast('附件已解密保存', 'success');
    } catch (e) {
      console.error('attach download failed', e);
      addToast('附件下载失败', 'error');
    }
  };

  const handleAttachDelete = async (att: any) => {
    try {
      if (att.id) {
        await deleteAttachment(att.id);
        await refreshAll();
      }
      setAttachments((prev) => prev.filter((a) => a !== att));
      addToast('附件已删除', 'success');
    } catch {
      addToast('删除失败', 'error');
    }
  };

  const handleSave = async () => {
    if (!form.title?.trim()) {
      addToast('请填写标题', 'warning');
      return;
    }

    try {
      if (isEditing && editingEntry) {
        await updateEntry(editingEntry.id, { ...form, icon: customIcon || '', customFields: customFields.filter(f => f.key.trim()) }, selectedTags);
        addToast('账号已更新', 'success');
      } else {
        const newId = await createEntry({ ...form, icon: customIcon || '', customFields: customFields.filter(f => f.key.trim()) }, selectedTags);
        addToast('账号添加成功', 'success');
        // 把暂存的附件正式写入数据库
        const pending = attachments.filter((a) => a._pending);
        if (pending.length > 0) {
          for (const p of pending) {
            await addAttachment(newId, p.file_name, p.file_path, p.file_size);
          }
          setAttachments(await getAttachments(newId));
        }
      }

      // 保存后重置到"全部账号"视图，确保新账号立即可见
      useAppStore.getState().setSelectedFolderId(null);
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
            {/* 模板：选择后把结构填充到备注 */}
            <select
              value=""
              onChange={(e) => {
                const id = e.target.value;
                if (!id) return;
                const tpl = BUILTIN_TEMPLATES.find((t) => t.id === id);
                if (tpl) {
                  const parts: string[] = [];
                  if (tpl.notes) parts.push(tpl.notes);
                  const fieldLines = tpl.customFields
                    .map((f) => `${f.key}：${f.value || ''}`)
                    .join('\n');
                  if (fieldLines) parts.push(fieldLines);
                  if (parts.length) {
                    const block = parts.join('\n');
                    const prev = form.notes?.trim();
                    const add = prev ? `${prev}\n\n${block}` : block;
                    setForm((f) => ({ ...f, notes: add }));
                  }
                }
                e.target.value = '';
              }}
              className="rune-input w-full px-3 py-2 text-xs bg-transparent mt-2"
            >
              <option value="" style={{ background: '#1A1A2E' }}>{isEn ? '插入模板到备注…' : '插入模板到备注…'}</option>
              {BUILTIN_TEMPLATES.map((tpl) => (
                <option key={tpl.id} value={tpl.id} style={{ background: '#1A1A2E' }}>{tpl.icon} {isEn ? tpl.nameEn : tpl.name}</option>
              ))}
            </select>
          </div>

          {/* 自定义字段 */}
          <div>
            <label className="text-xs text-[var(--moon-faint)] mb-2 flex items-center justify-between">
              <span>自定义字段</span>
            </label>
            {customFields.length > 0 && (
              <div className="space-y-2">
                {customFields.map((f, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input value={f.key} onChange={e => { const n = [...customFields]; n[i].key = e.target.value; setCustomFields(n); }}
                      placeholder="字段名（如：会员ID）" className="rune-input flex-1 px-2.5 py-2 text-xs" />
                    <div className="relative flex-[1.4]">
                      <input type={f.hidden ? 'password' : 'text'} value={f.value}
                        onChange={e => { const n = [...customFields]; n[i].value = e.target.value; setCustomFields(n); }}
                        placeholder="值" className="rune-input w-full pl-2.5 pr-8 py-2 text-xs" />
                      <button onClick={() => { const n = [...customFields]; n[i].hidden = !n[i].hidden; setCustomFields(n); }}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-[var(--moon-faint)] hover:text-[var(--moon)]" title="隐藏/显示">
                        {f.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>
                    </div>
                    <button onClick={() => setCustomFields(customFields.filter((_, j) => j !== i))}
                      className="p-1.5 rounded text-[var(--moon-faint)] hover:text-[var(--danger,#D47070)]" title="删除字段">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 两步验证密钥 (TOTP) */}
          <div>
            <label className="text-xs text-[var(--moon-faint)] mb-1 block flex items-center gap-1.5">
              <KeyRound size={11} /> 两步验证 (2FA) 密钥
            </label>
            <input
              value={form.totp_secret || ''}
              onChange={e => {
                const raw = e.target.value.trim();
                // 智能识别：Google 批量迁移链接 → 取第一个条目的 secret；otpauth:// → 提取 secret；否则按明文密钥
                if (raw.startsWith('otpauth-migration://')) {
                  const list = parseGoogleMigration(raw);
                  if (list.length > 0) {
                    setForm({ ...form, totp_secret: list[0].secret });
                    setTotpInfo({ name: list[0].name || list[0].issuer, fromMigration: true });
                    if (list.length > 1) addToast(`已提取第 1 个「${list[0].name || list[0].issuer || '未命名'}」，其余 ${list.length - 1} 个可在设置→TOTP 批量导入`, 'info');
                  } else {
                    setForm({ ...form, totp_secret: raw });
                    setTotpInfo(null);
                  }
                } else if (raw.startsWith('otpauth://')) {
                  const s = parseOtpAuth(raw);
                  if (s) {
                    // 存入完整 otpauth:// URI（保留 algorithm/digits/period 参数，避免 SHA256/8位 等算出无效码）
                    setForm({ ...form, totp_secret: raw });
                    setTotpInfo({ fromMigration: false });
                  } else {
                    setForm({ ...form, totp_secret: raw });
                    setTotpInfo(null);
                  }
                } else {
                  setForm({ ...form, totp_secret: raw });
                  setTotpInfo(null);
                }
              }}
              placeholder="粘贴 TOTP 密钥 / otpauth:// URI / 谷歌验证器迁移链接"
              className="rune-input w-full px-3 py-2.5 text-sm font-mono"
            />
            {form.totp_secret && (
              <p className="text-[11px] text-[var(--mint)] mt-1.5 flex items-center gap-1">
                <RefreshCw size={10} />
                {totpInfo?.fromMigration && totpInfo.name
                  ? `已从迁移链接解析「${totpInfo.name}」：保存后卡片上会实时显示 6 位验证码`
                  : '保存后卡片上会实时显示 6 位验证码'}
              </p>
            )}
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

          {/* 附件（加密存储） */}
          <div className="pt-1">
            <label className="text-xs text-[var(--moon-faint)] mb-2 flex items-center gap-1.5">
              <Paperclip size={11} /> 附件
            </label>
            <button
              onClick={handleAttachUpload}
              disabled={attachBusy}
              className="w-full px-3 py-2 rounded-xl text-xs border border-dashed border-[rgba(192,200,216,0.3)] hover:border-[var(--mint)] text-[var(--moon-dim)] hover:text-[var(--mint)] transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {attachBusy ? '上传中…' : '+ 上传附件（AES 加密存储）'}
            </button>
            {attachments.length > 0 && (
              <div className="mt-2 space-y-1">
                {attachments.map((att, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[rgba(192,200,216,0.05)] text-xs text-[var(--moon-dim)]">
                    <Paperclip size={11} className="flex-shrink-0" style={{ color: 'var(--mint)' }} />
                    <span className="flex-1 truncate">{att.file_name}</span>
                    <span className="text-[10px] text-[var(--moon-faint)]">
                      {(att.file_size / 1024).toFixed(att.file_size > 102400 ? 0 : 1)} KB
                    </span>
                    {att._pending && (
                      <span className="text-[10px]" style={{ color: 'var(--warning, #D4B070)' }}>待保存</span>
                    )}
                    <button onClick={() => handleAttachDownload(att)} className="p-1 rounded hover:text-[var(--mint)] hover:bg-[rgba(210,210,220,0.1)]" title="下载（解密）">
                      <Download size={12} />
                    </button>
                    <button onClick={() => handleAttachDelete(att)} className="p-1 rounded hover:text-[var(--danger, #D47070)] hover:bg-[rgba(212,112,112,0.1)]" title="删除">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
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
