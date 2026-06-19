import { requestUrl } from 'obsidian';
import { DocPage, DocProvider } from './base';
import { htmlToMarkdown } from '../converter';

// Generic provider for SSR/static documentation sites (Gitbook, Docusaurus, etc.)
export class GenericProvider implements DocProvider {
  async fetchPages(url: string): Promise<DocPage[]> {
    const resp = await requestUrl({ url, timeout: 30000 });
    const html = resp.text;

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const base = new URL(url);
    const pages: DocPage[] = [];

    // Look for nav links (common doc site patterns)
    const selectors = ['nav a', 'aside a', '.sidebar a', '.toc a', '[role="navigation"] a'];
    let links: NodeListOf<HTMLAnchorElement> | null = null;
    for (const sel of selectors) {
      const found = doc.querySelectorAll<HTMLAnchorElement>(sel);
      if (found.length > 0) { links = found; break; }
    }

    if (!links || links.length === 0) {
      // Single page: treat the whole URL as one page
      const title = doc.title || url;
      return [{ path: sanitizePath(title), title, lastModified: undefined }];
    }

    const seen = new Set<string>();
    for (const a of Array.from(links)) {
      try {
        const href = new URL(a.href, base).href;
        if (!href.startsWith(base.origin) || seen.has(href)) continue;
        seen.add(href);
        const title = a.textContent?.trim() || href;
        const path = href.replace(base.origin, '').replace(/^\//, '').replace(/\/$/, '') || 'index';
        pages.push({ path: sanitizePath(path), title });
      } catch { /* invalid href */ }
    }

    return pages.length > 0 ? pages : [{ path: 'index', title: doc.title || url }];
  }

  async fetchContent(page: DocPage & { url?: string }): Promise<string> {
    const url = page.url ?? page.path;
    const resp = await requestUrl({ url, timeout: 30000 });
    const parser = new DOMParser();
    const doc = parser.parseFromString(resp.text, 'text/html');

    // Extract main content
    const main =
      doc.querySelector('main') ??
      doc.querySelector('article') ??
      doc.querySelector('.content') ??
      doc.querySelector('#content') ??
      doc.body;

    return htmlToMarkdown(main?.innerHTML ?? '');
  }
}

function sanitizePath(p: string): string {
  return p.replace(/[\\:*?"<>|]/g, '_').replace(/\s+/g, '-');
}
