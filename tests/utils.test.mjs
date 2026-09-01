import assert from "node:assert/strict";
import test from "node:test";
import {
  fingerprint,
  folderScore,
  formatDuration,
  formatRelativeTime,
  joinPath,
  mergeHighlights,
  quoteForHour,
  QUOTES,
  sanitizeName
} from "../src/utils.ts";

test("bundled quotes are unique and concise", () => {
  assert.equal(new Set(QUOTES).size, QUOTES.length);
  assert.ok(QUOTES.length >= 40);
  assert.ok(QUOTES.every((quote) => quote.length <= 28));
});

test("quote rotation is stable within one hour", () => {
  const now = Date.UTC(2026, 7, 31, 9, 25);
  assert.equal(quoteForHour(now), quoteForHour(now + 25 * 60 * 1000));
  assert.notEqual(quoteForHour(now), quoteForHour(now, 1));
});

test("file names are sanitized without rewriting ordinary text", () => {
  assert.equal(sanitizeName("  Draft: one / two?  "), "Draft- one - two-");
  assert.equal(sanitizeName("内容草稿"), "内容草稿");
  assert.equal(sanitizeName("...."), "");
});

test("paths join without duplicate separators", () => {
  assert.equal(joinPath("01-projects/", "/launch"), "01-projects/launch");
});

test("frequent folders rank above unused folders", () => {
  const now = Date.UTC(2026, 7, 31);
  assert.ok(folderScore(5, now - 86400000, now) > folderScore(1, now, now));
});

test("time formatting uses stable human units", () => {
  assert.equal(formatDuration(7320), "2 小时 2 分钟");
  assert.equal(formatRelativeTime(1_000_000, 1_000_000 + 59_000), "刚刚");
  assert.equal(formatRelativeTime(1_000_000, 1_000_000 + 2 * 3600_000), "2 小时前");
});

test("fingerprints are deterministic and sufficiently separated", () => {
  assert.equal(fingerprint("same"), fingerprint("same"));
  assert.notEqual(fingerprint("same"), fingerprint("different"));
  assert.match(fingerprint("same"), /^[a-f0-9]{16}$/);
});

test("highlight merge updates existing keys and sorts newest first", () => {
  const base = {
    key: "book:one",
    blockId: "wr-1111111111111111",
    bookId: "book",
    bookTitle: "Book",
    author: "A",
    chapterTitle: "One",
    chapterIndex: 1,
    text: "old",
    createdAt: 1,
    deepLink: ""
  };
  const merged = mergeHighlights([base], [
    { ...base, text: "updated", createdAt: 3 },
    { ...base, key: "book:two", blockId: "wr-2222222222222222", text: "new", createdAt: 2 }
  ]);
  assert.deepEqual(merged.map((item) => item.key), ["book:one", "book:two"]);
  assert.equal(merged[0].text, "updated");
});
