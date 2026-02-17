import os from "os";
import path from "path";

export type FontSource = "system" | "library" | "user" | "other";

export interface FontRoot {
  path: string;
  source: Exclude<FontSource, "other">;
}

export function getFontRoots(): FontRoot[] {
  return [
    { path: "/System/Library/Fonts", source: "system" },
    { path: "/Library/Fonts", source: "library" },
    { path: path.join(os.homedir(), "Library/Fonts"), source: "user" },
  ];
}

export function classifySource(filePath: string): FontSource {
  const normalized = path.normalize(filePath);
  if (normalized.startsWith("/System/Library/Fonts")) return "system";
  if (
    normalized.startsWith("/System/Library/AssetsV2/com_apple_MobileAsset_Font")
  )
    return "system";
  if (normalized.startsWith("/Library/Fonts")) return "library";

  const userFontsRoot = path.normalize(
    path.join(os.homedir(), "Library/Fonts"),
  );
  if (normalized.startsWith(userFontsRoot)) return "user";
  return "other";
}
