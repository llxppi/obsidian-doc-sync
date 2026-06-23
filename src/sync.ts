import { App, Modal, MarkdownView, Notice, TFile } from 'obsidian';
import { DocSyncSettings } from './settings';
import { DocProvider, DocPage } from './providers/base';
import { GenericProvider } from './providers/generic';
import { TencentProvider } from './providers/tencent';

async function saveInlineImages(app: App, md: string, docFolder: string): Promise<string> {
  const regex = /!\[[^\]]*\]\(data:image\/(\w+);base64,([A-Za-z0-9+/=]+)\)/g;
  const matches = [...md.matchAll(regex)];
  if (matches.length === 0) return md;

  const imgDir = `${docFolder}/assets`;
  await ensureFolder(app, imgDir);

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

function resolveWikilinks(md: string, pages: DocPage[]): string {
  const urlToPath = new Map(pages.filter(p => p.url).map(p => [p.url!, p.path]));
  if (!urlToPath.size) return md;
  return md.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, url) => {
    const path = urlToPath.get(url);
    return path ? `[[${path}|${text}]]` : `[${text}](${url})`;
  });
}

function splitParas(text: string): string[] {
  return text.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
}

function mergeAtPosition(existing: string, base: string, fresh: string): { result: string; added: string[] } {
  const baseSet = new Set(splitParas(base));
  const freshParas = splitParas(fresh);
  const freshSet = new Set(freshParas);

  // Remove paragraphs deleted or modified in remote (in base but not in fresh)
  const deleted = new Set([...baseSet].filter(p => !freshSet.has(p)));
  const result = splitParas(existing).filter(p => !deleted.has(p));

  // Insert new/modified paragraphs at correct positions
  const added: string[] = [];
  let anchor = -1;
  for (const fp of freshParas) {
    if (baseSet.has(fp)) {
      const idx = result.indexOf(fp, anchor + 1);
      if (idx !== -1) anchor = idx;
    } else {
      added.push(fp);
      result.splice(anchor + 1, 0, fp);
      anchor++;
    }
  }
  return { result: result.join('\n\n'), added };
}

async function ensureFolder(app: App, path: string): Promise<void> {
  if (!path || app.vault.getAbstractFileByPath(path)) return;
  try { await app.vault.createFolder(path); } catch {}
}

async function writeFile(app: App, path: string, content: string): Promise<void> {
  const f = app.vault.getAbstractFileByPath(path);
  if (f instanceof TFile) { await app.vault.modify(f, content); return; }
  try { await app.vault.create(path, content); }
  catch { const f2 = app.vault.getAbstractFileByPath(path); if (f2 instanceof TFile) await app.vault.modify(f2, content); }
}

async function readCache(app: App, path: string): Promise<string> {
  const f = app.vault.getAbstractFileByPath(path);
  return f instanceof TFile ? app.vault.read(f) : '';
}

