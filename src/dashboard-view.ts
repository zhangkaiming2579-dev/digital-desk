import {
  ItemView,
  Menu,
  Notice,
  setIcon,
  TAbstractFile,
  TFile,
  TFolder,
  WorkspaceLeaf
} from "obsidian";
import type { DigitalDeskSettings, ReadingSummary, WeReadBook, WeReadHighlight } from "./types";
import { ConfirmModal, RenameFileModal } from "./modals";
import { formatDuration, formatRelativeTime, quoteForHour, sanitizeName } from "./utils";

export const DIGITAL_DESK_VIEW = "digital-desk-view";

export interface DashboardHost {
  settings: DigitalDeskSettings;
  quoteOffset: number;
  app: ItemView["app"];
  createNote(): void;
  createProject(): void;
  captureIdea(): Promise<void>;
  refreshWeRead(force: boolean): Promise<ReadingSummary>;
  getReadingCache(): ReadingSummary | undefined;
  openSettings(): void;
  openReadingSettings(): void;
}

export class DigitalDeskView extends ItemView {
  private disposed = false;

  constructor(leaf: WorkspaceLeaf, private readonly host: DashboardHost) {
    super(leaf);
  }

  getViewType(): string {
    return DIGITAL_DESK_VIEW;
  }

  getDisplayText(): string {
    return this.host.settings.deskName || "Digital Desk";
  }

  override getIcon(): string {
    return "home";
  }

  override async onOpen(): Promise<void> {
    this.disposed = false;
    await this.render();
  }

  override async onClose(): Promise<void> {
    this.disposed = true;
    this.contentEl.empty();
  }

  async render(): Promise<void> {
    if (this.disposed) return;
    this.contentEl.empty();
    this.contentEl.addClass("digital-desk-view");
    const page = this.contentEl.createDiv({ cls: "digital-desk-page" });
    this.renderHero(page);
    this.renderActions(page);
    this.renderRecent(page);
    if (this.host.settings.showReadingDesk) await this.renderReading(page);
    this.renderProjects(page);
    if (this.host.settings.showTasks) await this.renderTasks(page);
    this.renderQuickLinks(page);
    const footer = page.createEl("footer", { cls: "digital-desk-footer" });
    footer.createSpan({ text: "DIGITAL DESK" });
    footer.createSpan({ text: "让重要的事保持可见" });
  }

