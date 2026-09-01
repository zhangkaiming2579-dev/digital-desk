import {
  App,
  FuzzyMatch,
  FuzzySuggestModal,
  Modal,
  Notice,
  Setting,
  TFile,
  TFolder
} from "obsidian";
import type { DigitalDeskSettings } from "./types";
import { folderScore } from "./utils";

export class FolderPickerModal extends FuzzySuggestModal<TFolder> {
  private readonly folders: TFolder[];

  constructor(
    app: App,
    private readonly settings: DigitalDeskSettings,
    purpose: "note" | "project",
    private readonly onChoose: (folder: TFolder) => void
  ) {
    super(app);
    this.setPlaceholder(purpose === "note" ? "选择笔记目录…" : "选择项目的上级目录…");
    const starters = new Set([
      settings.inboxFolder,
      settings.notesFolder,
      settings.projectsFolder,
      settings.ideasFolder,
      ...settings.projectCards.map((card) => card.path)
    ]);
    this.folders = this.app.vault.getAllFolders(true).filter((folder) => {
      if (folder.isRoot()) return false;
      return !folder.path.split("/").some((part) => part.startsWith(".") || part === "node_modules");
    }).sort((left, right) => {
      const leftUsage = settings.folderUsage[left.path];
      const rightUsage = settings.folderUsage[right.path];
      const leftScore = folderScore(leftUsage?.count ?? (starters.has(left.path) ? 1 : 0), leftUsage?.lastUsed ?? 0);
      const rightScore = folderScore(rightUsage?.count ?? (starters.has(right.path) ? 1 : 0), rightUsage?.lastUsed ?? 0);
      return rightScore - leftScore || left.path.localeCompare(right.path, "zh-CN");
    });
    this.setInstructions([
      { command: "↑↓", purpose: "选择" },
      { command: "↵", purpose: "继续" },
      { command: "esc", purpose: "取消" }
    ]);
  }

  getItems(): TFolder[] {
    return this.folders;
  }

  getItemText(item: TFolder): string {
    return item.path;
  }

  override renderSuggestion(match: FuzzyMatch<TFolder>, element: HTMLElement): void {
    const folder = match.item;
    const usage = this.settings.folderUsage[folder.path];
    const row = element.createDiv({ cls: "digital-desk-folder-suggestion" });
    row.createDiv({ cls: "digital-desk-folder-name", text: folder.name });
    row.createDiv({ cls: "digital-desk-folder-path", text: folder.parent?.path || "根目录" });
    if (usage?.count) row.createSpan({ cls: "digital-desk-folder-usage", text: `使用 ${usage.count} 次` });
  }

  onChooseItem(item: TFolder): void {
    this.onChoose(item);
  }
}

export class NameModal extends Modal {
  private value = "";

