import {
  Action,
  ActionPanel,
  Clipboard,
  Icon,
  Keyboard,
  List,
  showToast,
  Toast,
} from "@raycast/api";
import { useCachedState } from "@raycast/utils";
import React, { useEffect, useMemo, useRef, useState } from "react";
import path from "path";
import { pathToFileURL } from "url";

import type { FontFace, FontFamily } from "./lib/font-index";
import { buildFontIndex, groupIntoFamilies, isIndexStale, loadFontIndex, pickRepresentativeFace } from "./lib/font-index";
import { getPreviewImage, getVectorPreviewSvg } from "./lib/font-preview";
import { uniqueStrings } from "./lib/strings";

function formatStyleCount(count: number): string {
  return `${count} ${count === 1 ? "style" : "styles"}`;
}

function isHiddenFamilyName(familyName: string): boolean {
  return familyName.trim().startsWith(".");
}

function toLocalFileUrl(filePath: string): string {
  try {
    return pathToFileURL(filePath).toString();
  } catch {
    return filePath;
  }
}

async function copyToClipboard(value: string, label: string): Promise<void> {
  try {
    await Clipboard.copy(value);
    await showToast({
      style: Toast.Style.Success,
      title: "Copied to Clipboard",
      message: label,
    });
  } catch {
    await showToast({
      style: Toast.Style.Failure,
      title: "Copy Failed",
      message: "Unable to copy to clipboard",
    });
  }
}

