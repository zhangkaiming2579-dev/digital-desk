import { App, normalizePath, requestUrl, TFile } from "obsidian";
import { WEREAD_SECRET_ID } from "./settings";
import type {
  DigitalDeskSettings,
  ReadingSummary,
  WeReadBook,
  WeReadHighlight,
  WeReadNotebook
} from "./types";
import { fingerprint, mergeHighlights } from "./utils";

const API_URL = "https://i.weread.qq.com/api/agent/gateway";
const SKILL_VERSION = "1.0.4";
const ARCHIVE_START = "<!-- digital-desk-weread:start -->";
const ARCHIVE_END = "<!-- digital-desk-weread:end -->";

type JsonObject = Record<string, unknown>;

interface ShelfResponse extends JsonObject {
  books?: WeReadBook[];
  albums?: unknown[];
  mp?: unknown;
}

interface NotebooksResponse extends JsonObject {
  books?: WeReadNotebook[];
  totalBookCount?: number;
  totalNoteCount?: number;
  hasMore?: number;
}

interface ReadDataResponse extends JsonObject {
  totalReadTime?: number;
  readDays?: number;
}

interface BookmarkEntry {
  bookmarkId?: string;
  chapterUid?: string | number;
  markText?: string;
  createTime?: number;
  range?: string;
}

interface ChapterEntry {
  chapterUid?: string | number;
  chapterIdx?: number;
  title?: string;
}

interface BookmarksResponse extends JsonObject {
  updated?: BookmarkEntry[];
  chapters?: ChapterEntry[];
  book?: WeReadBook;
}

export interface WeReadCacheHost {
  getReadingCache(): ReadingSummary | undefined;
  setReadingCache(cache: ReadingSummary): Promise<void>;
}

export class WeReadService {
  constructor(
    private readonly app: App,
    private readonly settings: DigitalDeskSettings,
    private readonly cacheHost: WeReadCacheHost
  ) {}

  isConfigured(): boolean {
    return Boolean(this.app.secretStorage.getSecret(WEREAD_SECRET_ID));
  }

  async sync(force = false): Promise<ReadingSummary> {
    const previous = this.cacheHost.getReadingCache();
    const maxAge = Math.max(1, this.settings.wereadSyncMinutes) * 60 * 1000;
    if (!force && previous && Date.now() - previous.syncedAt < maxAge) return previous;

    const key = this.app.secretStorage.getSecret(WEREAD_SECRET_ID);
    if (!key) throw new Error("请先在 Digital Desk 设置中配置微信读书 API Key。");
    if (!/^wrk-[A-Za-z0-9_-]{8,}$/.test(key)) throw new Error("微信读书 API Key 格式异常，请重新配置。");

    const [shelf, notebooks, monthly, weekly] = await Promise.all([
      this.call<ShelfResponse>(key, "/shelf/sync"),
      this.loadNotebooks(key),
      this.call<ReadDataResponse>(key, "/readdata/detail", { mode: "monthly", baseTime: 0 }),
      this.call<ReadDataResponse>(key, "/readdata/detail", { mode: "weekly", baseTime: 0 })
    ]);
    const incoming = await this.loadHighlights(key, notebooks.books);
    const highlights = mergeHighlights(previous?.highlights ?? [], incoming);
    const books = Array.isArray(shelf.books) ? shelf.books : [];
    const summary: ReadingSummary = {
      shelf: books,
      shelfCount: books.length + (Array.isArray(shelf.albums) ? shelf.albums.length : 0) + (shelf.mp ? 1 : 0),
      notebooks: notebooks.books,
      noteCount: notebooks.totalNoteCount,
      monthSeconds: Number(monthly.totalReadTime || 0),
      monthDays: Number(monthly.readDays || 0),
      weekSeconds: Number(weekly.totalReadTime || 0),
      highlights,
      syncedAt: Date.now()
    };
    await this.persistArchive(highlights);
    await this.cacheHost.setReadingCache(summary);
    return summary;
  }

