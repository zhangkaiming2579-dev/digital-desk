import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  type SettingDefinitionItem
} from "obsidian";
import type { DigitalDeskSettings, ProjectCard } from "./types";

export const WEREAD_SECRET_ID = "digital-desk-weread-api-key";

export const DEFAULT_SETTINGS: DigitalDeskSettings = {
  deskName: "Digital Desk",
  tagline: "创作、项目、资料与思考，从这里开始。",
  inboxFolder: "00-inbox",
  projectsFolder: "01-projects",
  notesFolder: "03-notes",
  ideasFolder: "00-inbox/ideas",
  taskFile: "待办清单.md",
  highlightFile: "03-notes/reading/WeRead highlights.md",
  projectCards: [],
  quickLinks: [],
  recentLimit: 3,
  openOnStartup: true,
  showTasks: true,
  showReadingDesk: true,
  wereadShelfLimit: 10,
  wereadSyncMinutes: 15,
  folderUsage: {},
  setupComplete: false
};

export type DigitalDeskHost = Plugin & {
  settings: DigitalDeskSettings;
  saveSettings(): Promise<void>;
  initializeWorkspace(): Promise<void>;
  openDashboard(): Promise<void>;
  refreshDashboard(): Promise<void>;
};

function projectLines(cards: ProjectCard[]): string {
  return cards.map((card) => card.label ? `${card.label} | ${card.path}` : card.path).join("\n");
}

function parseProjectLines(value: string): ProjectCard[] {
  return value.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const separator = line.indexOf("|");
    if (separator < 0) return { path: line };
    const label = line.slice(0, separator).trim();
    const path = line.slice(separator + 1).trim();
    return { path, ...(label ? { label } : {}) };
  }).filter((card) => Boolean(card.path));
}

function requiredPath(value: string): string | undefined {
  return value.trim() ? undefined : "路径不能为空。";
}

