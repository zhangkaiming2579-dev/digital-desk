export interface ProjectCard {
  path: string;
  label?: string;
}

export interface DigitalDeskSettings {
  deskName: string;
  tagline: string;
  inboxFolder: string;
  projectsFolder: string;
  notesFolder: string;
  ideasFolder: string;
  taskFile: string;
  highlightFile: string;
  projectCards: ProjectCard[];
  quickLinks: string[];
  recentLimit: number;
  openOnStartup: boolean;
  showTasks: boolean;
  showReadingDesk: boolean;
  wereadShelfLimit: number;
  wereadSyncMinutes: number;
  folderUsage: Record<string, { count: number; lastUsed: number }>;
  setupComplete: boolean;
}

export interface WeReadBook {
  bookId: string;
  title: string;
  author?: string;
  cover?: string;
  deepLink?: string;
  readUpdateTime?: number;
  finishReading?: number;
  progress?: number;
}

export interface WeReadNotebook {
  bookId: string;
  book?: WeReadBook;
  reviewCount?: number;
  noteCount?: number;
  bookmarkCount?: number;
  readingProgress?: number;
  sort?: number;
}

export interface WeReadHighlight {
  key: string;
  blockId: string;
  bookId: string;
  bookTitle: string;
  author: string;
  chapterTitle: string;
  chapterIndex: number;
  text: string;
  createdAt: number;
  deepLink: string;
}

export interface ReadingSummary {
  shelf: WeReadBook[];
  shelfCount: number;
  notebooks: WeReadNotebook[];
  noteCount: number;
  monthSeconds: number;
  monthDays: number;
  weekSeconds: number;
  highlights: WeReadHighlight[];
  syncedAt: number;
}

export interface PluginData {
  settings: DigitalDeskSettings;
  readingCache?: ReadingSummary;
}