async function writeCache(app: App, path: string, content: string): Promise<void> {
  const dir = path.substring(0, path.lastIndexOf('/'));
  await ensureFolder(app, dir);
  await writeFile(app, path, content);
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

class SyncReportModal extends Modal {
  constructor(app: App, private log: { file: string; added: string[]; deleted: number; isNew: boolean }[]) {
    super(app);
  }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: '同步报告' });
    for (const item of this.log) {
      const section = contentEl.createDiv();
      section.style.cssText = 'margin:8px 0;border-left:3px solid var(--interactive-accent);padding-left:8px;';
      const header = section.createEl('div');
      const fileLink = header.createEl('a', { text: item.file });
      fileLink.style.cssText = 'cursor:pointer;color:var(--link-color);font-weight:bold;';
      fileLink.onclick = () => this.openFile(item.file);
      const badge = item.isNew ? ' 【新建】' : ` 【+${item.added.length} 段 / -${item.deleted} 段】`;
      header.createEl('span', { text: badge }).style.cssText = 'color:var(--text-muted);font-size:0.85em;';
      for (const para of item.added.slice(0, 5)) {
        const p = section.createEl('div', { text: '• ' + para.substring(0, 100) + (para.length > 100 ? '…' : '') });
        p.style.cssText = 'cursor:pointer;padding:2px 0;color:var(--text-muted);font-size:0.85em;';
        p.onmouseenter = () => { p.style.color = 'var(--text-normal)'; };
        p.onmouseleave = () => { p.style.color = 'var(--text-muted)'; };
        p.onclick = () => this.jumpToPara(item.file, para);
      }
      if (item.added.length > 5)
        section.createEl('div', { text: `  …还有 ${item.added.length - 5} 段` }).style.cssText = 'color:var(--text-faint);font-size:0.8em;';
    }
  }
  private async openFile(path: string) {
    await this.app.workspace.openLinkText(path + '.md', '', false);
    this.close();
  }
  private async jumpToPara(filePath: string, para: string) {
    await this.app.workspace.openLinkText(filePath + '.md', '', false);
    await new Promise(r => setTimeout(r, 80));
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (view) {
      const pos = view.editor.getValue().indexOf(para);
      if (pos !== -1) {
        const editorPos = view.editor.offsetToPos(pos);
        view.editor.setCursor(editorPos);
        view.editor.scrollIntoView({ from: editorPos, to: editorPos }, true);
      }
    }
    this.close();
  }
  onClose() { this.contentEl.empty(); }
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
    const changeLog: { file: string; added: string[]; deleted: number; isNew: boolean }[] = [];

    const errors: string[] = [];
    for (const page of pages) {
      try {
        const pageWithMeta = docId ? { ...page, docId } : page;
        const raw = await provider.fetchContent(pageWithMeta as DocPage);
        const filePath = `${settings.targetFolder}/${page.path}.md`;
        const md = resolveWikilinks(
          await saveInlineImages(app, raw, `${settings.targetFolder}/${page.path}`),
          pages
        );
        indexLinks.push(`- [[${page.path}|${page.title}]]`);

        const existing = app.vault.getAbstractFileByPath(filePath);
        const cachePath = `${settings.targetFolder}/.cache/${page.path}`;
        if (existing instanceof TFile) {
          const [existingContent, base] = await Promise.all([app.vault.read(existing), readCache(app, cachePath)]);
          if (!base) {
            const existingParas = new Set(splitParas(existingContent));
            const addedParas = splitParas(md).filter(p => !existingParas.has(p));
            await app.vault.modify(existing, md);
            await writeCache(app, cachePath, md);
            updated++;
            changeLog.push({ file: page.path, added: addedParas, deleted: 0, isNew: false });
          } else {
            const baseParas = new Set(splitParas(base));
            const freshParas = new Set(splitParas(md));
            const deletedCount = [...baseParas].filter(p => !freshParas.has(p)).length;
            const { result, added } = mergeAtPosition(existingContent, base, md);
            if (result !== existingContent) {
              await app.vault.modify(existing, result);
              await writeCache(app, cachePath, md);
              updated++;
              changeLog.push({ file: page.path, added, deleted: deletedCount, isNew: false });
            }
          }
        } else {
          const dir = filePath.substring(0, filePath.lastIndexOf('/'));
          await ensureFolder(app, dir);
          await writeFile(app, filePath, md);
          await writeCache(app, cachePath, md);
          updated++;
          changeLog.push({ file: page.path, added: [], deleted: 0, isNew: true });
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
      await ensureFolder(app, settings.targetFolder);
      await writeFile(app, indexPath, indexContent);
    }

    if (errors.length > 0) {
      const logPath = `${settings.targetFolder}/doc-sync-errors.md`;
      const logContent = `# 同步错误日志\n\n${new Date().toLocaleString('zh-CN')}\n\n${errors.map(e => `- ${e}`).join('\n')}`;
      const existingLog = app.vault.getAbstractFileByPath(logPath);
      if (existingLog instanceof TFile) await app.vault.modify(existingLog, logContent);
      else await writeFile(app, logPath, logContent);
    }

    settings.lastSynced = new Date().toISOString();
    notice.hide();
    if (changeLog.length > 0) {
      new SyncReportModal(app, changeLog).open();
    } else {
      new Notice(`文档同步完成，无内容变更。`, 4000);
    }
  } catch (e) {
    notice.hide();
    new Notice('文档同步失败：' + e.message);
    throw e;
  }
}