export class DigitalDeskSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly host: DigitalDeskHost) {
    super(app, host);
  }

  override getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: "group",
        heading: "工作台",
        cls: "digital-desk-settings",
        items: [
          {
            name: "工作台名称",
            desc: "显示在首页左上角。",
            control: { type: "text", key: "deskName", defaultValue: DEFAULT_SETTINGS.deskName }
          },
          {
            name: "一句话说明",
            desc: "显示在金句下方。",
            control: { type: "text", key: "tagline", defaultValue: DEFAULT_SETTINGS.tagline }
          },
          {
            name: "收件箱目录",
            desc: "临时笔记和待整理内容。",
            control: { type: "folder", key: "inboxFolder", defaultValue: DEFAULT_SETTINGS.inboxFolder, validate: requiredPath }
          },
          {
            name: "项目目录",
            desc: "新项目默认创建在这里。",
            control: { type: "folder", key: "projectsFolder", defaultValue: DEFAULT_SETTINGS.projectsFolder, validate: requiredPath }
          },
          {
            name: "笔记目录",
            desc: "新建笔记时的默认候选目录。",
            control: { type: "folder", key: "notesFolder", defaultValue: DEFAULT_SETTINGS.notesFolder, validate: requiredPath }
          },
          {
            name: "灵感目录",
            desc: "“记录灵感”会直接写入这里。",
            control: { type: "folder", key: "ideasFolder", defaultValue: DEFAULT_SETTINGS.ideasFolder, validate: requiredPath }
          },
          {
            name: "待办文件",
            desc: "读取其中尚未完成的 Markdown 任务。",
            control: { type: "text", key: "taskFile", defaultValue: DEFAULT_SETTINGS.taskFile, validate: requiredPath }
          },
          {
            name: "微信读书划线文件",
            desc: "同步区域会写入这个 Markdown 文件。",
            control: { type: "text", key: "highlightFile", defaultValue: DEFAULT_SETTINGS.highlightFile, validate: requiredPath }
          },
          {
            name: "固定项目",
            desc: "每行一个目录；可以写成“显示名称 | 目录路径”。留空时自动展示最近更新的项目。",
            control: {
              type: "textarea",
              key: "projectCardsText",
              rows: 5,
              placeholder: "内容系列 | 01-projects/content-series\n网站重构 | 01-projects/site"
            }
          },
          {
            name: "快速入口",
            desc: "每行一个文件或目录路径。",
            control: {
              type: "textarea",
              key: "quickLinksText",
              rows: 4,
              placeholder: "03-notes/knowledge-base.md\nassets"
            }
          },
          {
            name: "最近文件数量",
            desc: "首页展示 3–8 个最近打开的 Markdown 文件。",
            control: { type: "slider", key: "recentLimit", min: 3, max: 8, step: 1, defaultValue: 3 }
          },
          {
            name: "启动时打开工作台",
            control: { type: "toggle", key: "openOnStartup", defaultValue: true }
          },
          {
            name: "显示今日待办",
            control: { type: "toggle", key: "showTasks", defaultValue: true }
          }
        ]
      },
      {
        type: "group",
        heading: "微信读书（可选）",
        items: [
          {
            name: "微信读书 API 密钥",
            desc: this.app.secretStorage.getSecret(WEREAD_SECRET_ID)
              ? "已配置。输入新密钥可以替换。"
              : "从微信读书 Skills 页面获取，以 wrk- 开头。密钥保存在 Obsidian 的安全密钥存储中。",
            render: (setting) => this.renderSecretSetting(setting)
          },
          {
            name: "显示阅读台",
            desc: "在首页展示书架、阅读统计和个人划线。",
            control: { type: "toggle", key: "showReadingDesk", defaultValue: true }
          },
          {
            name: "书架展示数量",
            control: { type: "slider", key: "wereadShelfLimit", min: 4, max: 16, step: 1, defaultValue: 10 }
          }
        ]
      },
      {
        type: "group",
        heading: "初始化",
        items: [
          {
            name: "建立工作台目录",
            desc: "创建缺失的目录、待办文件和划线文件；现有内容保持原样。",
            render: (setting) => {
              setting
                .addButton((button) => button.setButtonText("建立目录").setCta().onClick(() => void this.initialize()))
                .addButton((button) => button.setButtonText("打开工作台").onClick(() => void this.host.openDashboard()));
            }
          }
        ]
      }
    ];
  }

  override getControlValue(key: string): unknown {
    if (key === "projectCardsText") return projectLines(this.host.settings.projectCards);
    if (key === "quickLinksText") return this.host.settings.quickLinks.join("\n");
    return (this.host.settings as unknown as Record<string, unknown>)[key];
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === "projectCardsText") {
      this.host.settings.projectCards = parseProjectLines(String(value));
    } else if (key === "quickLinksText") {
      this.host.settings.quickLinks = String(value).split("\n").map((line) => line.trim()).filter(Boolean);
    } else {
      (this.host.settings as unknown as Record<string, unknown>)[key] = value;
    }
    await this.host.saveSettings();
    if ([
      "deskName", "tagline", "projectCardsText", "quickLinksText", "recentLimit",
      "showTasks", "showReadingDesk", "wereadShelfLimit"
    ].includes(key)) await this.host.refreshDashboard();
  }

  private renderSecretSetting(setting: Setting): void {
    let pendingKey = "";
    setting.addText((text) => {
      text.inputEl.type = "password";
      text.setPlaceholder("输入个人 API 密钥");
      text.onChange((value) => { pendingKey = value.trim(); });
    });
    setting.addButton((button) => button.setButtonText("保存").setCta().onClick(() => {
      if (!/^wrk-[A-Za-z0-9_-]{8,}$/.test(pendingKey)) {
        new Notice("密钥格式不正确，请检查后重试。");
        return;
      }
      this.app.secretStorage.setSecret(WEREAD_SECRET_ID, pendingKey);
      new Notice("微信读书密钥已保存。");
      this.update();
    }));
    setting.addButton((button) => button.setButtonText("清除").onClick(() => {
      this.app.secretStorage.setSecret(WEREAD_SECRET_ID, "");
      new Notice("微信读书密钥已清除。");
      this.update();
    }));
  }

  private async initialize(): Promise<void> {
    await this.host.initializeWorkspace();
    new Notice("工作台已准备好。");
  }
}
