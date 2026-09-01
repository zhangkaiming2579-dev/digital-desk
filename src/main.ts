import { Notice, Plugin, TFile, TFolder, normalizePath } from "obsidian";
import { DigitalDeskView, DIGITAL_DESK_VIEW } from "./dashboard-view";
import { FolderPickerModal, NameModal, WeReadSetupModal, WorkspaceSetupModal } from "./modals";
import {
  DEFAULT_SETTINGS,
  DigitalDeskSettingTab,
  WEREAD_SECRET_ID,
  type DigitalDeskHost
} from "./settings";
import type { DigitalDeskSettings, PluginData, ReadingSummary } from "./types";
import { joinPath, sanitizeName } from "./utils";
import { WeReadService } from "./weread";

export default class DigitalDeskPlugin extends Plugin implements DigitalDeskHost {
  override settings: DigitalDeskSettings = { ...DEFAULT_SETTINGS };
  quoteOffset = 0;
  private readingCache?: ReadingSummary;
  private weRead!: WeReadService;
  private renderQueued = false;

  override async onload(): Promise<void> {
    await this.loadPluginData();
    this.weRead = new WeReadService(this.app, this.settings, {
      getReadingCache: () => this.readingCache,
      setReadingCache: async (cache) => {
        this.readingCache = cache;
        await this.savePluginData();
      }
    });

    this.registerView(DIGITAL_DESK_VIEW, (leaf) => new DigitalDeskView(leaf, this));
    this.addRibbonIcon("home", "Open digital desk", () => void this.openDashboard());
    this.addCommand({ id: "open-dashboard", name: "Open dashboard", callback: () => void this.openDashboard() });
    this.addCommand({ id: "create-note", name: "Create note", callback: () => this.createNote() });
    this.addCommand({ id: "create-project", name: "Create project", callback: () => this.createProject() });
    this.addCommand({ id: "capture-idea", name: "Capture idea", callback: () => void this.captureIdea() });
    this.addCommand({ id: "sync-weread", name: "Sync reading data", callback: () => void this.syncWeReadCommand() });
    this.addCommand({ id: "open-settings", name: "Open settings", callback: () => this.openSettings() });
    this.addSettingTab(new DigitalDeskSettingTab(this.app, this));

    this.registerEvent(this.app.vault.on("create", () => this.queueRender()));
    this.registerEvent(this.app.vault.on("delete", () => this.queueRender()));
    this.registerEvent(this.app.vault.on("rename", () => this.queueRender()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.queueRender()));

    this.app.workspace.onLayoutReady(() => {
      void (async () => {
        if (this.settings.openOnStartup) await this.openDashboard();
        if (!this.settings.setupComplete) window.setTimeout(() => this.openSettings(), 250);
      })();
    });
  }

