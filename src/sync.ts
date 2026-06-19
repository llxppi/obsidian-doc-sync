import { App, Notice, TFile } from 'obsidian';
import { DocSyncSettings } from './settings';
import { DocProvider, DocPage } from './providers/base';
import { GenericProvider } from './providers/generic';
import { TencentProvider } from './providers/tencent';

async function saveInlineImages(app: App, md: string, docFolder: string): Promise<string> {
  const regex = /!\[[^\]]*\]\(data:image\/(\w+);base64,([A-Za-z0-9+/=]+)\)/g;
  const matches = [...md.matchAll(regex)];
  if (matches.length === 0) return md;

  const imgDir = `${docFolder}/assets`;
  if (!app.vault.getAbstractFileByPath(imgDir)) await app.vault.createFolder(imgDir);

  const parts: string[] = [];
  let last = 0;
  for (let i = 0; i < matches.length; i++) {
    const [full, ext, b64] = matches[i];
    parts.push(md.slice(last, matches[i].index));
    const binary = atob(b64);
    const buf = new Uint8Array(binary.length);
    for (let j = 0; j < binary.length; j++) buf[j] = binary.charCodeAt(j);
    const imgPath = `${imgDir}/img_${i}.${ext === 'jpeg' ? 'jpg' : ext}`;
    await app.vault.adapter.writeBinary(imgPath, buf.buffer);
    parts.push(`![[${imgPath}]]`);
    last = matches[i].index! + full.length;
  }
  parts.push(md.slice(last));
  return parts.join('');
}

function splitParas(text: string): string[] {
  return text.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
}

function mergeAtPosition(existing: string, base: string, fresh: string): { result: string; added: string[] } {
  const baseSet = new Set(splitParas(base));
  const freshParas = splitParas(fresh);
  const newParas = freshParas.filter(p => !baseSet.has(p));
  if (!newParas.length) return { result: existing, added: [] };

  const result = splitParas(existing);
  let anchor = -1;
  for (const fp of freshParas) {
    if (baseSet.has(fp)) {
      const idx = result.indexOf(fp, anchor + 1);
      if (idx !== -1) anchor = idx;
    } else {
      result.splice(anchor + 1, 0, fp);
      anchor++;
    }
  }
  return { result: result.join('\n\n'), added: newParas };
}

async function readCache(app: App, path: string): Promise<string> {
  const f = app.vault.getAbstractFileByPath(path);
  return f instanceof TFile ? app.vault.read(f) : '';
}

async function writeCache(app: App, path: string, content: string): Promise<void> {
  const dir = path.substring(0, path.lastIndexOf('/'));
  if (dir && !app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir);
  const f = app.vault.getAbstractFileByPath(path);
  if (f instanceof TFile) await app.vault.modify(f, content);
  else await app.vault.create(path, content);
}

function resolveProvider(settings: DocSyncSettings): DocProvider {
  const isTencent = settings.sourceUrl.includes('docs.qq.com');
  if (settings.provider === 'tencent' || (settings.provider === 'auto' && isTencent)) {
    const { tencentAccessToken: accessToken, tencentClientId: clientId, tencentOpenId: openId } = settings;
    if (!accessToken || !clientId || !openId)
      throw new Error('请先在设置中填写腾讯文档的 Access-Token、Client-Id 和 Open-Id。');
    return new TencentProvider({ accessToken, clientId, openId });
  }
  return new GenericProvider();
}

export async function syncDocs(app: App, settings: DocSyncSettings): Promise<void> {
  if (!settings.sourceUrl) throw new Error('请先在设置中填写文档来源 URL。');

  const notice = new Notice('文档同步：正在获取页面列表…', 0);
  try {
    const provider = resolveProvider(settings);
    const pages = await provider.fetchPages(settings.sourceUrl);
    const docId = settings.sourceUrl.includes('docs.qq.com')
      ? TencentProvider.extractDocId(settings.sourceUrl)
      : undefined;

    const indexLinks: string[] = [];
    let updated = 0;

    const errors: string[] = [];
    for (const page of pages) {
      try {
        const pageWithMeta = docId ? { ...page, docId } : page;
        const raw = await provider.fetchContent(pageWithMeta as DocPage);
        const filePath = `${settings.targetFolder}/${page.path}.md`;
        const md = await saveInlineImages(app, raw, `${settings.targetFolder}/${page.path}`);
        indexLinks.push(`- [[${page.path}|${page.title}]]`);

        const existing = app.vault.getAbstractFileByPath(filePath);
        const cachePath = `${settings.targetFolder}/.cache/${page.path}`;
        if (existing instanceof TFile) {
          const [existingContent, base] = await Promise.all([app.vault.read(existing), readCache(app, cachePath)]);
          const { result, added } = mergeAtPosition(existingContent, base || md, md);
          if (result !== existingContent) {
            await app.vault.modify(existing, result);
            await writeCache(app, cachePath, md);
            updated++;
            const preview = added.slice(0, 3).map(p => '• ' + p.substring(0, 50) + (p.length > 50 ? '…' : '')).join('\n');
            new Notice(`「${page.title}」新增 ${added.length} 段：\n${preview}`, 0);
          }
        } else {
          const dir = filePath.substring(0, filePath.lastIndexOf('/'));
          if (dir && !app.vault.getAbstractFileByPath(dir)) await app.vault.createFolder(dir);
          await app.vault.create(filePath, md);
          await writeCache(app, cachePath, md);
          updated++;
        }
      } catch (e) {
        const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
        errors.push(`${page.title}: ${msg}`);
        console.error('[doc-sync]', page.title, e);
      }
    }

    const indexPath = `${settings.targetFolder}/index.md`;
    const indexContent = `# 目录\n\n${indexLinks.join('\n')}`;
    const existingIndex = app.vault.getAbstractFileByPath(indexPath);
    if (existingIndex instanceof TFile) {
      await app.vault.modify(existingIndex, indexContent);
    } else {
      if (!app.vault.getAbstractFileByPath(settings.targetFolder))
        await app.vault.createFolder(settings.targetFolder);
      await app.vault.create(indexPath, indexContent);
    }

    if (errors.length > 0) {
      const logPath = `${settings.targetFolder}/doc-sync-errors.md`;
      const logContent = `# 同步错误日志\n\n${new Date().toLocaleString('zh-CN')}\n\n${errors.map(e => `- ${e}`).join('\n')}`;
      const existingLog = app.vault.getAbstractFileByPath(logPath);
      if (existingLog instanceof TFile) await app.vault.modify(existingLog, logContent);
      else await app.vault.create(logPath, logContent);
    }

    settings.lastSynced = new Date().toISOString();
    notice.hide();
    const errMsg = errors.length > 0 ? `，${errors.length} 个页面失败：${errors[0]}` : '';
    new Notice(`文档同步完成，共更新 ${updated} 个文件${errMsg}。`, errors.length > 0 ? 0 : 4000);
  } catch (e) {
    notice.hide();
    new Notice('文档同步失败：' + e.message);
    throw e;
  }
}