async function runOpen(args: string[]): Promise<void> {
  const { execFile } = await import("child_process");
  await new Promise<void>((resolve, reject) => {
    execFile("/usr/bin/open", args, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function openFontBook(filePath?: string): Promise<void> {
  try {
    const args = filePath ? ["-a", "Font Book", filePath] : ["-a", "Font Book"];
    await runOpen(args);
  } catch {
    await showToast({
      style: Toast.Style.Failure,
      title: "Open Failed",
      message: "Unable to open Font Book",
    });
  }
}

function buildFamilyKeywords(family: FontFamily): string[] {
  const values: Array<string | undefined | null> = [family.familyName];
  for (const face of family.faces) {
    values.push(face.familyName, face.styleName, face.displayName, face.postscriptName, face.fullName);
    const fileName = path.basename(face.filePath);
    const fileStem = fileName.replace(/\.[^.]+$/, "");
    values.push(fileName, fileStem);
  }
  return uniqueStrings(values);
}

function buildFaceKeywords(face: FontFace): string[] {
  const fileName = path.basename(face.filePath);
  const fileStem = fileName.replace(/\.[^.]+$/, "");
  const values: Array<string | undefined | null> = [
    face.familyName,
    face.styleName,
    face.displayName,
    face.postscriptName,
    face.fullName,
    fileName,
    fileStem,
  ];
  return uniqueStrings(values);
}

function familyDetailMarkdown(
  family: FontFamily,
  representative: FontFace,
  previewPath: string | null | undefined,
  isPreviewLoading: boolean,
): string {
  const imageUrl = previewPath ? toLocalFileUrl(previewPath) : null;
  const image = imageUrl ? `![Preview](${imageUrl})` : isPreviewLoading ? "Loading preview…" : "Preview unavailable.";

  const lines: string[] = [];
  lines.push(image);
  lines.push("");
  lines.push("## Details");
  lines.push("");
  lines.push(`- **Family**: ${family.familyName}`);
  lines.push(`- **Styles**: ${family.faces.length}`);
  lines.push(`- **Representative Style**: ${representative.styleName}`);
  if (representative.postscriptName) lines.push(`- **PostScript**: ${representative.postscriptName}`);
  lines.push(`- **Source**: ${representative.source}`);
  lines.push("");
  lines.push("## File");
  lines.push("");
  lines.push("```");
  lines.push(representative.filePath);
  lines.push("```");

  return lines.join("\n");
}

function faceDetailMarkdown(
  face: FontFace,
  previewPath: string | null | undefined,
  isPreviewLoading: boolean,
): string {
  const imageUrl = previewPath ? toLocalFileUrl(previewPath) : null;
  const image = imageUrl ? `![Preview](${imageUrl})` : isPreviewLoading ? "Loading preview…" : "Preview unavailable.";

  const lines: string[] = [];
  lines.push(image);
  lines.push("");
  lines.push("## Details");
  lines.push("");
  lines.push(`- **Family**: ${face.familyName}`);
  lines.push(`- **Style**: ${face.styleName}`);
  lines.push(`- **Display Name**: ${face.displayName}`);
  if (face.postscriptName) lines.push(`- **PostScript**: ${face.postscriptName}`);
  if (face.fullName) lines.push(`- **Full Name**: ${face.fullName}`);
  lines.push(`- **Source**: ${face.source}`);
  lines.push("");
  lines.push("## File");
  lines.push("");
  lines.push("```");
  lines.push(face.filePath);
  lines.push("```");

  return lines.join("\n");
}

function StylesScreen(props: { family: FontFamily; onRebuildIndex: () => Promise<void> }) {
  const { family, onRebuildIndex } = props;

  const [selectedFaceId, setSelectedFaceId] = useState<string | null>(null);
  const [previewByFaceId, setPreviewByFaceId] = useState<Record<string, string | null>>({});
  const [previewLoadingFaceId, setPreviewLoadingFaceId] = useState<string | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const facesById = useMemo(() => new Map(family.faces.map((f) => [f.id, f])), [family.faces]);

  useEffect(() => {
    if (selectedFaceId) return;
    const first = family.faces[0];
    if (first) setSelectedFaceId(first.id);
  }, [family.faces, selectedFaceId]);

  useEffect(() => {
    if (!selectedFaceId) return;
    const face = facesById.get(selectedFaceId);
    if (!face) return;

    if (previewByFaceId[selectedFaceId] !== undefined) return;

    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      setPreviewLoadingFaceId(selectedFaceId);
      const previewPromise =
        face.fileExt === "ttc"
          ? getVectorPreviewSvg({
              filePath: face.filePath,
              fileMtimeMs: face.fileMtimeMs,
              postscriptName: face.postscriptName,
              familyName: face.familyName,
            }).then((p) => p ?? getPreviewImage(face.filePath, face.fileMtimeMs))
          : getPreviewImage(face.filePath, face.fileMtimeMs);

      previewPromise
        .then((p) => {
          setPreviewByFaceId((prev) => ({ ...prev, [selectedFaceId]: p }));
        })
        .finally(() => {
          setPreviewLoadingFaceId((current) => (current === selectedFaceId ? null : current));
        });
    }, 150);

    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, [facesById, previewByFaceId, selectedFaceId]);

  return (
    <List
      filtering
      isShowingDetail
      searchBarPlaceholder={`Search styles in ${family.familyName}...`}
      selectedItemId={selectedFaceId ?? undefined}
      onSelectionChange={(id) => setSelectedFaceId(id ?? null)}
    >
      {family.faces.map((face) => {
        const previewPath = previewByFaceId[face.id];
        const isPreviewLoading = previewLoadingFaceId === face.id;

        return (
          <List.Item
            key={face.id}
            id={face.id}
            title={face.styleName}
            subtitle={face.postscriptName}
            keywords={buildFaceKeywords(face)}
            quickLook={{ path: face.filePath, name: face.displayName }}
            detail={<List.Item.Detail markdown={faceDetailMarkdown(face, previewPath, isPreviewLoading)} />}
            actions={
              <ActionPanel>
                <Action
                  title="Copy Family Name"
                  icon={Icon.Clipboard}
                  onAction={() => copyToClipboard(face.familyName, `Family: ${face.familyName}`)}
                />
                <Action
                  title="Copy Display Name (Family + Style)"
                  icon={Icon.Text}
                  onAction={() => copyToClipboard(face.displayName, `Display Name: ${face.displayName}`)}
                />
                {face.postscriptName ? (
                  <Action
                    title="Copy PostScript Name"
                    icon={Icon.Text}
                    onAction={() =>
                      copyToClipboard(face.postscriptName ?? "", `PostScript: ${face.postscriptName ?? ""}`)
                    }
                  />
                ) : null}
                <Action
                  title="Copy CSS font-family"
                  icon={Icon.Code}
                  onAction={() =>
                    copyToClipboard(`font-family: "${face.familyName}";`, `CSS: font-family: "${face.familyName}";`)
                  }
                />
                <Action
                  title="Open in Font Book"
                  icon={Icon.AppWindow}
                  onAction={() => openFontBook(face.filePath)}
                  shortcut={Keyboard.Shortcut.Common.Open}
                />
                <Action.ShowInFinder path={face.filePath} shortcut={{ modifiers: ["cmd", "shift"], key: "f" }} />
                <Action.ToggleQuickLook shortcut={Keyboard.Shortcut.Common.ToggleQuickLook} />
                <Action
                  title="Rebuild Font Index"
                  icon={Icon.ArrowClockwise}
                  onAction={onRebuildIndex}
                  shortcut={{ modifiers: ["cmd"], key: "r" }}
                />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}

export default function SearchFontsCommand() {
  const [families, setFamilies] = useState<FontFamily[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFamilyId, setSelectedFamilyId] = useState<string | null>(null);
  const [includeHiddenFonts, setIncludeHiddenFonts] = useCachedState<boolean>("include-hidden-fonts", false);

  const [previewByFaceId, setPreviewByFaceId] = useState<Record<string, string | null>>({});
  const [previewLoadingFaceId, setPreviewLoadingFaceId] = useState<string | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const familiesById = useMemo(() => new Map(families.map((f) => [f.id, f])), [families]);
  const visibleFamilies = useMemo(() => {
    return includeHiddenFonts ? families : families.filter((f) => !isHiddenFamilyName(f.familyName));
  }, [families, includeHiddenFonts]);

  useEffect(() => {
    const allowed = new Set(visibleFamilies.map((f) => f.id));
    if (selectedFamilyId && allowed.has(selectedFamilyId)) return;
    setSelectedFamilyId(visibleFamilies[0]?.id ?? null);
  }, [selectedFamilyId, visibleFamilies]);

  async function rebuildIndex(options?: { silent?: boolean }) {
    const silent = options?.silent ?? false;

    if (!silent) {
      setIsLoading(true);
      setError(null);
      await showToast({ style: Toast.Style.Animated, title: "Building Font Index…" });
    }

    try {
      const { index, stats } = await buildFontIndex();
      const grouped = groupIntoFamilies(index.faces);
      setFamilies(grouped);

      if (!silent) {
        await showToast({
          style: Toast.Style.Success,
          title: "Font Index Ready",
          message: `${stats.parsedFaces} faces indexed (${stats.skippedFiles} skipped)`,
        });
      } else {
        await showToast({
          style: Toast.Style.Success,
          title: "Font Index Updated",
          message: `${stats.parsedFaces} faces indexed`,
        });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Unknown error occurred";
      if (!silent) {
        setError(message);
        await showToast({
          style: Toast.Style.Failure,
          title: "Index Build Failed",
          message,
          primaryAction: {
            title: "Retry",
            onAction: () => rebuildIndex(),
          },
        });
      } else {
        console.error("Background index refresh failed:", e);
      }
    } finally {
      if (!silent) setIsLoading(false);
    }
  }

  async function loadIndex() {
    setIsLoading(true);
    setError(null);

    const cached = await loadFontIndex();
    if (cached && cached.faces.length > 0) {
      setFamilies(groupIntoFamilies(cached.faces));
      setIsLoading(false);

      if (isIndexStale(cached)) {
        void rebuildIndex({ silent: true });
      }
      return;
    }

    await rebuildIndex();
  }

  useEffect(() => {
    void loadIndex();
  }, []);

  useEffect(() => {
    if (!selectedFamilyId) return;
    const family = familiesById.get(selectedFamilyId);
    if (!family) return;

    const representative = pickRepresentativeFace(family.faces);
    const faceId = representative.id;

    if (previewByFaceId[faceId] !== undefined) return;

    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      setPreviewLoadingFaceId(faceId);
      const previewPromise =
        representative.fileExt === "ttc"
          ? getVectorPreviewSvg({
              filePath: representative.filePath,
              fileMtimeMs: representative.fileMtimeMs,
              postscriptName: representative.postscriptName,
              familyName: family.familyName,
            }).then((p) => p ?? getPreviewImage(representative.filePath, representative.fileMtimeMs))
          : getPreviewImage(representative.filePath, representative.fileMtimeMs);

      previewPromise
        .then((p) => {
          setPreviewByFaceId((prev) => ({ ...prev, [faceId]: p }));
        })
        .finally(() => {
          setPreviewLoadingFaceId((current) => (current === faceId ? null : current));
        });
    }, 150);

    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, [familiesById, previewByFaceId, selectedFamilyId]);

  return (
    <List
      filtering
      isLoading={isLoading}
      isShowingDetail
      searchBarPlaceholder="Search fonts..."
      selectedItemId={selectedFamilyId ?? undefined}
      onSelectionChange={(id) => setSelectedFamilyId(id ?? null)}
    >
      {visibleFamilies.map((family) => {
        const representative = pickRepresentativeFace(family.faces);
        const previewPath = previewByFaceId[representative.id];
        const isPreviewLoading = previewLoadingFaceId === representative.id;

        return (
          <List.Item
            key={family.id}
            id={family.id}
            title={family.familyName}
            subtitle={formatStyleCount(family.faces.length)}
            keywords={buildFamilyKeywords(family)}
            quickLook={{ path: representative.filePath, name: family.familyName }}
            detail={
              <List.Item.Detail
                markdown={familyDetailMarkdown(family, representative, previewPath, isPreviewLoading)}
              />
            }
            actions={
              <ActionPanel>
                <Action
                  title="Copy Family Name"
                  icon={Icon.Clipboard}
                  onAction={() => copyToClipboard(family.familyName, `Family: ${family.familyName}`)}
                />
                <Action.Push
                  title="Browse Styles"
                  icon={Icon.List}
                  target={<StylesScreen family={family} onRebuildIndex={() => rebuildIndex()} />}
                />
                <Action
                  title={includeHiddenFonts ? "Hide Hidden Fonts" : "Show Hidden Fonts"}
                  icon={Icon.Eye}
                  onAction={() => setIncludeHiddenFonts(!includeHiddenFonts)}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "h" }}
                />
                <Action
                  title="Copy CSS font-family"
                  icon={Icon.Code}
                  onAction={() =>
                    copyToClipboard(`font-family: "${family.familyName}";`, `CSS: font-family: "${family.familyName}";`)
                  }
                />
                <Action
                  title="Open Font Book"
                  icon={Icon.AppWindow}
                  onAction={() => openFontBook()}
                  shortcut={Keyboard.Shortcut.Common.Open}
                />
                <Action.ToggleQuickLook shortcut={Keyboard.Shortcut.Common.ToggleQuickLook} />
                <Action
                  title="Rebuild Font Index"
                  icon={Icon.ArrowClockwise}
                  onAction={() => rebuildIndex()}
                  shortcut={{ modifiers: ["cmd"], key: "r" }}
                />
              </ActionPanel>
            }
          />
        );
      })}

      {!isLoading && visibleFamilies.length === 0 && families.length > 0 && !includeHiddenFonts && !error ? (
        <List.EmptyView
          icon={Icon.Text}
          title="No Fonts Found"
          description="Only hidden (dot-prefixed) fonts were found. You can show them from the Actions menu."
          actions={
            <ActionPanel>
              <Action
                title="Show Hidden Fonts"
                icon={Icon.Eye}
                onAction={() => setIncludeHiddenFonts(true)}
                shortcut={{ modifiers: ["cmd", "shift"], key: "h" }}
              />
              <Action
                title="Rebuild Font Index"
                icon={Icon.ArrowClockwise}
                onAction={() => rebuildIndex()}
                shortcut={{ modifiers: ["cmd"], key: "r" }}
              />
              <Action title="Open Font Book" icon={Icon.AppWindow} onAction={() => openFontBook()} />
            </ActionPanel>
          }
        />
      ) : null}

      {!isLoading && families.length === 0 && !error ? (
        <List.EmptyView
          icon={Icon.Text}
          title="No Fonts Found"
          description="No fonts were found in standard macOS font directories."
          actions={
            <ActionPanel>
              <Action
                title={includeHiddenFonts ? "Hide Hidden Fonts" : "Show Hidden Fonts"}
                icon={Icon.Eye}
                onAction={() => setIncludeHiddenFonts(!includeHiddenFonts)}
                shortcut={{ modifiers: ["cmd", "shift"], key: "h" }}
              />
              <Action
                title="Rebuild Font Index"
                icon={Icon.ArrowClockwise}
                onAction={() => rebuildIndex()}
                shortcut={{ modifiers: ["cmd"], key: "r" }}
              />
              <Action title="Open Font Book" icon={Icon.AppWindow} onAction={() => openFontBook()} />
            </ActionPanel>
          }
        />
      ) : null}

      {!isLoading && error ? (
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="Failed to Load Fonts"
          description={error}
          actions={
            <ActionPanel>
              <Action
                title={includeHiddenFonts ? "Hide Hidden Fonts" : "Show Hidden Fonts"}
                icon={Icon.Eye}
                onAction={() => setIncludeHiddenFonts(!includeHiddenFonts)}
                shortcut={{ modifiers: ["cmd", "shift"], key: "h" }}
              />
              <Action
                title="Retry"
                icon={Icon.ArrowClockwise}
                onAction={() => rebuildIndex()}
                shortcut={{ modifiers: ["cmd"], key: "r" }}
              />
              <Action title="Open Font Book" icon={Icon.AppWindow} onAction={() => openFontBook()} />
            </ActionPanel>
          }
        />
      ) : null}
    </List>
  );
}