  async openDashboard(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(DIGITAL_DESK_VIEW)[0];
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      const view = existing.view;
      if (view instanceof DigitalDeskView) await view.render();
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: DIGITAL_DESK_VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  async refreshDashboard(): Promise<void> {
    const views = this.app.workspace.getLeavesOfType(DIGITAL_DESK_VIEW)
      .map((leaf) => leaf.view).filter((view): view is DigitalDeskView => view instanceof DigitalDeskView);
    await Promise.all(views.map((view) => view.render()));
  }

  createNote(): void {
    new FolderPickerModal(this.app, this.settings, "note", (folder) => {
      new NameModal(this.app, `在“${folder.path}”新建笔记`, "笔记标题", "创建", async (value) => {
        const name = sanitizeName(value);
        if (!name) throw new Error("笔记标题不能为空。");
        const path = await this.uniqueMarkdownPath(folder.path, name);
        const now = new Date().toISOString();
        const file = await this.app.vault.create(path, `---\ncreated: ${now}\n---\n\n# ${value.trim()}\n\n`);
        await this.recordFolderUse(folder.path);
        await this.app.workspace.getLeaf("tab").openFile(file);
      }).open();
    }).open();
  }

  createProject(): void {
    new FolderPickerModal(this.app, this.settings, "project", (folder) => {
      new NameModal(this.app, `在“${folder.path}”新建项目`, "项目名称", "创建项目", async (value) => {
        const name = sanitizeName(value);
        if (!name) throw new Error("项目名称不能为空。");
        const path = normalizePath(joinPath(folder.path, name));
        if (this.app.vault.getAbstractFileByPath(path)) {
          new Notice("同名项目已经存在。");
          return;
        }
        await this.ensureFolder(path);
        const index = await this.app.vault.create(joinPath(path, "README.md"), [
          "---", `created: ${new Date().toISOString()}`, "status: active", "---", "", `# ${value.trim()}`, "",
          "## 目标", "", "", "## 下一步", "", "- [ ] ", ""
        ].join("\n"));
        await this.recordFolderUse(folder.path);
        await this.app.workspace.getLeaf("tab").openFile(index);
      }).open();
    }).open();
  }

  async captureIdea(): Promise<void> {
    await this.ensureFolder(this.settings.ideasFolder);
    new NameModal(this.app, "记录灵感", "一句话标题", "记下来", async (value) => {
      const name = sanitizeName(value);
      if (!name) throw new Error("标题不能为空。");
      const stamp = this.fileTimestamp(new Date());
      const path = await this.uniqueMarkdownPath(this.settings.ideasFolder, `${stamp}-${name}`);
      const file = await this.app.vault.create(path, [
        "---", `created: ${new Date().toISOString()}`, "type: idea", "---", "", `# ${value.trim()}`, "", ""
      ].join("\n"));
      await this.app.workspace.getLeaf("tab").openFile(file);
    }).open();
  }

  async initializeWorkspace(): Promise<void> {
    for (const folder of [
      this.settings.inboxFolder,
      this.settings.projectsFolder,
      this.settings.notesFolder,
      this.settings.ideasFolder
    ]) await this.ensureFolder(folder);
    await this.ensureFile(this.settings.taskFile, "# 待办清单\n\n- [ ] 从 Digital Desk 开始今天的工作\n");
    await this.ensureFile(this.settings.highlightFile, [
      "---", "tags:", "  - reading", "  - weread", "---", "", "# WeRead highlights", "",
      "<!-- digital-desk-weread:start -->", "尚未同步微信读书划线。", "<!-- digital-desk-weread:end -->", "", "## My notes", ""
    ].join("\n"));
    this.settings.setupComplete = true;
    await this.saveSettings();
    await this.refreshDashboard();
  }

  async refreshWeRead(force: boolean): Promise<ReadingSummary> {
    return this.weRead.sync(force);
  }

  getReadingCache(): ReadingSummary | undefined {
    return this.readingCache;
  }

  openSettings(): void {
    new WorkspaceSetupModal(this.app, this.settings, async (values) => {
      Object.assign(this.settings, values);
      await this.initializeWorkspace();
    }).open();
  }

  openReadingSettings(): void {
    new WeReadSetupModal(
      this.app,
      Boolean(this.app.secretStorage.getSecret(WEREAD_SECRET_ID)),
      async (value) => {
        this.app.secretStorage.setSecret(WEREAD_SECRET_ID, value);
        await this.refreshDashboard();
      },
      async () => {
        this.app.secretStorage.setSecret(WEREAD_SECRET_ID, "");
        await this.refreshDashboard();
      }
    ).open();
  }

  async saveSettings(): Promise<void> {
    await this.savePluginData();
  }

  private async syncWeReadCommand(): Promise<void> {
    try {
      await this.refreshWeRead(true);
      await this.refreshDashboard();
      new Notice("微信读书已同步。");
    } catch (error) {
      new Notice(error instanceof Error ? error.message : "微信读书同步失败。");
    }
  }

  private async loadPluginData(): Promise<void> {
    const loaded = await this.loadData() as PluginData | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...(loaded?.settings ?? {}),
      folderUsage: loaded?.settings?.folderUsage ?? {},
      projectCards: loaded?.settings?.projectCards ?? [],
      quickLinks: loaded?.settings?.quickLinks ?? []
    };
    this.readingCache = loaded?.readingCache;
  }

  private async savePluginData(): Promise<void> {
    const data: PluginData = { settings: this.settings, ...(this.readingCache ? { readingCache: this.readingCache } : {}) };
    await this.saveData(data);
  }

  private queueRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    window.setTimeout(() => {
      this.renderQueued = false;
      void this.refreshDashboard();
    }, 120);
  }

  private async recordFolderUse(path: string): Promise<void> {
    const current = this.settings.folderUsage[path] ?? { count: 0, lastUsed: 0 };
    this.settings.folderUsage[path] = { count: current.count + 1, lastUsed: Date.now() };
    await this.saveSettings();
  }

  private async uniqueMarkdownPath(folder: string, name: string): Promise<string> {
    const base = normalizePath(joinPath(folder, name));
    let candidate = `${base}.md`;
    let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(candidate)) candidate = `${base} ${suffix++}.md`;
    return candidate;
  }

  private async ensureFolder(path: string): Promise<void> {
    const normalized = normalizePath(path);
    if (!normalized) return;
    const segments = normalized.split("/");
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing instanceof TFile) throw new Error(`无法创建目录：${current} 已经是文件。`);
      if (!existing) await this.app.vault.createFolder(current);
    }
  }

  private async ensureFile(path: string, content: string): Promise<void> {
    const normalized = normalizePath(path);
    const parent = normalized.split("/").slice(0, -1).join("/");
    if (parent) await this.ensureFolder(parent);
    const existing = this.app.vault.getAbstractFileByPath(normalized);
    if (existing instanceof TFolder) throw new Error(`无法创建文件：${normalized} 已经是目录。`);
    if (!existing) await this.app.vault.create(normalized, content);
  }

  private fileTimestamp(date: Date): string {
    const parts = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ];
    const time = `${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}`;
    return `${parts.join("-")}-${time}`;
  }
}