  constructor(
    app: App,
    private readonly title: string,
    private readonly placeholder: string,
    private readonly actionLabel: string,
    private readonly onSubmit: (value: string) => Promise<void>
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass("digital-desk-name-modal");
    this.contentEl.createEl("h2", { text: this.title });
    const setting = new Setting(this.contentEl).setName("名称");
    setting.addText((text) => {
      text.setPlaceholder(this.placeholder);
      text.inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") void this.submit();
      });
      text.onChange((value) => { this.value = value; });
      window.setTimeout(() => text.inputEl.focus(), 30);
    });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()))
      .addButton((button) => button.setButtonText(this.actionLabel).setCta().onClick(() => void this.submit()));
  }

  private async submit(): Promise<void> {
    if (!this.value.trim()) {
      new Notice("请输入名称。");
      return;
    }
    await this.onSubmit(this.value);
    this.close();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

export class ConfirmModal extends Modal {
  constructor(
    app: App,
    private readonly title: string,
    private readonly message: string,
    private readonly confirmLabel: string,
    private readonly onConfirm: () => Promise<void>
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass("digital-desk-confirm-modal");
    this.contentEl.createEl("h2", { text: this.title });
    this.contentEl.createEl("p", { text: this.message });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()))
      .addButton((button) => {
        button.setButtonText(this.confirmLabel).setDestructive().setCta().onClick(async () => {
          await this.onConfirm();
          this.close();
        });
      });
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

export class RenameFileModal extends NameModal {
  constructor(app: App, file: TFile, onRename: (nextName: string) => Promise<void>) {
    super(app, `重命名“${file.basename}”`, file.basename, "重命名", onRename);
  }
}

type SetupPaths = Pick<
  DigitalDeskSettings,
  "inboxFolder" | "projectsFolder" | "notesFolder" | "ideasFolder" | "taskFile" | "highlightFile"
>;

export class WorkspaceSetupModal extends Modal {
  private readonly values: SetupPaths;

  constructor(
    app: App,
    settings: DigitalDeskSettings,
    private readonly onSubmit: (values: SetupPaths) => Promise<void>
  ) {
    super(app);
    this.values = {
      inboxFolder: settings.inboxFolder,
      projectsFolder: settings.projectsFolder,
      notesFolder: settings.notesFolder,
      ideasFolder: settings.ideasFolder,
      taskFile: settings.taskFile,
      highlightFile: settings.highlightFile
    };
  }

  override onOpen(): void {
    this.modalEl.addClass("digital-desk-setup-modal");
    this.contentEl.createDiv({ cls: "digital-desk-setup-kicker", text: "DIGITAL DESK / FIRST RUN" });
    this.contentEl.createEl("h2", { text: "设置你的工作台" });
    this.contentEl.createEl("p", {
      cls: "digital-desk-setup-intro",
      text: "确认常用目录后，插件会补齐缺失的目录和起始文件。已有内容会保持原样。"
    });

    this.pathSetting("收件箱", "临时笔记和待整理内容", "inboxFolder");
    this.pathSetting("项目目录", "新项目会优先建议这里", "projectsFolder");
    this.pathSetting("笔记目录", "长期笔记与知识资料", "notesFolder");
    this.pathSetting("灵感目录", "首页“记录灵感”的存放位置", "ideasFolder");
    this.pathSetting("待办文件", "首页读取其中未完成的 Markdown 任务", "taskFile");
    this.pathSetting("阅读划线文件", "可选的微信读书划线归档位置", "highlightFile");

    const actions = new Setting(this.contentEl);
    actions.settingEl.addClass("digital-desk-setup-actions");
    actions
      .addButton((button) => button.setButtonText("稍后设置").onClick(() => this.close()))
      .addButton((button) => button.setButtonText("建立工作台").setCta().onClick(() => void this.submit()));
  }

  private pathSetting(
    name: string,
    description: string,
    key: keyof SetupPaths
  ): void {
    new Setting(this.contentEl)
      .setName(name)
      .setDesc(description)
      .addText((text) => {
        text.setValue(this.values[key]);
        text.onChange((value) => { this.values[key] = value.trim(); });
      });
  }

  private async submit(): Promise<void> {
    if (Object.values(this.values).some((value) => !value)) {
      new Notice("请填写全部目录与文件路径。后续可以在插件设置中修改。");
      return;
    }
    await this.onSubmit({ ...this.values });
    this.close();
    new Notice("工作台已准备好。");
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}

export class WeReadSetupModal extends Modal {
  private value = "";

  constructor(
    app: App,
    private readonly configured: boolean,
    private readonly onSave: (value: string) => Promise<void>,
    private readonly onClear: () => Promise<void>
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass("digital-desk-name-modal");
    this.contentEl.createEl("h2", { text: "配置阅读台" });
    this.contentEl.createEl("p", {
      text: this.configured
        ? "微信读书 API 密钥已配置。输入新密钥可以替换。"
        : "输入个人微信读书 API 密钥。密钥会保存在 Obsidian 的安全密钥存储中。"
    });
    const keySetting = new Setting(this.contentEl).setName("API 密钥");
    keySetting.addText((text) => {
      text.inputEl.type = "password";
      text.setPlaceholder("输入个人 API 密钥");
      text.onChange((value) => { this.value = value.trim(); });
    });
    const actions = new Setting(this.contentEl);
    if (this.configured) {
      actions.addButton((button) => button.setButtonText("清除密钥").setDestructive().onClick(() => void this.clear()));
    }
    actions
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()))
      .addButton((button) => button.setButtonText("保存").setCta().onClick(() => void this.save()));
  }

  private async save(): Promise<void> {
    if (!/^wrk-[A-Za-z0-9_-]{8,}$/.test(this.value)) {
      new Notice("密钥格式不正确，请检查后重试。");
      return;
    }
    await this.onSave(this.value);
    this.close();
    new Notice("阅读台密钥已保存。");
  }

  private async clear(): Promise<void> {
    await this.onClear();
    this.close();
    new Notice("阅读台密钥已清除。");
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
