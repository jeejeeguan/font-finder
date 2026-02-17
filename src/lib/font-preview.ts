import { environment } from "@raycast/api";
import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

import {
  openSync,
  type Font,
  type Glyph,
  type GlyphPosition,
  type LayoutRun,
} from "fontkit";

import { sha1 } from "./hash";

const execFileAsync = promisify(execFile);

const QUICK_LOOK_THUMBNAIL_SIZE = 360;
const VECTOR_PREVIEW_WIDTH = 720;
const VECTOR_PREVIEW_HEIGHT = 240;
const VECTOR_PREVIEW_PADDING = 28;
const VECTOR_PREVIEW_SCALE_RATIO = 0.78;
const VECTOR_PREVIEW_CACHE_VERSION = 4;

const SAMPLE_TEXT_CANDIDATES = [
  "Aa",
  "Яя",
  "Αα",
  "אב",
  "هو",
  "अआ",
  "กข",
  "あア",
  "アイ",
  "한글",
  "汉字",
  "漢字",
] as const;

const previewPromiseCache = new Map<string, Promise<string | null>>();

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getPreviewCacheDir(): string {
  return path.join(environment.supportPath, "previews");
}

function getVectorPreviewDir(): string {
  return path.join(environment.supportPath, "vector-previews");
}

function getPreviewCachePath(
  filePath: string,
  fileMtimeMs: number,
  size: number,
): string {
  const key = sha1(`${filePath}:${fileMtimeMs}:${size}`);
  return path.join(getPreviewCacheDir(), `${key}@${size}.png`);
}

function getVectorPreviewPath(key: string): string {
  return path.join(getVectorPreviewDir(), `${key}.svg`);
}

function shouldSelectByPostscript(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === ".ttc" || ext === ".dfont";
}

function toCodePoints(text: string): number[] {
  const out: number[] = [];
  for (const char of text) {
    const codePoint = char.codePointAt(0);
    if (typeof codePoint === "number") out.push(codePoint);
  }
  return out;
}

function getCharacterSet(font: Font | null | undefined): Set<number> | null {
  const source = Array.isArray(font?.characterSet) ? font.characterSet : null;
  if (!source || source.length === 0) return null;

  const out = new Set<number>();
  for (const value of source) {
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
      out.add(value);
    }
  }

  return out.size > 0 ? out : null;
}

function hasGlyphForCodePoint(
  font: Font | null | undefined,
  codePoint: number,
  characterSet: Set<number> | null,
): boolean {
  if (characterSet && !characterSet.has(codePoint)) return false;

  try {
    const glyph = font?.glyphForCodePoint?.(codePoint);
    const id = Number(glyph?.id);
    if (Number.isFinite(id)) return id > 0;
    return Boolean(glyph);
  } catch {
    return false;
  }
}

function canRenderText(
  font: Font | null | undefined,
  text: string,
  characterSet: Set<number> | null,
): boolean {
  const codePoints = toCodePoints(text);
  if (codePoints.length === 0) return false;
  return codePoints.every((codePoint) =>
    hasGlyphForCodePoint(font, codePoint, characterSet),
  );
}

function pickFallbackSample(characterSet: Set<number> | null): string | null {
  if (!characterSet || characterSet.size === 0) return null;

  const codePoints = Array.from(characterSet).sort((a, b) => a - b);
  const picked: string[] = [];

  for (const codePoint of codePoints) {
    if (codePoint < 0x20) continue;
    if (codePoint > 0x10ffff) continue;
    if (codePoint >= 0xe000 && codePoint <= 0xf8ff) continue;

    const char = String.fromCodePoint(codePoint);
    if (!char || /^\s$/u.test(char)) continue;
    if (!/[\p{L}\p{N}]/u.test(char)) continue;

    picked.push(char);
    if (picked.length >= 2) break;
  }

  if (picked.length === 0) return null;
  return picked.join("");
}

