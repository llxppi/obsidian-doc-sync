# obsidian-doc-sync

将腾讯文档同步到 Obsidian 的插件，支持增量更新、图片提取和超链接保留。

## 功能

- 将腾讯文档（docs.qq.com）导出为 Markdown 并保存到 Vault
- 自动解析 DOCX，保留标题、列表、表格、超链接
- 图片提取并保存为本地文件（`{目标文件夹}/{文档名}/assets/`）
- **增量更新**：对比上次同步内容，仅将新增段落插入原文对应位置，不覆盖用户在 Obsidian 中的注释
- 更新后弹窗提示新增段落预览
- 支持定时自动同步
- 自动生成目录索引（`index.md`）

## 安装

1. 将插件文件夹复制到 `{Vault}/.obsidian/plugins/obsidian-doc-sync/`
2. 在 Obsidian 设置 → 第三方插件中启用

## 配置

前往 设置 → 文档同步设置：

| 项目 | 说明 |
|------|------|
| 文档来源 URL | 腾讯文档的完整网址 |
| 目标文件夹 | 同步到 Vault 的哪个文件夹（默认 `Docs`） |
| 自动同步间隔 | 分钟数，0 表示仅手动同步 |
| Client-Id | 腾讯文档开放平台 → 开发者信息 |
| Access-Token | 授权后获取，注意有效期 |
| Open-Id | 授权后获取 |

### 获取腾讯文档 API 凭证

1. 前往 [腾讯文档开放平台](https://docs.qq.com/open/wiki/)
2. 创建应用，获取 `Client-Id`
3. 完成 OAuth 授权流程，获取 `Access-Token` 和 `Open-Id`

> **注意**：腾讯文档导出接口每用户每天限 **9 次**，请勿将自动同步间隔设置过短。

## 使用

- 配置完成后，点击左侧栏的同步按钮或使用命令面板执行「同步文档」
- 同步完成后，文档保存在目标文件夹，图片保存在 `{目标文件夹}/{文档名}/assets/`
- 同步缓存存储在 `{目标文件夹}/.cache/`（无需手动管理）
- 若同步出错，错误详情记录在 `{目标文件夹}/doc-sync-errors.md`

## 增量更新说明

- **首次同步**：直接创建文件
- **后续同步**：与上次同步的原文对比，仅将新段落插入对应位置，用户添加的批注不受影响
- 每次有新增内容时弹窗显示新增段落数量及预览

## 依赖

- [mammoth](https://github.com/mwilliamson/mammoth.js)：DOCX → HTML
- [turndown](https://github.com/mixmark-io/turndown)：HTML → Markdown
