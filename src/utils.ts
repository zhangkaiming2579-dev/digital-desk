import type { WeReadHighlight } from "./types";

export const HOUR_MS = 60 * 60 * 1000;

export const QUOTES = [
  "把重要的事，放在手边。", "先理解，再表达。", "清晰来自持续整理。", "今天也留下一个作品。",
  "完成，是最可靠的灵感。", "让行动替想法获得重量。", "慢一点，做深一点。", "长期主义需要今日的动作。",
  "先写下来，再让它变好。", "把模糊变成可以讨论的东西。", "每一次整理，都在降低未来的阻力。", "真正重要的工作值得独处。",
  "创造从一个具体问题开始。", "作品会替你抵达更远的地方。", "专注是一种主动选择。", "收集之后，还要建立连接。",
  "好的系统让重要的事自然发生。", "一页完成，胜过十页设想。", "让知识回到正在做的事。", "先建立节奏，再追求速度。",
  "把复杂留给系统，把清醒留给自己。", "持续交付，会改变你看待能力的方式。", "写作，是给思考安装扶手。", "做减法，给判断留下空间。",
  "从最近的一步开始。", "把问题写清楚，答案会靠近。", "积累在看不见的时候发生。", "保留好奇，也保留证据。",
  "一个可靠入口，胜过更多收藏。", "记录让经验可以复用。", "把灵感送进可以完成的流程。", "深度来自重复返回同一个问题。",
  "今天的草稿，是明天的材料。", "给自己一个安静的开始。", "少一些切换，多一些推进。", "把注意力交给值得长期做的事。",
  "目录是思考留下的地图。", "每个项目都需要下一步。", "先找到，再创造。", "信息需要被使用，才会成为知识。",
  "让首页回答：现在该做什么。", "真正的效率，是减少重新进入状态的时间。", "把阅读带回创作现场。", "建立能陪你成长的工作方式。",
  "思考需要容器，行动需要入口。", "把未完成放在看得见的地方。", "给重要工作一张固定的桌子。", "复盘会把偶然变成能力。"
] as const;

export function quoteForHour(now = Date.now(), offset = 0): string {
  const hour = Math.floor(now / HOUR_MS);
  const index = ((hour + offset) % QUOTES.length + QUOTES.length) % QUOTES.length;
  return QUOTES[index];
}

export function sanitizeName(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").replace(/^\.+|\.+$/g, "");
}

export function joinPath(parent: string, child: string): string {
  return `${parent.replace(/\/$/, "")}/${child.replace(/^\//, "")}`.replace(/\/{2,}/g, "/");
}

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const delta = Math.max(0, now - timestamp);
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(timestamp);
}

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours) return `${hours} 小时 ${minutes} 分钟`;
  return `${minutes} 分钟`;
}

export function folderScore(count: number, lastUsed: number, now = Date.now()): number {
  const ageDays = Math.max(0, (now - lastUsed) / 86400000);
  return count * 100 - ageDays;
}

export function fingerprint(value: string): string {
  let first = 2166136261;
  let second = 5381;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second, 33) ^ code;
  }
  return (first >>> 0).toString(16).padStart(8, "0") + (second >>> 0).toString(16).padStart(8, "0");
}

export function mergeHighlights(previous: WeReadHighlight[], incoming: WeReadHighlight[]): WeReadHighlight[] {
  const merged = new Map(previous.map((item) => [item.key, item]));
  incoming.forEach((item) => merged.set(item.key, item));
  return [...merged.values()].sort((left, right) => right.createdAt - left.createdAt || left.key.localeCompare(right.key));
}