  private async call<T extends JsonObject>(key: string, apiName: string, params: JsonObject = {}): Promise<T> {
    let response;
    try {
      response = await requestUrl({
        url: API_URL,
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ api_name: apiName, ...params, skill_version: SKILL_VERSION }),
        throw: false
      });
    } catch {
      throw new Error("微信读书服务暂时无法连接，请检查网络后重试。");
    }
    let payload: JsonObject;
    try {
      payload = (response.json as JsonObject | undefined) ?? JSON.parse(response.text || "{}") as JsonObject;
    } catch {
      throw new Error(`微信读书返回了无法解析的响应（HTTP ${response.status}）。`);
    }
    if (payload.upgrade_info) {
      const upgrade = payload.upgrade_info as { message?: string };
      throw new Error(upgrade.message || "微信读书同步协议需要升级。");
    }
    if (response.status === 401 || response.status === 403) throw new Error("微信读书 API Key 未通过验证。");
    if (Number(payload.errcode || 0) !== 0) {
      const code = typeof payload.errcode === "string" || typeof payload.errcode === "number"
        ? String(payload.errcode)
        : "unknown";
      const message = typeof payload.errmsg === "string" ? payload.errmsg : `微信读书接口错误 ${code}`;
      throw new Error(message.replaceAll(key, "[已隐藏]"));
    }
    if (response.status >= 300) throw new Error(`微信读书服务返回 HTTP ${response.status}。`);
    return payload as T;
  }

  private async loadNotebooks(key: string): Promise<{ books: WeReadNotebook[]; totalNoteCount: number }> {
    const books: WeReadNotebook[] = [];
    const seen = new Set<string>();
    let lastSort: number | undefined;
    let totalNoteCount = 0;
    for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
      const params: JsonObject = { count: 100 };
      if (lastSort !== undefined) params.lastSort = lastSort;
      const page = await this.call<NotebooksResponse>(key, "/user/notebooks", params);
      totalNoteCount = Number(page.totalNoteCount || totalNoteCount);
      const pageBooks = Array.isArray(page.books) ? page.books : [];
      for (const notebook of pageBooks) {
        if (!notebook.bookId || seen.has(notebook.bookId)) continue;
        seen.add(notebook.bookId);
        books.push(notebook);
      }
      if (Number(page.hasMore) !== 1 || pageBooks.length === 0) break;
      const nextSort = Number(pageBooks.at(-1)?.sort);
      if (!Number.isFinite(nextSort) || nextSort === lastSort) throw new Error("微信读书笔记分页游标异常，同步已停止。");
      lastSort = nextSort;
    }
    return { books, totalNoteCount };
  }

  private async loadHighlights(key: string, notebooks: WeReadNotebook[]): Promise<WeReadHighlight[]> {
    const result: WeReadHighlight[] = [];
    const queue = notebooks.filter((notebook) => notebook.bookId);
    let cursor = 0;
    const workers = Math.min(3, queue.length);
    await Promise.all(Array.from({ length: workers }, async () => {
      while (cursor < queue.length) {
        const notebook = queue[cursor++];
        if (!notebook) break;
        const payload = await this.call<BookmarksResponse>(key, "/book/bookmarklist", { bookId: notebook.bookId });
        result.push(...this.normalizeHighlights(notebook, payload));
      }
    }));
    return result;
  }

  private normalizeHighlights(notebook: WeReadNotebook, payload: BookmarksResponse): WeReadHighlight[] {
    const chapters = new Map((payload.chapters ?? []).map((chapter) => [String(chapter.chapterUid), chapter]));
    return (payload.updated ?? []).filter((entry) => typeof entry.markText === "string" && entry.markText.trim())
      .map((entry) => {
        const bookmarkId = String(entry.bookmarkId || fingerprint(`${entry.chapterUid}:${entry.range}:${entry.createTime}:${entry.markText}`));
        const book = notebook.book ?? payload.book;
        const chapter = chapters.get(String(entry.chapterUid ?? ""));
        return {
          key: `${notebook.bookId}:${bookmarkId}`,
          blockId: `wr-${fingerprint(`${notebook.bookId}:${bookmarkId}`)}`,
          bookId: notebook.bookId,
          bookTitle: book?.title || "未命名书籍",
          author: book?.author || "",
          chapterTitle: chapter?.title || "章节未标注",
          chapterIndex: Number(chapter?.chapterIdx || 0),
          text: entry.markText?.trim() || "",
          createdAt: Number(entry.createTime || 0),
          deepLink: book?.deepLink || ""
        };
      });
  }

  private async persistArchive(highlights: WeReadHighlight[]): Promise<void> {
    const path = normalizePath(this.settings.highlightFile);
    await this.ensureParent(path);
    const file = this.app.vault.getAbstractFileByPath(path);
    const nextManaged = this.renderArchive(highlights);
    if (!file) {
      const content = [
        "---", "tags:", "  - reading", "  - weread", "---", "", "# WeRead highlights", "",
        "This file is maintained by Digital Desk. Write personal notes below the managed region.", "",
        ARCHIVE_START, nextManaged, ARCHIVE_END, "", "## My notes", ""
      ].join("\n");
      await this.app.vault.create(path, content);
      return;
    }
    if (!(file instanceof TFile)) throw new Error("微信读书划线路径被同名目录占用。");
    await this.app.vault.process(file, (current) => {
      const start = current.indexOf(ARCHIVE_START);
      const end = current.indexOf(ARCHIVE_END);
      if (start < 0 || end < start) throw new Error("划线文件的同步标记缺失，现有内容已保留。");
      return `${current.slice(0, start + ARCHIVE_START.length)}\n${nextManaged}\n${current.slice(end)}`;
    });
  }

  private renderArchive(highlights: WeReadHighlight[]): string {
    const byBook = new Map<string, WeReadHighlight[]>();
    for (const highlight of highlights) {
      const entries = byBook.get(highlight.bookId) ?? [];
      entries.push(highlight);
      byBook.set(highlight.bookId, entries);
    }
    const lines = [`已同步 ${byBook.size} 本书 · ${highlights.length} 条划线。`, ""];
    for (const entries of byBook.values()) {
      const first = entries[0];
      if (!first) continue;
      lines.push(`## 《${this.heading(first.bookTitle)}》`, "");
      if (first.author) lines.push(`作者：${this.heading(first.author)}`, "");
      if (/^(https:\/\/|weread:\/\/)/.test(first.deepLink)) lines.push(`[打开阅读](<${first.deepLink.replace(/[<>\r\n]/g, "")}>)`, "");
      const sorted = [...entries].sort((left, right) => left.chapterIndex - right.chapterIndex || left.createdAt - right.createdAt);
      let chapter = "";
      for (const item of sorted) {
        if (item.chapterTitle !== chapter) {
          chapter = item.chapterTitle;
          lines.push(`### ${this.heading(chapter)}`, "");
        }
        lines.push(...item.text.split("\n").map((line) => `> ${this.quote(line)}`), "", `^${item.blockId}`, "");
        if (item.createdAt) lines.push(`划线于 ${new Date(item.createdAt * 1000).toISOString().slice(0, 10)}`, "");
      }
    }
    return lines.join("\n").trimEnd();
  }

  private heading(value: string): string {
    return String(value).replace(/[\r\n]/g, " ").replace(/([\\`*_[\]<>#])/g, "\\$1");
  }

  private quote(value: string): string {
    return value.replace(/[&<>\\`*_[\]#!|~]/g, (character) => `&#${character.codePointAt(0)};`);
  }

  private async ensureParent(path: string): Promise<void> {
    const segments = path.split("/").slice(0, -1);
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current);
    }
  }
}
