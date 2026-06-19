import { Plugin } from 'obsidian';
import { DocSyncSettings, DEFAULT_SETTINGS, DocSyncSettingTab } from './settings';
import { syncDocs } from './sync';

export default class DocSyncPlugin extends Plugin {
  settings: DocSyncSettings;
  private intervalHandle: number | null = null;

  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: 'sync-now',
      name: '立即同步文档',
      callback: () => syncDocs(this.app, this.settings).then(() => this.saveSettings()),
    });

    this.addSettingTab(new DocSyncSettingTab(this.app, this));

    this.registerObsidianProtocolHandler('doc-sync-callback', async (params) => {
      const code = params.code;
      if (!code) return;
      const { TencentProvider } = await import('./providers/tencent');
      const tokens = await TencentProvider.getTokens(
        this.settings.tencentClientId,
        this.settings.tencentClientSecret,
        code
      );
      this.settings.tencentAccessToken = tokens.access_token;
      this.settings.tencentRefreshToken = tokens.refresh_token;
      await this.saveSettings();
    });

    this.scheduleSync();
  }

  onunload() {
    if (this.intervalHandle !== null) window.clearInterval(this.intervalHandle);
  }

  reschedule() {
    if (this.intervalHandle !== null) {
      window.clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.scheduleSync();
  }

  private scheduleSync() {
    const ms = this.settings.intervalMinutes * 60_000;
    if (ms > 0) {
      this.intervalHandle = this.registerInterval(
        window.setInterval(() => syncDocs(this.app, this.settings).then(() => this.saveSettings()), ms)
      );
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