  private renderHero(page: HTMLElement): void {
    const cache = this.host.getReadingCache();
    const highlight = this.hourlyHighlight(cache?.highlights ?? []);
    const hero = page.createEl("section", { cls: "digital-desk-hero" });
    hero.createDiv({ cls: "digital-desk-brand", text: this.host.settings.deskName || "Digital Desk" });
    const quoteButton = hero.createDiv({
      cls: "digital-desk-quote-button",
      attr: { role: "button", tabindex: "0", "aria-label": "换一句" }
    });
    const quote = quoteButton.createDiv({ cls: "digital-desk-quote" });
    quote.setText(highlight?.text || quoteForHour(Date.now(), this.host.quoteOffset));
    const source = quoteButton.createDiv({ cls: "digital-desk-quote-source" });
    source.setText(highlight ? `《${highlight.bookTitle}》${highlight.author ? ` · ${highlight.author}` : ""}` : "每小时换一句 · 单击刷新");
    quoteButton.addEventListener("click", () => {
      this.host.quoteOffset += 1;
      void this.render();
    });
    quoteButton.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      this.host.quoteOffset += 1;
      void this.render();
    });
    if (highlight) {
      source.addEventListener("click", (event) => {
        event.stopPropagation();
        void this.openHighlight(highlight);
      });
    }
    hero.createDiv({ cls: "digital-desk-tagline", text: this.host.settings.tagline });
    const heroLinks = hero.createDiv({ cls: "digital-desk-hero-links" });
    this.smallLink(heroLinks, "查看待办", "circle-check", () => void this.openPath(this.host.settings.taskFile));
    this.smallLink(heroLinks, "打开项目", "folder-kanban", () => void this.openPath(this.host.settings.projectsFolder));
    this.smallLink(heroLinks, "设置工作台", "sliders-horizontal", () => this.host.openSettings());
  }

  private hourlyHighlight(highlights: WeReadHighlight[]): WeReadHighlight | undefined {
    if (!highlights.length) return undefined;
    const index = ((Math.floor(Date.now() / 3600000) + this.host.quoteOffset) % highlights.length + highlights.length) % highlights.length;
    return highlights[index];
  }

  private renderActions(page: HTMLElement): void {
    const section = page.createEl("section", { cls: "digital-desk-actions" });
    section.createDiv({ cls: "digital-desk-actions-label", text: "开始工作" });
    this.actionButton(section, "新建笔记", "file-plus-2", "primary", () => this.host.createNote());
    this.actionButton(section, "新建项目", "folder-plus", "secondary", () => this.host.createProject());
    this.actionButton(section, "记录灵感", "lightbulb", "quiet", () => void this.host.captureIdea());
    this.actionButton(section, "查看待办", "circle-check", "quiet", () => void this.openPath(this.host.settings.taskFile));
    this.actionButton(section, "全库搜索", "search", "quiet", () => {
      void this.app.workspace.getLeaf("tab").setViewState({ type: "search", active: true });
    });
    this.actionButton(section, "关系图谱", "waypoints", "quiet", () => {
      void this.app.workspace.getLeaf("tab").setViewState({ type: "graph", active: true });
    });
  }

  private renderRecent(page: HTMLElement): void {
    const section = page.createEl("section", { cls: "digital-desk-section" });
    this.sectionHeading(section, "最近文件", "RECENT FILES");
    const grid = section.createDiv({ cls: "digital-desk-recent-grid" });
    const files = this.recentFiles();
    if (!files.length) {
      this.emptyState(grid, "最近打开的笔记会出现在这里。", "新建第一篇笔记", () => this.host.createNote());
      return;
    }
    files.forEach((file, index) => {
      const item = grid.createEl("button", { cls: `digital-desk-recent is-${index % 3}`, attr: { type: "button" } });
      item.createSpan({ cls: "digital-desk-index", text: String(index + 1).padStart(2, "0") });
      const copy = item.createDiv({ cls: "digital-desk-recent-copy" });
      copy.createDiv({ cls: "digital-desk-recent-name", text: file.basename });
      copy.createDiv({ cls: "digital-desk-recent-path", text: file.parent?.path || "根目录" });
      item.createSpan({ cls: "digital-desk-recent-time", text: formatRelativeTime(file.stat.mtime) });
      const arrow = item.createSpan({ cls: "digital-desk-arrow" });
      setIcon(arrow, "arrow-up-right");
      item.addEventListener("click", () => void this.app.workspace.getLeaf("tab").openFile(file));
      item.addEventListener("contextmenu", (event) => this.openFileMenu(event, file));
    });
  }

  private async renderReading(page: HTMLElement): Promise<void> {
    const section = page.createEl("section", { cls: "digital-desk-section digital-desk-reading" });
    const heading = this.sectionHeading(section, "阅读台", "READING DESK");
    const sync = heading.createEl("button", { cls: "digital-desk-sync", attr: { type: "button", "aria-label": "同步微信读书" } });
    setIcon(sync, "refresh-cw");
    sync.addEventListener("click", () => void this.syncReading(sync));

    if (!this.host.getReadingCache() && !this.app.secretStorage.getSecret("digital-desk-weread-api-key")) {
      const panel = section.createDiv({ cls: "digital-desk-reading-empty" });
      panel.createDiv({ cls: "digital-desk-reading-monogram", text: "WR" });
      const copy = panel.createDiv();
      copy.createEl("h3", { text: "把阅读带回创作现场" });
      copy.createEl("p", { text: "配置微信读书后，在这里查看书架、阅读统计和个人划线。" });
      const configure = copy.createEl("button", { text: "配置阅读台", attr: { type: "button" } });
      configure.addEventListener("click", () => this.host.openReadingSettings());
      return;
    }

    let data = this.host.getReadingCache();
    if (!data) {
      const loading = section.createDiv({ cls: "digital-desk-loading", text: "正在同步书架与划线…" });
      try {
        data = await this.host.refreshWeRead(false);
        loading.remove();
      } catch (error) {
        loading.setText(error instanceof Error ? error.message : "阅读台暂时无法同步。");
        loading.addClass("is-error");
        return;
      }
    }
    if (!data || this.disposed) return;
    this.renderReadingData(section, data);
    void this.host.refreshWeRead(false).then((fresh) => {
      if (fresh.syncedAt !== data?.syncedAt && !this.disposed) void this.render();
    }).catch(() => undefined);
  }

  private async syncReading(sync: HTMLElement): Promise<void> {
      sync.addClass("is-spinning");
      try {
        await this.host.refreshWeRead(true);
        await this.render();
        new Notice("微信读书已同步。");
      } catch (error) {
        new Notice(error instanceof Error ? error.message : "微信读书同步失败。");
      } finally {
        sync.removeClass("is-spinning");
      }
  }

  private renderReadingData(section: HTMLElement, data: ReadingSummary): void {
    const stats = section.createDiv({ cls: "digital-desk-reading-stats" });
    [
      ["书架", `${data.shelfCount}`],
      ["有笔记的书", `${data.notebooks.length}`],
      ["阅读笔记", `${data.noteCount}`],
      ["本月阅读", formatDuration(data.monthSeconds)]
    ].forEach(([label, value], index) => {
      const card = stats.createDiv({ cls: `digital-desk-stat is-${index}` });
      card.createSpan({ text: label });
      card.createEl("strong", { text: value });
    });

    const shelfHeader = section.createDiv({ cls: "digital-desk-subheading" });
    shelfHeader.createSpan({ text: "01 / SHELF" });
    shelfHeader.createEl("h3", { text: "我的书架" });
    const shelf = section.createDiv({ cls: "digital-desk-shelf" });
    data.shelf.slice().sort((a, b) => Number(b.readUpdateTime || 0) - Number(a.readUpdateTime || 0))
      .slice(0, this.host.settings.wereadShelfLimit).forEach((book) => this.renderBook(shelf, book));

    const lower = section.createDiv({ cls: "digital-desk-reading-lower" });
    const continuePanel = lower.createDiv({ cls: "digital-desk-reading-panel" });
    this.panelTitle(continuePanel, "02 / CONTINUE", "继续阅读");
    const active = data.shelf.filter((book) => !book.finishReading).slice(0, 5);
    active.forEach((book, index) => {
      const row = continuePanel.createEl("button", { cls: "digital-desk-reading-row", attr: { type: "button" } });
      row.createSpan({ cls: "digital-desk-index", text: String(index + 1).padStart(2, "0") });
      const copy = row.createDiv();
      copy.createDiv({ cls: "digital-desk-reading-row-title", text: book.title });
      copy.createDiv({ cls: "digital-desk-reading-row-meta", text: book.author || "作者未记录" });
      if (book.deepLink) row.addEventListener("click", () => this.openExternal(book.deepLink ?? ""));
    });

    const notesPanel = lower.createDiv({ cls: "digital-desk-reading-panel digital-desk-notes-panel" });
    this.panelTitle(notesPanel, "03 / MARGINALIA", "最近划线");
    const notes = notesPanel.createDiv({ cls: "digital-desk-highlight-list" });
    data.highlights.slice(0, 12).forEach((highlight) => {
      const item = notes.createEl("button", { cls: "digital-desk-highlight", attr: { type: "button" } });
      item.createDiv({ cls: "digital-desk-highlight-book", text: highlight.bookTitle });
      item.createEl("blockquote", { text: highlight.text });
      item.createDiv({ cls: "digital-desk-highlight-source", text: highlight.chapterTitle });
      item.addEventListener("click", () => void this.openHighlight(highlight));
    });
    if (!data.highlights.length) notes.createDiv({ cls: "digital-desk-muted", text: "新增划线后，点击同步即可归档。" });
  }

  private renderBook(shelf: HTMLElement, book: WeReadBook): void {
    const card = shelf.createEl("button", { cls: "digital-desk-book", attr: { type: "button" } });
    const cover = card.createDiv({ cls: "digital-desk-book-cover" });
    if (this.safeCover(book.cover)) {
      cover.createEl("img", { attr: { src: book.cover ?? "", alt: "", loading: "lazy", referrerpolicy: "no-referrer" } });
    } else {
      cover.createSpan({ text: book.title.slice(0, 2) });
    }
    card.createDiv({ cls: "digital-desk-book-title", text: book.title });
    card.createDiv({ cls: "digital-desk-book-author", text: book.author || "作者未记录" });
    if (book.deepLink) card.addEventListener("click", () => this.openExternal(book.deepLink ?? ""));
  }

  private renderProjects(page: HTMLElement): void {
    const section = page.createEl("section", { cls: "digital-desk-section" });
    this.sectionHeading(section, "正在进行", "ACTIVE WORK");
    const cards = section.createDiv({ cls: "digital-desk-project-grid" });
    const projects = this.projectEntries();
    if (!projects.length) {
      this.emptyState(cards, "项目目录还是空的。", "新建项目", () => this.host.createProject());
      return;
    }
    projects.slice(0, 6).forEach((entry, index) => {
      const card = cards.createEl("button", { cls: `digital-desk-project is-${index % 4}`, attr: { type: "button" } });
      card.createDiv({ cls: "digital-desk-project-kicker", text: `${String(index + 1).padStart(2, "0")} · PROJECT` });
      card.createEl("h3", { text: entry.label });
      card.createEl("p", { text: entry.path });
      card.createSpan({ cls: "digital-desk-project-open", text: "打开项目 →" });
      card.addEventListener("click", () => void this.openPath(entry.path));
    });
  }

  private async renderTasks(page: HTMLElement): Promise<void> {
    const section = page.createEl("section", { cls: "digital-desk-section" });
    this.sectionHeading(section, "今日待办", "TODAY");
    const panel = section.createDiv({ cls: "digital-desk-task-panel" });
    const target = this.app.vault.getAbstractFileByPath(this.host.settings.taskFile);
    if (!(target instanceof TFile)) {
      this.emptyState(panel, "待办文件还没有建立。", "建立工作台目录", () => this.host.openSettings());
      return;
    }
    const lines = (await this.app.vault.cachedRead(target)).split("\n");
    const tasks = lines.map((line, index) => ({ line, index })).filter(({ line }) => /^\s*[-*]\s+\[ \]\s+/.test(line)).slice(0, 6);
    if (!tasks.length) {
      panel.createDiv({ cls: "digital-desk-task-clear", text: "今天的清单已经清空。" });
      return;
    }
    tasks.forEach(({ line }) => {
      const item = panel.createEl("button", { cls: "digital-desk-task", attr: { type: "button" } });
      const icon = item.createSpan();
      setIcon(icon, "circle");
      item.createSpan({ text: line.replace(/^\s*[-*]\s+\[ \]\s+/, "") });
      item.addEventListener("click", () => void this.app.workspace.getLeaf("tab").openFile(target));
    });
  }

  private renderQuickLinks(page: HTMLElement): void {
    if (!this.host.settings.quickLinks.length) return;
    const section = page.createEl("section", { cls: "digital-desk-section" });
    this.sectionHeading(section, "快速入口", "SHORTCUTS");
    const links = section.createDiv({ cls: "digital-desk-quick-links" });
    this.host.settings.quickLinks.forEach((path) => {
      const link = links.createEl("button", { cls: "digital-desk-quick-link", attr: { type: "button" } });
      const icon = link.createSpan();
      setIcon(icon, "arrow-up-right");
      link.createSpan({ text: path.split("/").at(-1)?.replace(/\.md$/i, "") || path });
      link.addEventListener("click", () => void this.openPath(path));
    });
  }

  private recentFiles(): TFile[] {
    const result: TFile[] = [];
    const seen = new Set<string>();
    const paths = this.app.workspace.getLastOpenFiles();
    for (const path of paths) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile) || file.extension !== "md" || seen.has(file.path)) continue;
      seen.add(file.path);
      result.push(file);
      if (result.length >= this.host.settings.recentLimit) return result;
    }
    const fallback = this.app.vault.getMarkdownFiles().sort((a, b) => b.stat.mtime - a.stat.mtime);
    for (const file of fallback) {
      if (seen.has(file.path)) continue;
      result.push(file);
      if (result.length >= this.host.settings.recentLimit) break;
    }
    return result;
  }

  private projectEntries(): Array<{ path: string; label: string; mtime: number }> {
    if (this.host.settings.projectCards.length) {
      return this.host.settings.projectCards.map((card) => ({
        path: card.path,
        label: card.label || card.path.split("/").at(-1) || card.path,
        mtime: this.latestMtime(this.app.vault.getAbstractFileByPath(card.path))
      }));
    }
    const root = this.app.vault.getAbstractFileByPath(this.host.settings.projectsFolder);
    if (!(root instanceof TFolder)) return [];
    return root.children.filter((child): child is TFolder => child instanceof TFolder).map((folder) => ({
      path: folder.path,
      label: folder.name,
      mtime: this.latestMtime(folder)
    })).sort((left, right) => right.mtime - left.mtime);
  }

  private latestMtime(file: TAbstractFile | null): number {
    if (file instanceof TFile) return file.stat.mtime;
    if (!(file instanceof TFolder)) return 0;
    return file.children.reduce((latest, child) => Math.max(latest, this.latestMtime(child)), 0);
  }

  private openFileMenu(event: MouseEvent, file: TFile): void {
    event.preventDefault();
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("打开").setIcon("file").onClick(() => {
      void this.app.workspace.getLeaf("tab").openFile(file);
    }));
    menu.addItem((item) => item.setTitle("重命名").setIcon("pencil").onClick(() => {
      new RenameFileModal(this.app, file, async (value) => {
        const name = sanitizeName(value);
        if (!name) throw new Error("文件名不能为空。");
        const parent = file.parent?.path;
        const next = `${parent ? `${parent}/` : ""}${name}.${file.extension}`;
        await this.app.fileManager.renameFile(file, next);
        await this.render();
      }).open();
    }));
    menu.addItem((item) => item.setTitle("移到废纸篓").setIcon("trash-2").setWarning(true).onClick(() => {
      new ConfirmModal(this.app, "移到废纸篓？", `“${file.basename}”将按照你的 Obsidian 设置移到系统或仓库废纸篓。`, "移到废纸篓", async () => {
        await this.app.fileManager.trashFile(file);
        await this.render();
      }).open();
    }));
    this.app.workspace.trigger("file-menu", menu, file, "digital-desk");
    menu.showAtMouseEvent(event);
  }

  private async openHighlight(highlight: WeReadHighlight): Promise<void> {
    await this.app.workspace.openLinkText(`${this.host.settings.highlightFile}#^${highlight.blockId}`, "", true);
  }

  private async openPath(path: string): Promise<void> {
    const target = this.app.vault.getAbstractFileByPath(path);
    if (target instanceof TFile) {
      await this.app.workspace.getLeaf("tab").openFile(target);
      return;
    }
    if (target instanceof TFolder) {
      const markdown = this.filesIn(target).sort((a, b) => b.stat.mtime - a.stat.mtime)[0];
      if (markdown) {
        await this.app.workspace.getLeaf("tab").openFile(markdown);
      } else {
        new Notice(`“${target.path}”中还没有 Markdown 文件。`);
      }
      return;
    }
    new Notice(`没有找到：${path}`);
  }

  private filesIn(folder: TFolder): TFile[] {
    const files: TFile[] = [];
    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === "md") files.push(child);
      if (child instanceof TFolder) files.push(...this.filesIn(child));
    }
    return files;
  }

  private openExternal(url: string): void {
    if (!/^(https:\/\/|weread:\/\/)/.test(url)) return;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  private safeCover(value?: string): boolean {
    if (!value) return false;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && [
        "cdn.weread.qq.com",
        "res.weread.qq.com",
        "wfqqreader-1252317822.image.myqcloud.com",
        "wrco-40036.sh.gfp.tencent-cloud.com"
      ].includes(url.hostname);
    } catch {
      return false;
    }
  }

  private sectionHeading(section: HTMLElement, title: string, eyebrow: string): HTMLElement {
    const heading = section.createDiv({ cls: "digital-desk-section-heading" });
    const copy = heading.createDiv();
    copy.createSpan({ cls: "digital-desk-eyebrow", text: eyebrow });
    copy.createEl("h2", { text: title });
    return heading;
  }

  private panelTitle(panel: HTMLElement, eyebrow: string, title: string): void {
    const header = panel.createDiv({ cls: "digital-desk-panel-title" });
    header.createSpan({ text: eyebrow });
    header.createEl("h3", { text: title });
  }

  private actionButton(parent: HTMLElement, label: string, iconName: string, variant: string, action: () => void): void {
    const button = parent.createEl("button", { cls: `digital-desk-action is-${variant}`, attr: { type: "button" } });
    const icon = button.createSpan();
    setIcon(icon, iconName);
    button.createSpan({ text: label });
    button.addEventListener("click", action);
  }

  private smallLink(parent: HTMLElement, label: string, iconName: string, action: () => void): void {
    const link = parent.createEl("button", { attr: { type: "button" } });
    const icon = link.createSpan();
    setIcon(icon, iconName);
    link.createSpan({ text: label });
    link.addEventListener("click", action);
  }

  private emptyState(parent: HTMLElement, message: string, actionLabel: string, action: () => void): void {
    const empty = parent.createDiv({ cls: "digital-desk-empty" });
    empty.createEl("p", { text: message });
    const button = empty.createEl("button", { text: actionLabel, attr: { type: "button" } });
    button.addEventListener("click", action);
  }
}
