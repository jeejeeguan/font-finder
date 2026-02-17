import { environment } from "@raycast/api";
import fs from "fs/promises";
import type { Dirent } from "fs";
import path from "path";

import { openSync, type Font } from "fontkit";

import { classifySource, getFontRoots, FontSource } from "./font-paths";
import { walkFiles } from "./fs-walk";
import { sha1 } from "./hash";

export const FONT_INDEX_VERSION = 2;
export const FONT_INDEX_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

const FONT_EXTENSIONS = [".otf", ".ttf", ".ttc", ".dfont"];
const MOBILE_ASSET_ROOT = "/System/Library/AssetsV2";
const MOBILE_ASSET_FONT_PREFIX = "com_apple_MobileAsset_Font";

export interface FontFace {
  id: string;
  familyName: string;
  styleName: string;
  displayName: string;
  postscriptName?: string;
  fullName?: string;
  filePath: string;
  fileExt: string;
  source: FontSource;
  fileMtimeMs: number;
}

export interface FontIndex {
  version: typeof FONT_INDEX_VERSION;
  builtAt: string;
  faces: FontFace[];
}

export interface BuildStats {
  scannedFiles: number;
  parsedFaces: number;
  skippedFiles: number;
}

export interface FontFamily {
  id: string;
  familyName: string;
  faces: FontFace[];
  representativeFaceId: string;
}

export function getFontIndexPath(): string {
  return path.join(environment.supportPath, "font-index.v2.json");
}

export function isIndexStale(index: FontIndex): boolean {
  const builtAtMs = Date.parse(index.builtAt);
  if (!Number.isFinite(builtAtMs)) return true;
  return Date.now() - builtAtMs > FONT_INDEX_TTL_MS;
}

export async function loadFontIndex(): Promise<FontIndex | null> {
  const filePath = getFontIndexPath();

  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<FontIndex> | null;
    if (!parsed || parsed.version !== FONT_INDEX_VERSION) return null;
    if (!Array.isArray(parsed.faces)) return null;

    const faces: FontFace[] = parsed.faces
      .filter((f): f is FontFace => Boolean(f && typeof f === "object"))
      .filter((f) => typeof f.id === "string")
      .filter(
        (f) =>
          typeof f.familyName === "string" && typeof f.styleName === "string",
      )
      .filter((f) => typeof f.displayName === "string")
      .filter((f) => typeof f.filePath === "string")
      .filter((f) => typeof f.fileExt === "string")
      .filter((f) => typeof f.source === "string")
      .filter((f) => typeof f.fileMtimeMs === "number");

    return {
      version: FONT_INDEX_VERSION,
      builtAt:
        typeof parsed.builtAt === "string"
          ? parsed.builtAt
          : new Date(0).toISOString(),
      faces,
    };
  } catch {
    return null;
  }
}

export async function saveFontIndex(index: FontIndex): Promise<void> {
  const filePath = getFontIndexPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(index, null, 2), "utf8");
}

async function getMobileAssetFontRoots(): Promise<string[]> {
  let dirents: Dirent[];
  try {
    dirents = await fs.readdir(MOBILE_ASSET_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }

  const roots = dirents
    .filter(
      (d) => d.isDirectory() && d.name.startsWith(MOBILE_ASSET_FONT_PREFIX),
    )
    .map((d) => path.join(MOBILE_ASSET_ROOT, d.name));

  return roots;
}

function normalizeName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed ? trimmed : undefined;
}

function getFileBaseName(filePath: string): string {
  const base = path.basename(filePath);
  const withoutExt = base.replace(/\.[^.]+$/, "");
  return withoutExt || base;
}

function toFontFace(
  filePath: string,
  fileMtimeMs: number,
  font: Font,
): Omit<FontFace, "id"> | null {
  const fallbackFamily = getFileBaseName(filePath);

  const familyName = normalizeName(font?.familyName) ?? fallbackFamily;
  const styleName =
    normalizeName(font?.subfamilyName ?? font?.styleName) ?? "Regular";

  const postscriptName = normalizeName(font?.postscriptName);
  const fullName = normalizeName(font?.fullName);
  const displayName = `${familyName} ${styleName}`.trim();

  const fileExt = path.extname(filePath).replace(/^\./, "").toLowerCase();
  const source = classifySource(filePath);

  return {
    familyName,
    styleName,
    displayName,
    postscriptName,
    fullName,
    filePath,
    fileExt,
    source,
    fileMtimeMs,
  };
}

export async function buildFontIndex(): Promise<{
  index: FontIndex;
  stats: BuildStats;
}> {
  const roots = getFontRoots().map((r) => r.path);
  const mobileAssetRoots = await getMobileAssetFontRoots();
  const files = await walkFiles([...roots, ...mobileAssetRoots], {
    allowedExtensions: FONT_EXTENSIONS,
  });

  const facesById = new Map<string, FontFace>();
  let parsedFaces = 0;
  let skippedFiles = 0;

  for (let i = 0; i < files.length; i++) {
    const filePath = files[i];
    if (i > 0 && i % 25 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    let stat: { mtimeMs: number };
    try {
      stat = await fs.stat(filePath);
    } catch {
      skippedFiles += 1;
      continue;
    }

    try {
      const opened = openSync(filePath);
      const fonts = Array.isArray(opened?.fonts) ? opened.fonts : [opened];

      for (const font of fonts) {
        const faceWithoutId = toFontFace(filePath, stat.mtimeMs, font);
        if (!faceWithoutId) continue;

        const id = sha1(
          `${faceWithoutId.filePath}|${faceWithoutId.postscriptName ?? ""}|${faceWithoutId.styleName}`,
        );

        if (facesById.has(id)) continue;
        facesById.set(id, { id, ...faceWithoutId });
        parsedFaces += 1;
      }
    } catch {
      skippedFiles += 1;
      continue;
    }
  }

  const index: FontIndex = {
    version: FONT_INDEX_VERSION,
    builtAt: new Date().toISOString(),
    faces: Array.from(facesById.values()),
  };

  await saveFontIndex(index);

  return {
    index,
    stats: {
      scannedFiles: files.length,
      parsedFaces,
      skippedFiles,
    },
  };
}

export function pickRepresentativeFace(faces: FontFace[]): FontFace {
  const regular = faces.find(
    (f) => f.styleName.trim().toLowerCase() === "regular",
  );
  return regular ?? faces[0];
}

export function groupIntoFamilies(faces: FontFace[]): FontFamily[] {
  const byFamily = new Map<string, FontFace[]>();
  for (const face of faces) {
    const key = face.familyName;
    const list = byFamily.get(key) ?? [];
    list.push(face);
    byFamily.set(key, list);
  }

  const families: FontFamily[] = [];
  for (const [familyName, familyFaces] of byFamily.entries()) {
    const facesSorted = [...familyFaces].sort((a, b) =>
      a.styleName.localeCompare(b.styleName),
    );
    const representative = pickRepresentativeFace(facesSorted);
    families.push({
      id: sha1(familyName),
      familyName,
      faces: facesSorted,
      representativeFaceId: representative.id,
    });
  }

  families.sort((a, b) => a.familyName.localeCompare(b.familyName));
  return families;
}