function pickSampleText(
  font: Font | null | undefined,
  familyName?: string,
): string {
  const name = (familyName ?? "").trim();
  const characterSet = getCharacterSet(font);

  if (/^PingFang\b/.test(name)) {
    const preferred = /\b(HK|MO|TC)\b/.test(name) ? "漢字" : "汉字";
    const secondary = preferred === "漢字" ? "汉字" : "漢字";
    if (canRenderText(font, preferred, characterSet)) return preferred;
    if (canRenderText(font, secondary, characterSet)) return secondary;
  }

  for (const sample of SAMPLE_TEXT_CANDIDATES) {
    if (canRenderText(font, sample, characterSet)) {
      return sample;
    }
  }

  const fallback = pickFallbackSample(characterSet);
  if (fallback) return fallback;

  return "Aa";
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function generateQuickLookThumbnail(
  filePath: string,
  size: number,
  tmpDir: string,
): Promise<string | null> {
  try {
    await execFileAsync(
      "/usr/bin/qlmanage",
      ["-t", "-s", String(size), "-o", tmpDir, filePath],
      {
        timeout: 20000,
      },
    );
  } catch {
    return null;
  }

  try {
    const files = await fs.readdir(tmpDir);
    const png = files.find((f) => f.toLowerCase().endsWith(".png"));
    if (!png) return null;
    return path.join(tmpDir, png);
  } catch {
    return null;
  }
}

function buildVectorPreviewSvg(options: {
  filePath: string;
  postscriptName?: string;
  familyName?: string;
}): string | null {
  let font: Font;
  try {
    font = openSync(
      options.filePath,
      shouldSelectByPostscript(options.filePath)
        ? (options.postscriptName ?? null)
        : null,
    );
  } catch {
    return null;
  }

  const sampleText = pickSampleText(font, options.familyName);

  let run: LayoutRun;
  try {
    run = font.layout(sampleText);
  } catch {
    return null;
  }

  const glyphs: Glyph[] = Array.isArray(run?.glyphs) ? run.glyphs : [];
  const positions: GlyphPosition[] = Array.isArray(run?.positions)
    ? run.positions
    : [];
  if (glyphs.length === 0 || glyphs.length !== positions.length) return null;

  const unitsPerEm =
    Number(font?.unitsPerEm) > 0 ? Number(font.unitsPerEm) : 1000;
  const ascent = Number(font?.ascent);
  const descent = Number(font?.descent);
  const ascentUnits = Number.isFinite(ascent) ? ascent : unitsPerEm * 0.8;
  const descentUnits = Number.isFinite(descent) ? descent : -unitsPerEm * 0.2;

  const positionAdvances = positions.map((p) => Number(p?.xAdvance) || 0);
  const positionRunWidthUnits = positionAdvances.reduce(
    (acc, xAdvance) => acc + xAdvance,
    0,
  );
  const useGlyphAdvanceFallback = positionRunWidthUnits <= 0;
  const glyphAdvances = useGlyphAdvanceFallback
    ? glyphs.map((glyph) => Number(glyph?.advanceWidth) || 0)
    : null;
  const runWidthUnits = useGlyphAdvanceFallback
    ? glyphAdvances.reduce((acc, advanceWidth) => acc + advanceWidth, 0)
    : positionRunWidthUnits;
  const runHeightUnits = ascentUnits - descentUnits;
  if (runWidthUnits <= 0 || runHeightUnits <= 0) return null;

  const availableWidth = VECTOR_PREVIEW_WIDTH - VECTOR_PREVIEW_PADDING * 2;
  const availableHeight = VECTOR_PREVIEW_HEIGHT - VECTOR_PREVIEW_PADDING * 2;
  const scale =
    Math.min(availableWidth / runWidthUnits, availableHeight / runHeightUnits) *
    VECTOR_PREVIEW_SCALE_RATIO;
  const fontSizePx = scale * unitsPerEm;
  if (!Number.isFinite(fontSizePx) || fontSizePx <= 0) return null;

  const baselineY = VECTOR_PREVIEW_PADDING + ascentUnits * scale;
  const runWidthPx = runWidthUnits * scale;
  const startX = Math.max(
    VECTOR_PREVIEW_PADDING,
    (VECTOR_PREVIEW_WIDTH - runWidthPx) / 2,
  );

  let penXUnits = 0;
  const paths: string[] = [];

  for (let i = 0; i < glyphs.length; i++) {
    const glyph = glyphs[i];
    const pos = positions[i];
    const glyphId = Number(glyph?.id);

    const xOffsetUnits = Number(pos?.xOffset) || 0;
    const yOffsetUnits = Number(pos?.yOffset) || 0;
    const xAdvanceUnits = useGlyphAdvanceFallback
      ? (glyphAdvances?.[i] ?? 0)
      : positionAdvances[i];

    const x = startX + (penXUnits + xOffsetUnits) * scale;
    const y = baselineY - yOffsetUnits * scale;

    penXUnits += xAdvanceUnits;

    if (Number.isFinite(glyphId) && glyphId <= 0) continue;

    let d: string | undefined;
    try {
      d = glyph?.getScaledPath?.(fontSizePx)?.toSVG?.();
    } catch {
      d = undefined;
    }

    if (!d) continue;

    paths.push(
      `<path d="${d}" transform="translate(${x.toFixed(2)},${y.toFixed(2)}) scale(1,-1)" fill="#111" />`,
    );
  }

  if (paths.length === 0) return null;

  const title = escapeXml(options.familyName ?? "Font Preview");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${VECTOR_PREVIEW_WIDTH}" height="${VECTOR_PREVIEW_HEIGHT}" viewBox="0 0 ${VECTOR_PREVIEW_WIDTH} ${VECTOR_PREVIEW_HEIGHT}">`,
    `<title>${title}</title>`,
    `<rect x="0" y="0" width="${VECTOR_PREVIEW_WIDTH}" height="${VECTOR_PREVIEW_HEIGHT}" fill="#ffffff" />`,
    ...paths,
    `</svg>`,
    ``,
  ].join("\n");
}

