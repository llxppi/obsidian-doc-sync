import { requestUrl, Notice } from 'obsidian';
import mammoth from 'mammoth';
import { DocPage, DocProvider } from './base';
import { htmlToMarkdown } from '../converter';

export interface TencentAuth {
  accessToken: string;
  clientId: string;
  openId: string;
}

const BASE = 'https://docs.qq.com';

const RET_MSG: Record<number, string> = {
  9998: '请求调用次数超过限制', 10002: '参数错误', 10005: '身份校验失败',
  10007: '操作权限不足', 10011: '用户无操作权限', 10059: '用户存储空间不足',
  10102: '文档不存在', 10103: '文档类型错误', 10104: '文档 ID 错误',
  10129: '文档状态错误', 10301: 'Token 校验错误', 10302: 'Client ID 校验错误',
  10303: 'Open ID 校验错误', 37019: 'Token 已过期', 37029: '用户已取消授权',
};

function retMsg(ret: number, fallback?: string): string {
  return RET_MSG[ret] ?? fallback ?? `错误码 ${ret}`;
}

function authHeaders(auth: TencentAuth) {
  return {
    'Access-Token': auth.accessToken,
    'Client-Id': auth.clientId,
    'Open-Id': auth.openId,
  };
}

async function get(path: string, auth: TencentAuth) {
  try {
    const r = await requestUrl({ url: `${BASE}${path}`, headers: authHeaders(auth) });
    return r.json;
  } catch (e: any) {
    throw new Error(`GET ${path} [${e?.status ?? '无响应'}]: ${e?.text ?? e?.message ?? ''}`);
  }
}

async function post(path: string, auth: TencentAuth, formBody: string) {
  try {
    const r = await requestUrl({
      url: `${BASE}${path}`,
      method: 'POST',
      headers: { ...authHeaders(auth), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody,
    });
    return r.json;
  } catch (e: any) {
    if (e?.status === 429) throw new Error('导出次数已达今日上限（每用户每天 9 次），请明日再试');
    throw new Error(`POST ${path} [${e?.status ?? '无响应'}]: ${e?.text ?? e?.message ?? ''}`);
  }
}

export class TencentProvider implements DocProvider {
  constructor(private auth: TencentAuth) {}

  static extractDocId(url: string): string {
    const match = url.match(/docs\.qq\.com\/(?:doc|sheet|slide)\/([A-Za-z0-9]+)/);
    if (!match) throw new Error('无效的腾讯文档 URL');
    return match[1];
  }

  async fetchPages(url: string): Promise<DocPage[]> {
    const fileId = await this.toFileId(TencentProvider.extractDocId(url));
    const res = await get(`/openapi/drive/v2/files/${fileId}/metadata`, this.auth);
    if (res.ret !== 0) throw new Error(`获取文档信息失败：${retMsg(res.ret, res.msg)}`);
    const title = res.data?.title ?? fileId;
    const path = title.replace(/[*"\\/<>:|?]/g, '_');
    return [{ path, title, lastModified: res.data?.modifiedTime }];
  }

  async fetchContent(page: DocPage & { docId?: string }): Promise<string> {
    const fileId = await this.toFileId(page.docId ?? page.path);

    const exportRes = await post(`/openapi/drive/v2/files/${fileId}/async-export`, this.auth, '');
    if (exportRes.ret !== 0) throw new Error(`导出启动失败：${retMsg(exportRes.ret, exportRes.msg)}`);
    const operationId: string = exportRes.data.operationID;

    for (let i = 0; i < 800; i++) {
      await sleep(1000);
      const p = await get(
        `/openapi/drive/v2/files/${fileId}/export-progress?operationID=${encodeURIComponent(operationId)}`,
        this.auth
      );
      if (p.ret !== 0) {
        if (p.msg?.includes('Key Not Found'))
          throw new Error('导出任务已过期（腾讯文档每日导出上限 9 次），请稍后手动重试');
        throw new Error(`查询进度失败：${retMsg(p.ret, p.msg)}`);
      }
      if (p.data?.progress === 100 && p.data?.url) {
        const file = await requestUrl({ url: p.data.url });
        const { value: html } = await mammoth.convertToHtml({ arrayBuffer: file.arrayBuffer });
        return htmlToMarkdown(html);
      }
    }
    throw new Error('导出超时，请重试');
  }

  private async toFileId(shortId: string): Promise<string> {
    if (shortId.includes('$')) return shortId;
    // type=2: encodedID → fileID
    const res = await get(
      `/openapi/drive/v2/util/converter?type=2&value=${encodeURIComponent(shortId)}`,
      this.auth
    );
    if (res.ret !== 0) throw new Error(`fileID 转换失败：${retMsg(res.ret, res.msg)}`);
    return res.data.fileID;
  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
