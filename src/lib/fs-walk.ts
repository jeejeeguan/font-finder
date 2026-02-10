import fs from "fs/promises";
import type { Dirent } from "fs";
import path from "path";

export interface WalkFilesOptions {
  allowedExtensions: string[];
}

export async function walkFiles(
  roots: string[],
  options: WalkFilesOptions,
): Promise<string[]> {
  const allowed = new Set(options.allowedExtensions.map((ext) => ext.toLowerCase()));
  const results: string[] = [];
  const queue: string[] = [...roots];

  while (queue.length > 0) {
    const current = queue.pop();
    if (!current) break;

    let dirents: Dirent[];
    try {
      dirents = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const dirent of dirents) {
      if (dirent.isSymbolicLink()) continue;

      const fullPath = path.join(current, dirent.name);
      if (dirent.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      if (!dirent.isFile()) continue;

      const ext = path.extname(dirent.name).toLowerCase();
      if (allowed.has(ext)) {
        results.push(fullPath);
      }
    }
  }

  return results;
}
