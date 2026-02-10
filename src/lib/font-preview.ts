import { environment } from "@raycast/api";
import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

import { openSync } from "fontkit";

import { sha1 } from "./hash";

const execFileAsync = promisify(execFile);

const QUICK_LOOK_THUMBNAIL_SIZE = 360;
const VECTOR_PREVIEW_WIDTH = 720;
const VECTOR_PREVIEW_HEIGHT = 240;
const VECTOR_PREVIEW_PADDING = 20;

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

function getPreviewCachePath(filePath: string, fileMtimeMs: number, size: number): string {
  const key = sha1(`${filePath}:${fileMtimeMs}:${size}`);
  return path.join(getPreviewCacheDir(), `${key}@${size}.png`);
}

function getVectorPreviewPath(key: string): string {
  return path.join(getVectorPreviewDir(), `${key}.svg`);
}

function pickSampleText(familyName?: string): string {
  const name = (familyName ?? "").trim();
  if (/^PingFang\b/.test(name)) {
    if (/\bSC\b/.test(name)) return "\u6c49";
    if (/\b(HK|MO|TC)\b/.test(name)) return "\u6f22";
    return "\u6c49";
  }

  return "Aa";
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function generateQuickLookThumbnail(
  filePath: string,
  size: number,
  tmpDir: string,
): Promise<string | null> {
  try {
    await execFileAsync("/usr/bin/qlmanage", ["-t", "-s", String(size), "-o", tmpDir, filePath], {
      timeout: 20000,
    });
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

function buildVectorPreviewSvg(options: { filePath: string; postscriptName?: string; familyName?: string }): string | null {
  let font: any;
  try {
    font = openSync(options.filePath, options.postscriptName ?? null);
  } catch {
    return null;
  }

  const sampleText = pickSampleText(options.familyName);

  let run: any;
  try {
    run = font.layout(sampleText);
  } catch {
    return null;
  }

  const glyphs: any[] = Array.isArray(run?.glyphs) ? run.glyphs : [];
  const positions: any[] = Array.isArray(run?.positions) ? run.positions : [];
  if (glyphs.length === 0 || glyphs.length !== positions.length) return null;

  const unitsPerEm = Number(font?.unitsPerEm) > 0 ? Number(font.unitsPerEm) : 1000;
  const ascent = Number(font?.ascent);
  const descent = Number(font?.descent);
  const ascentUnits = Number.isFinite(ascent) ? ascent : unitsPerEm * 0.8;
  const descentUnits = Number.isFinite(descent) ? descent : -unitsPerEm * 0.2;

  const runWidthUnits = positions.reduce((acc, p) => acc + (Number(p?.xAdvance) || 0), 0);
  const runHeightUnits = ascentUnits - descentUnits;
  if (runWidthUnits <= 0 || runHeightUnits <= 0) return null;

  const availableWidth = VECTOR_PREVIEW_WIDTH - VECTOR_PREVIEW_PADDING * 2;
  const availableHeight = VECTOR_PREVIEW_HEIGHT - VECTOR_PREVIEW_PADDING * 2;
  const scale = Math.min(availableWidth / runWidthUnits, availableHeight / runHeightUnits);
  const fontSizePx = scale * unitsPerEm;
  if (!Number.isFinite(fontSizePx) || fontSizePx <= 0) return null;

  const baselineY = VECTOR_PREVIEW_PADDING + ascentUnits * scale;
  const runWidthPx = runWidthUnits * scale;
  const startX = Math.max(VECTOR_PREVIEW_PADDING, (VECTOR_PREVIEW_WIDTH - runWidthPx) / 2);

  let penXUnits = 0;
  const paths: string[] = [];

  for (let i = 0; i < glyphs.length; i++) {
    const glyph = glyphs[i];
    const pos = positions[i];

    const xOffsetUnits = Number(pos?.xOffset) || 0;
    const yOffsetUnits = Number(pos?.yOffset) || 0;
    const xAdvanceUnits = Number(pos?.xAdvance) || 0;

    const x = startX + (penXUnits + xOffsetUnits) * scale;
    const y = baselineY - yOffsetUnits * scale;

    penXUnits += xAdvanceUnits;

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
    `<rect x="0.5" y="0.5" width="${VECTOR_PREVIEW_WIDTH - 1}" height="${VECTOR_PREVIEW_HEIGHT - 1}" fill="none" stroke="#e6e6e6" />`,
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
  const sampleText = pickSampleText(options.familyName);
  const key = sha1(
    `vector:${options.filePath}:${options.fileMtimeMs}:${options.postscriptName ?? ""}:${options.familyName ?? ""}:${sampleText}`,
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
