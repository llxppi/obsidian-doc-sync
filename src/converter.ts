import TurndownService from 'turndown';

const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });

// Preserve <br> as newline
td.addRule('br', {
  filter: 'br',
  replacement: () => '\n',
});

export function htmlToMarkdown(html: string): string {
  return td.turndown(html);
}
