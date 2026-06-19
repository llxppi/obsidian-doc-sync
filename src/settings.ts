import { App, PluginSettingTab, Setting } from 'obsidian';
import type DocSyncPlugin from './main';

export interface DocSyncSettings {
  sourceUrl: string;
  targetFolder: string;
  provider: 'auto' | 'tencent' | 'generic';
  intervalMinutes: number;
  tencentAccessToken: string;
  tencentClientId: string;
  tencentOpenId: string;
  lastSynced: string;
}

export const DEFAULT_SETTINGS: DocSyncSettings = {
  sourceUrl: '',
  targetFolder: 'Docs',
  provider: 'auto',
  intervalMinutes: 0,
  tencentAccessToken: '',
  tencentClientId: '',
  tencentOpenId: '',
  lastSynced: '',
};

export class DocSyncSettingTab extends PluginSettingTab {
  plugin: DocSyncPlugin;
  constructor(app: App, plugin: DocSyncPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: '文档同步设置' });

    new Setting(containerEl)
      .setName('文档来源 URL')
      .setDesc('要同步的在线文档网址。')
      .addText(t => t.setValue(this.plugin.settings.sourceUrl)
        .onChange(async v => { this.plugin.settings.sourceUrl = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('目标文件夹')
      .setDesc('同步后的文档保存路径（相对于 Vault 根目录）。')
      .addText(t => t.setValue(this.plugin.settings.targetFolder)
        .onChange(async v => { this.plugin.settings.targetFolder = v; await this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('数据来源类型')
      .addDropdown(d => d
        .addOption('auto', '自动识别')
        .addOption('tencent', '腾讯文档')
        .addOption('generic', '通用网站（SSR）')
        .setValue(this.plugin.settings.provider)
        .onChange(async v => {
          this.plugin.settings.provider = v as DocSyncSettings['provider'];
          await this.plugin.saveSettings();
          this.display();
        }));

    new Setting(containerEl)
      .setName('自动同步间隔（分钟）')
      .setDesc('设为 0 则仅手动同步。注意：导出接口每用户每天限 9 次。')
      .addText(t => t.setValue(String(this.plugin.settings.intervalMinutes))
        .onChange(async v => {
          this.plugin.settings.intervalMinutes = parseInt(v) || 0;
          await this.plugin.saveSettings();
          this.plugin.reschedule();
        }));

    if (this.plugin.settings.lastSynced) {
      containerEl.createEl('p', {
        text: `上次同步：${new Date(this.plugin.settings.lastSynced).toLocaleString('zh-CN')}`,
        cls: 'setting-item-description',
      });
    }

    if (this.plugin.settings.provider !== 'generic') {
      containerEl.createEl('h3', { text: '腾讯文档 API 凭证' });
      containerEl.createEl('p', {
        text: '三项均来自开放平台控制台 → 开发者信息',
        cls: 'setting-item-description',
      });

      for (const [key, label, desc] of [
        ['tencentClientId', 'Client-Id（应用ID）', 'client_id'],
        ['tencentAccessToken', 'Access-Token', 'access_token，注意有效期'],
        ['tencentOpenId', 'Open-Id', 'open_id'],
      ] as const) {
        new Setting(containerEl)
          .setName(label)
          .setDesc(desc)
          .addText(t => {
            if (key === 'tencentAccessToken') t.inputEl.type = 'password';
            t.setValue(this.plugin.settings[key])
              .onChange(async v => {
                (this.plugin.settings as any)[key] = v;
                await this.plugin.saveSettings();
              });
          });
      }

      const allSet = this.plugin.settings.tencentAccessToken &&
        this.plugin.settings.tencentClientId &&
        this.plugin.settings.tencentOpenId;
      if (allSet) {
        containerEl.createEl('p', { text: '状态：凭证已配置 ✓', cls: 'setting-item-description' });
      }
    }
  }
}