export async function getVectorPreviewSvg(options: {
  filePath: string;
  fileMtimeMs: number;
  postscriptName?: string;
  familyName?: string;
}): Promise<string | null> {
  const key = sha1(
    `vector:v${VECTOR_PREVIEW_CACHE_VERSION}:${options.filePath}:${options.fileMtimeMs}:${options.postscriptName ?? ""}:${options.familyName ?? ""}`,
  );
  const previewDir = getVectorPreviewDir();
  const previewPath = getVectorPreviewPath(key);

  await fs.mkdir(previewDir, { recursive: true });

  if (await fileExists(previewPath)) {
    return previewPath;
  }

  const svg = buildVectorPreviewSvg({
    filePath: options.filePath,
    postscriptName: options.postscriptName,
    familyName: options.familyName,
  });
  if (!svg) return null;

  await fs.writeFile(previewPath, svg, "utf8");
  return previewPath;
}

export function getFontPreview(options: {
  filePath: string;
  fileMtimeMs: number;
  postscriptName?: string;
  familyName?: string;
  size?: number;
}): Promise<string | null> {
  const key = sha1(
    `preview:${options.filePath}:${options.fileMtimeMs}:${options.postscriptName ?? ""}:${options.familyName ?? ""}:${options.size ?? QUICK_LOOK_THUMBNAIL_SIZE}`,
  );

  const existing = previewPromiseCache.get(key);
  if (existing) return existing;

  const promise = (async () => {
    let vector: string | null = null;
    try {
      vector = await getVectorPreviewSvg({
        filePath: options.filePath,
        fileMtimeMs: options.fileMtimeMs,
        postscriptName: options.postscriptName,
        familyName: options.familyName,
      });
    } catch {
      vector = null;
    }
    if (vector) return vector;

    return getPreviewImage(
      options.filePath,
      options.fileMtimeMs,
      options.size ?? QUICK_LOOK_THUMBNAIL_SIZE,
    );
  })()
    .catch(() => null)
    .finally(() => {
      previewPromiseCache.delete(key);
    });

  previewPromiseCache.set(key, promise);
  return promise;
}

export async function getPreviewImage(
  filePath: string,
  fileMtimeMs: number,
  size = QUICK_LOOK_THUMBNAIL_SIZE,
): Promise<string | null> {
  const cacheDir = getPreviewCacheDir();
  const cached = getPreviewCachePath(filePath, fileMtimeMs, size);

  await fs.mkdir(cacheDir, { recursive: true });

  if (await fileExists(cached)) {
    return cached;
  }

  const tmpBase = path.join(environment.supportPath, "tmp");
  await fs.mkdir(tmpBase, { recursive: true });

  const tmpDir = await fs.mkdtemp(path.join(tmpBase, "font-finder-"));
  try {
    const generated = await generateQuickLookThumbnail(filePath, size, tmpDir);
    if (!generated) return null;

    await fs.copyFile(generated, cached);
    return cached;
  } catch {
    return null;
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors.
    }
  }
}
