// Catalogue integrity guard.
//
// These assertions exist so the two catalogues can never drift apart, and so a
// typo'd key fails in CI instead of rendering a raw dotted string to a user.
// They run as part of `pnpm test` — no separate tooling.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CATALOGS } from "../catalog";
import { LOCALES, isLocale } from "..";

const EN = CATALOGS["en-US"];
const ZH = CATALOGS["zh-CN"];

function placehold(value: string): string[] {
  return (value.match(/\{\w+\}/g) ?? []).sort();
}

/** Every source file under `dir`, recursively. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

describe("i18n catalogues", () => {
  it("ships every registered locale", () => {
    for (const locale of LOCALES) {
      expect(isLocale(locale)).toBe(true);
      expect(CATALOGS[locale]).toBeTypeOf("object");
    }
  });

  it("has non-empty catalogues", () => {
    expect(Object.keys(EN).length).toBeGreaterThan(50);
    expect(Object.keys(ZH).length).toBeGreaterThan(50);
  });

  it("has identical key sets in every locale", () => {
    const en = Object.keys(EN).sort();
    const zh = Object.keys(ZH).sort();
    expect(zh).toEqual(en);
  });

  it("has no empty translations", () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      for (const [key, value] of Object.entries(catalog)) {
        expect(value.trim(), `${locale}:${key}`).not.toBe("");
      }
    }
  });

  it("keeps interpolation placeholders in sync across locales", () => {
    for (const key of Object.keys(EN)) {
      expect(placehold(ZH[key] ?? ""), key).toEqual(placehold(EN[key]));
    }
  });

  it("keeps plural-suffixed keys paired", () => {
    const keys = new Set(Object.keys(EN));
    for (const key of keys) {
      const match = /^(.*)_(one|other)$/.exec(key);
      if (!match) continue;
      const sibling = `${match[1]}_${match[2] === "one" ? "other" : "one"}`;
      expect(keys.has(sibling), `${key} is missing its ${sibling} counterpart`).toBe(true);
    }
  });
});

describe("i18n usage", () => {
  // Static scan: every statically-written key referenced from source must exist.
  // Dynamic keys (template literals with `${`) are skipped — they are built at
  // runtime from backend discriminants and can't be resolved here.
  const sources = walk(join(process.cwd(), "src"));
  const referenced = new Map<string, string>();

  for (const file of sources) {
    // Strip comments first — doc-comment examples like `t("a.b")` in i18n.md
    // are prose, not references.
    const src = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const m of src.matchAll(/\b(?:t|translate|translateIfPresent)\(\s*"([a-zA-Z][\w.]*)"/g)) {
      if (!referenced.has(m[1])) referenced.set(m[1], file);
    }
  }

  it("finds key references to check", () => {
    // Smoke check on the scanner itself: a regex regression would silently
    // turn the assertion below into a no-op.
    expect(referenced.size).toBeGreaterThan(5);
  });

  it("resolves every statically referenced key", () => {
    // Plural keys are written bare (`t("x.count", { count })`) but stored with
    // `_one`/`_other` suffixes — the runtime appends the suffix at lookup time,
    // so a bare reference resolves if any plural variant exists.
    const isPluralPair = (key: string) =>
      EN[`${key}_one`] !== undefined || EN[`${key}_other`] !== undefined;
    const missing = [...referenced.entries()]
      .filter(([key]) => EN[key] === undefined && !isPluralPair(key))
      .map(([key, file]) => `${key}  (${file.replace(process.cwd(), "")})`);
    expect(missing).toEqual([]);
  });
});
