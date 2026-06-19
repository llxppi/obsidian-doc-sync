export interface DocPage {
  path: string;
  title: string;
  lastModified?: string;
}

export interface DocProvider {
  fetchPages(url: string): Promise<DocPage[]>;
  fetchContent(page: DocPage): Promise<string>; // returns HTML or Markdown
}
