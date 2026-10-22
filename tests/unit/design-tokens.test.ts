import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "../../src/app/globals.css"), "utf8");

/** The `--hm-*` declarations inside the first block that follows `selector`. */
function tokens(selector: string): Map<string, string> {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`No block for ${selector}`);
  const open = css.indexOf("{", start);
  const body = css.slice(open + 1, css.indexOf("}", open));
  const map = new Map<string, string>();
  for (const [, name, value] of body.matchAll(/(--hm-[\w-]+):\s*([^;]+);/g)) {
    map.set(name!, value!.trim());
  }
  return map;
}

const light = tokens(":root {");
const dark = tokens(':root[data-theme="dark"] {');
const systemDark = tokens(":root:not([data-theme]) {");

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe("design tokens", () => {
  it("define the same tokens in light and dark", () => {
    expect([...dark.keys()].sort()).toEqual([...light.keys()].sort());
  });

  it("keep the system-dark block identical to the explicit dark theme", () => {
    expect(Object.fromEntries(systemDark)).toEqual(Object.fromEntries(dark));
  });

  it("only map theme colours to tokens that exist", () => {
    for (const [, ref] of css.matchAll(/--color-[\w-]+:\s*var\((--hm-[\w-]+)\)/g)) {
      expect(light.has(ref!), ref).toBe(true);
    }
  });

  // WCAG 2.2 AA: 4.5:1 for body text, 3:1 for large text and UI boundaries.
  const textPairs: [string, string][] = [
    ["--hm-text", "--hm-bg"],
    ["--hm-text", "--hm-surface"],
    ["--hm-text-secondary", "--hm-surface"],
    ["--hm-text-secondary", "--hm-bg"],
    ["--hm-text-muted", "--hm-surface"],
    ["--hm-text-muted", "--hm-bg"],
    ["--hm-text-muted", "--hm-sidebar"],
    ["--hm-text-on-accent", "--hm-accent"],
    ["--hm-accent", "--hm-surface"],
    ["--hm-accent", "--hm-accent-soft"],
    ["--hm-success", "--hm-success-soft"],
    ["--hm-warning", "--hm-warning-soft"],
    ["--hm-danger", "--hm-danger-soft"],
    ["--hm-info", "--hm-info-soft"],
    ["--hm-neutral", "--hm-neutral-soft"],
    ["--hm-danger", "--hm-surface"],
  ];

  for (const [theme, values] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    it.each(textPairs)(`${theme}: %s on %s meets 4.5:1`, (fg, bg) => {
      expect(contrast(values.get(fg)!, values.get(bg)!)).toBeGreaterThanOrEqual(4.5);
    });

    it(`${theme}: the focus ring stands out from surfaces at 3:1`, () => {
      for (const bg of ["--hm-bg", "--hm-surface", "--hm-sidebar"]) {
        expect(contrast(values.get("--hm-focus")!, values.get(bg)!), bg).toBeGreaterThanOrEqual(3);
      }
    });
  }
});
