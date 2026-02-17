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
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import path from "path";
import { pathToFileURL } from "url";

import type { FontFace, FontFamily } from "./lib/font-index";
import {
  buildFontIndex,
  groupIntoFamilies,
  isIndexStale,
  loadFontIndex,
  pickRepresentativeFace,
} from "./lib/font-index";
import { getFontPreview } from "./lib/font-preview";
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
    values.push(
      face.familyName,
      face.styleName,
      face.displayName,
      face.postscriptName,
      face.fullName,
    );
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

const PREVIEW_PLACEHOLDER_WIDTH = 720;
const PREVIEW_PLACEHOLDER_HEIGHT = 240;
const DETAIL_SKELETON_WIDTH = 720;
const DETAIL_SKELETON_HEIGHT = 280;

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function toSvgDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function buildPreviewPlaceholderUrl(label: string): string {
  const escapedLabel = escapeSvgText(label);
  const textLine =
    escapedLabel.length > 0
      ? `<text x="${PREVIEW_PLACEHOLDER_WIDTH / 2}" y="126" text-anchor="middle" font-size="20" fill="#9b9b9b" font-family="-apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif">${escapedLabel}</text>`
      : "";

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PREVIEW_PLACEHOLDER_WIDTH}" height="${PREVIEW_PLACEHOLDER_HEIGHT}" viewBox="0 0 ${PREVIEW_PLACEHOLDER_WIDTH} ${PREVIEW_PLACEHOLDER_HEIGHT}">`,
    `<rect x="0" y="0" width="${PREVIEW_PLACEHOLDER_WIDTH}" height="${PREVIEW_PLACEHOLDER_HEIGHT}" fill="#f6f6f6"/>`,
    `<rect x="0.5" y="0.5" width="${PREVIEW_PLACEHOLDER_WIDTH - 1}" height="${PREVIEW_PLACEHOLDER_HEIGHT - 1}" fill="none" stroke="#e5e5e5"/>`,
    textLine,
    `</svg>`,
  ].join("");

  return toSvgDataUrl(svg);
}

const LOADING_PREVIEW_PLACEHOLDER_URL = buildPreviewPlaceholderUrl("");
const UNAVAILABLE_PREVIEW_PLACEHOLDER_URL = buildPreviewPlaceholderUrl(
  "Preview Unavailable",
);
const DETAIL_SWITCH_SKELETON_URL = toSvgDataUrl(
  [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${DETAIL_SKELETON_WIDTH}" height="${DETAIL_SKELETON_HEIGHT}" viewBox="0 0 ${DETAIL_SKELETON_WIDTH} ${DETAIL_SKELETON_HEIGHT}">`,
    `<rect x="0" y="0" width="${DETAIL_SKELETON_WIDTH}" height="${DETAIL_SKELETON_HEIGHT}" fill="none"/>`,
    `<rect x="0" y="8" width="164" height="34" rx="8" fill="#ececec"/>`,
    `<rect x="0" y="68" width="430" height="20" rx="6" fill="#efefef"/>`,
    `<rect x="0" y="102" width="376" height="20" rx="6" fill="#efefef"/>`,
    `<rect x="0" y="136" width="452" height="20" rx="6" fill="#efefef"/>`,
    `<rect x="0" y="170" width="398" height="20" rx="6" fill="#efefef"/>`,
    `<rect x="0" y="204" width="340" height="20" rx="6" fill="#efefef"/>`,
    `</svg>`,
  ].join(""),
);

function buildPreviewBlockMarkdown(
  previewPath: string | null | undefined,
  isPreviewLoading: boolean,
): string {
  if (previewPath) {
    return `![Preview](${toLocalFileUrl(previewPath)})`;
  }

  const placeholderUrl = isPreviewLoading
    ? LOADING_PREVIEW_PLACEHOLDER_URL
    : UNAVAILABLE_PREVIEW_PLACEHOLDER_URL;
  return `![Preview](${placeholderUrl})`;
}

function familyDetailMarkdown(
  family: FontFamily,
  representative: FontFace,
  previewPath: string | null | undefined,
  isPreviewLoading: boolean,
  showDetails = true,
  showDetailSkeleton = false,
): string {
  const previewBlock = buildPreviewBlockMarkdown(previewPath, isPreviewLoading);
  if (!showDetails) {
    return showDetailSkeleton
      ? `${previewBlock}\n\n![Details](${DETAIL_SWITCH_SKELETON_URL})`
      : previewBlock;
  }

  const lines: string[] = [];
  lines.push(previewBlock);
  lines.push("");
  lines.push("## Details");
  lines.push("");
  lines.push(`- **Family**: ${family.familyName}`);
  lines.push(`- **Styles**: ${family.faces.length}`);
  lines.push(`- **Representative Style**: ${representative.styleName}`);
  if (representative.postscriptName)
    lines.push(`- **PostScript**: ${representative.postscriptName}`);
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
  showDetails = true,
  showDetailSkeleton = false,
): string {
  const previewBlock = buildPreviewBlockMarkdown(previewPath, isPreviewLoading);
  if (!showDetails) {
    return showDetailSkeleton
      ? `${previewBlock}\n\n![Details](${DETAIL_SWITCH_SKELETON_URL})`
      : previewBlock;
  }

  const lines: string[] = [];
  lines.push(previewBlock);
  lines.push("");
  lines.push("## Details");
  lines.push("");
  lines.push(`- **Family**: ${face.familyName}`);
  lines.push(`- **Style**: ${face.styleName}`);
  lines.push(`- **Display Name**: ${face.displayName}`);
  if (face.postscriptName)
    lines.push(`- **PostScript**: ${face.postscriptName}`);
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

type PreviewPriority = "high" | "normal";

function normalizeSearchText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

function getSearchScore(keywords: string[], normalizedQuery: string): number {
  if (!normalizedQuery) return 3;

  let best = Number.POSITIVE_INFINITY;
  for (const keyword of keywords) {
    if (keyword === normalizedQuery) return 0;
    if (keyword.startsWith(normalizedQuery)) best = Math.min(best, 1);
    else if (keyword.includes(normalizedQuery)) best = Math.min(best, 2);
  }

  return Number.isFinite(best) ? best : 4;
}

function useFacePreviewQueue(
  faces: FontFace[],
  options?: {
    concurrency?: number;
  },
): {
  previewByFaceId: Record<string, string | null>;
  isFacePreviewLoading: (faceId: string) => boolean;
  enqueuePreview: (faceId: string, priority?: PreviewPriority) => void;
  enqueuePreviews: (faceIds: string[], priority?: PreviewPriority) => void;
} {
  const concurrency = options?.concurrency ?? 2;
  const [previewByFaceId, setPreviewByFaceId] = useState<
    Record<string, string | null>
  >({});
  const [loadingByFaceId, setLoadingByFaceId] = useState<Record<string, true>>(
    {},
  );

  const faceById = useMemo(
    () => new Map(faces.map((face) => [face.id, face])),
    [faces],
  );

  const queueRef = useRef<string[]>([]);
  const queuedSetRef = useRef(new Set<string>());
  const runningSetRef = useRef(new Set<string>());
  const activeCountRef = useRef(0);
  const disposedRef = useRef(false);
  const previewByFaceIdRef = useRef(previewByFaceId);

  useEffect(() => {
    previewByFaceIdRef.current = previewByFaceId;
  }, [previewByFaceId]);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
    };
  }, []);

  useEffect(() => {
    const allowed = new Set(faces.map((face) => face.id));
    queueRef.current = queueRef.current.filter((faceId) => allowed.has(faceId));
    queuedSetRef.current = new Set(
      Array.from(queuedSetRef.current).filter((faceId) => allowed.has(faceId)),
    );
    runningSetRef.current = new Set(
      Array.from(runningSetRef.current).filter((faceId) => allowed.has(faceId)),
    );
    setLoadingByFaceId((prev) => {
      const next: Record<string, true> = {};
      for (const key of Object.keys(prev)) {
        if (allowed.has(key)) next[key] = true;
      }
      return next;
    });
  }, [faces]);

  const pumpQueue = useCallback(() => {
    while (
      activeCountRef.current < concurrency &&
      queueRef.current.length > 0
    ) {
      const faceId = queueRef.current.shift();
      if (!faceId) break;

      queuedSetRef.current.delete(faceId);

      if (previewByFaceIdRef.current[faceId] !== undefined) continue;
      if (runningSetRef.current.has(faceId)) continue;

      const face = faceById.get(faceId);
      if (!face) continue;

      runningSetRef.current.add(faceId);
      activeCountRef.current += 1;

      setLoadingByFaceId((prev) =>
        prev[faceId] ? prev : { ...prev, [faceId]: true },
      );

      void getFontPreview({
        filePath: face.filePath,
        fileMtimeMs: face.fileMtimeMs,
        postscriptName: face.postscriptName,
        familyName: face.familyName,
      })
        .then((previewPath) => {
          if (disposedRef.current) return;
          setPreviewByFaceId((prev) =>
            prev[faceId] !== undefined
              ? prev
              : { ...prev, [faceId]: previewPath },
          );
        })
        .finally(() => {
          runningSetRef.current.delete(faceId);
          activeCountRef.current = Math.max(0, activeCountRef.current - 1);

          if (disposedRef.current) return;

          setLoadingByFaceId((prev) => {
            if (!prev[faceId]) return prev;
            const next = { ...prev };
            delete next[faceId];
            return next;
          });

          setTimeout(() => {
            if (!disposedRef.current) pumpQueue();
          }, 0);
        });
    }
  }, [concurrency, faceById]);

  const enqueuePreview = useCallback(
    (faceId: string, priority: PreviewPriority = "normal") => {
      if (!faceId) return;
      if (!faceById.has(faceId)) return;
      if (previewByFaceIdRef.current[faceId] !== undefined) return;
      if (queuedSetRef.current.has(faceId)) return;
      if (runningSetRef.current.has(faceId)) return;

      if (priority === "high") queueRef.current.unshift(faceId);
      else queueRef.current.push(faceId);
      queuedSetRef.current.add(faceId);
      pumpQueue();
    },
    [faceById, pumpQueue],
  );

  const enqueuePreviews = useCallback(
    (faceIds: string[], priority: PreviewPriority = "normal") => {
      const orderedIds = priority === "high" ? [...faceIds].reverse() : faceIds;

      for (const faceId of orderedIds) {
        if (!faceId) continue;
        if (!faceById.has(faceId)) continue;
        if (previewByFaceIdRef.current[faceId] !== undefined) continue;
        if (queuedSetRef.current.has(faceId)) continue;
        if (runningSetRef.current.has(faceId)) continue;

        if (priority === "high") queueRef.current.unshift(faceId);
        else queueRef.current.push(faceId);
        queuedSetRef.current.add(faceId);
      }

      pumpQueue();
    },
    [faceById, pumpQueue],
  );

  const isFacePreviewLoading = useCallback(
    (faceId: string) => {
      return Boolean(loadingByFaceId[faceId]);
    },
    [loadingByFaceId],
  );

  return {
    previewByFaceId,
    isFacePreviewLoading,
    enqueuePreview,
    enqueuePreviews,
  };
}

function StylesScreen(props: {
  family: FontFamily;
  onRebuildIndex: () => Promise<void>;
}) {
  const { family, onRebuildIndex } = props;

  const [selectedFaceId, setSelectedFaceId] = useState<string | null>(null);
  const {
    previewByFaceId,
    isFacePreviewLoading,
    enqueuePreview,
    enqueuePreviews,
  } = useFacePreviewQueue(family.faces, {
    concurrency: 2,
  });

  useEffect(() => {
    if (selectedFaceId) return;
    const first = family.faces[0];
    if (first) setSelectedFaceId(first.id);
  }, [family.faces, selectedFaceId]);

  useEffect(() => {
    if (!selectedFaceId) return;
    enqueuePreview(selectedFaceId, "high");
  }, [enqueuePreview, selectedFaceId]);

  useEffect(() => {
    const faceIds = family.faces.map((face) => face.id);
    if (faceIds.length === 0) return;

    if (selectedFaceId) {
      const remaining = faceIds.filter((faceId) => faceId !== selectedFaceId);
      enqueuePreviews(remaining, "normal");
      return;
    }

    enqueuePreviews(faceIds, "normal");
  }, [enqueuePreviews, family.faces, selectedFaceId]);

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
        const isPreviewLoading = isFacePreviewLoading(face.id);

        return (
          <List.Item
            key={face.id}
            id={face.id}
            title={face.styleName}
            subtitle={face.postscriptName}
            keywords={buildFaceKeywords(face)}
            quickLook={{ path: face.filePath, name: face.displayName }}
            detail={
              <List.Item.Detail
                markdown={faceDetailMarkdown(
                  face,
                  previewPath,
                  isPreviewLoading,
                )}
              />
            }
            actions={
              <ActionPanel>
                <Action
                  title="Copy Family Name"
                  icon={Icon.Clipboard}
                  onAction={() =>
                    copyToClipboard(
                      face.familyName,
                      `Family: ${face.familyName}`,
                    )
                  }
                />
                <Action
                  title="Copy Display Name (Family + Style)"
                  icon={Icon.Text}
                  onAction={() =>
                    copyToClipboard(
                      face.displayName,
                      `Display Name: ${face.displayName}`,
                    )
                  }
                />
                {face.postscriptName ? (
                  <Action
                    title="Copy PostScript Name"
                    icon={Icon.Text}
                    onAction={() =>
                      copyToClipboard(
                        face.postscriptName ?? "",
                        `PostScript: ${face.postscriptName ?? ""}`,
                      )
                    }
                  />
                ) : null}
                <Action
                  title="Copy CSS Font Family"
                  icon={Icon.Code}
                  onAction={() =>
                    copyToClipboard(
                      `font-family: "${face.familyName}";`,
                      `CSS: font-family: "${face.familyName}";`,
                    )
                  }
                />
                <Action
                  title="Open in Font Book"
                  icon={Icon.AppWindow}
                  onAction={() => openFontBook(face.filePath)}
                  shortcut={Keyboard.Shortcut.Common.Open}
                />
                <Action.ShowInFinder
                  path={face.filePath}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "f" }}
                />
                <Action.ToggleQuickLook
                  shortcut={Keyboard.Shortcut.Common.ToggleQuickLook}
                />
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
  const [detailFamilyId, setDetailFamilyId] = useState<string | null>(null);
  const [
    showDetailSkeletonWhileSwitching,
    setShowDetailSkeletonWhileSwitching,
  ] = useState(false);
  const [warmupSearchText, setWarmupSearchText] = useState("");
  const [includeHiddenFonts, setIncludeHiddenFonts] = useCachedState<boolean>(
    "include-hidden-fonts",
    false,
  );

  const familiesById = useMemo(
    () => new Map(families.map((f) => [f.id, f])),
    [families],
  );
  const visibleFamilies = useMemo(() => {
    return includeHiddenFonts
      ? families
      : families.filter((f) => !isHiddenFamilyName(f.familyName));
  }, [families, includeHiddenFonts]);
  const allFaces = useMemo(
    () => families.flatMap((family) => family.faces),
    [families],
  );
  const allFacesById = useMemo(
    () => new Map(allFaces.map((face) => [face.id, face])),
    [allFaces],
  );
  const [previewByFaceId, setPreviewByFaceId] = useState<
    Record<string, string | null>
  >({});
  const [previewLoadingFaceId, setPreviewLoadingFaceId] = useState<
    string | null
  >(null);
  const detailSelectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const searchTextDebounceTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  const selectedPreviewRunTokenRef = useRef(0);
  const warmupRunTokenRef = useRef(0);

  const familyKeywordsById = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const family of families) {
      map.set(family.id, buildFamilyKeywords(family));
    }
    return map;
  }, [families]);

  useEffect(() => {
    const allowed = new Set(visibleFamilies.map((f) => f.id));
    if (selectedFamilyId && allowed.has(selectedFamilyId)) return;
    setSelectedFamilyId(visibleFamilies[0]?.id ?? null);
  }, [selectedFamilyId, visibleFamilies]);

  useEffect(() => {
    return () => {
      if (detailSelectionTimerRef.current) {
        clearTimeout(detailSelectionTimerRef.current);
      }
      if (searchTextDebounceTimerRef.current) {
        clearTimeout(searchTextDebounceTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const hasPendingDetailSwitch = Boolean(detailSelectionTimerRef.current);
    if (detailSelectionTimerRef.current) {
      clearTimeout(detailSelectionTimerRef.current);
      detailSelectionTimerRef.current = null;
    }

    if (!selectedFamilyId) {
      setDetailFamilyId(null);
      setShowDetailSkeletonWhileSwitching(false);
      return;
    }

    setShowDetailSkeletonWhileSwitching(hasPendingDetailSwitch);
    setDetailFamilyId(null);
    detailSelectionTimerRef.current = setTimeout(() => {
      setDetailFamilyId(selectedFamilyId);
      setShowDetailSkeletonWhileSwitching(false);
      detailSelectionTimerRef.current = null;
    }, 120);
  }, [selectedFamilyId]);

  const handleSearchTextChange = useCallback((value: string) => {
    if (searchTextDebounceTimerRef.current) {
      clearTimeout(searchTextDebounceTimerRef.current);
    }

    searchTextDebounceTimerRef.current = setTimeout(() => {
      setWarmupSearchText(value);
    }, 160);
  }, []);

  async function rebuildIndex(options?: { silent?: boolean }) {
    const silent = options?.silent ?? false;

    if (!silent) {
      setIsLoading(true);
      setError(null);
      await showToast({
        style: Toast.Style.Animated,
        title: "Building Font Index…",
      });
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
    if (!detailFamilyId) {
      setPreviewLoadingFaceId(null);
      return;
    }

    const family = familiesById.get(detailFamilyId);
    if (!family) {
      setPreviewLoadingFaceId(null);
      return;
    }

    const representative = pickRepresentativeFace(family.faces);
    const faceId = representative.id;
    if (previewByFaceId[faceId] !== undefined) {
      setPreviewLoadingFaceId((current) =>
        current === faceId ? null : current,
      );
      return;
    }

    const runToken = selectedPreviewRunTokenRef.current + 1;
    selectedPreviewRunTokenRef.current = runToken;
    setPreviewLoadingFaceId(faceId);

    void getFontPreview({
      filePath: representative.filePath,
      fileMtimeMs: representative.fileMtimeMs,
      postscriptName: representative.postscriptName,
      familyName: representative.familyName,
    })
      .then((previewPath) => {
        if (selectedPreviewRunTokenRef.current !== runToken) return;
        setPreviewByFaceId((prev) =>
          prev[faceId] !== undefined
            ? prev
            : { ...prev, [faceId]: previewPath },
        );
      })
      .finally(() => {
        if (selectedPreviewRunTokenRef.current !== runToken) return;
        setPreviewLoadingFaceId((current) =>
          current === faceId ? null : current,
        );
      });

    return () => {
      if (selectedPreviewRunTokenRef.current === runToken) {
        selectedPreviewRunTokenRef.current += 1;
      }
    };
  }, [detailFamilyId, familiesById, previewByFaceId]);

  useEffect(() => {
    if (visibleFamilies.length === 0) return;

    const normalizedQuery = normalizeSearchText(warmupSearchText);
    const prioritized = visibleFamilies
      .map((family) => {
        const representative = pickRepresentativeFace(family.faces);
        const keywords = familyKeywordsById.get(family.id) ?? [];
        return {
          faceId: representative.id,
          score: getSearchScore(keywords, normalizedQuery),
        };
      })
      .sort((a, b) => a.score - b.score)
      .map((entry) => entry.faceId);

    const backgroundFaceIds = prioritized;

    // Background: debounce warmup and avoid UI state updates.
    const runToken = warmupRunTokenRef.current + 1;
    warmupRunTokenRef.current = runToken;

    const timer = setTimeout(() => {
      void (async () => {
        for (const faceId of backgroundFaceIds) {
          if (warmupRunTokenRef.current !== runToken) break;

          const face = allFacesById.get(faceId);
          if (!face) continue;

          try {
            await getFontPreview({
              filePath: face.filePath,
              fileMtimeMs: face.fileMtimeMs,
              postscriptName: face.postscriptName,
              familyName: face.familyName,
            });
          } catch {
            // Ignore warmup failures and continue with next item.
          }
        }
      })();
    }, 180);

    return () => {
      clearTimeout(timer);
      if (warmupRunTokenRef.current === runToken) {
        warmupRunTokenRef.current += 1;
      }
    };
  }, [allFacesById, familyKeywordsById, visibleFamilies, warmupSearchText]);

  return (
    <List
      filtering
      isLoading={isLoading}
      isShowingDetail
      searchBarPlaceholder="Search fonts..."
      onSearchTextChange={handleSearchTextChange}
      selectedItemId={selectedFamilyId ?? undefined}
      onSelectionChange={(id) => setSelectedFamilyId(id ?? null)}
    >
      {visibleFamilies.map((family) => {
        const representative = pickRepresentativeFace(family.faces);
        const showDetails = detailFamilyId === family.id;
        const isDetailPending =
          family.id === selectedFamilyId && detailFamilyId !== selectedFamilyId;
        const hasPreviewResult =
          previewByFaceId[representative.id] !== undefined;
        const showDetailSkeleton =
          isDetailPending && showDetailSkeletonWhileSwitching;
        const previewPath = showDetails
          ? previewByFaceId[representative.id]
          : null;
        const isPreviewLoading = showDetails
          ? previewLoadingFaceId === representative.id || !hasPreviewResult
          : isDetailPending;

        return (
          <List.Item
            key={family.id}
            id={family.id}
            title={family.familyName}
            subtitle={formatStyleCount(family.faces.length)}
            keywords={familyKeywordsById.get(family.id) ?? []}
            quickLook={{
              path: representative.filePath,
              name: family.familyName,
            }}
            detail={
              <List.Item.Detail
                markdown={familyDetailMarkdown(
                  family,
                  representative,
                  previewPath,
                  isPreviewLoading,
                  showDetails,
                  showDetailSkeleton,
                )}
              />
            }
            actions={
              <ActionPanel>
                <Action
                  title="Copy Family Name"
                  icon={Icon.Clipboard}
                  onAction={() =>
                    copyToClipboard(
                      family.familyName,
                      `Family: ${family.familyName}`,
                    )
                  }
                />
                <Action.Push
                  title="Browse Styles"
                  icon={Icon.List}
                  target={
                    <StylesScreen
                      family={family}
                      onRebuildIndex={() => rebuildIndex()}
                    />
                  }
                />
                <Action
                  title={
                    includeHiddenFonts
                      ? "Hide Hidden Fonts"
                      : "Show Hidden Fonts"
                  }
                  icon={Icon.Eye}
                  onAction={() => setIncludeHiddenFonts(!includeHiddenFonts)}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "h" }}
                />
                <Action
                  title="Copy CSS Font Family"
                  icon={Icon.Code}
                  onAction={() =>
                    copyToClipboard(
                      `font-family: "${family.familyName}";`,
                      `CSS: font-family: "${family.familyName}";`,
                    )
                  }
                />
                <Action
                  title="Open Font Book"
                  icon={Icon.AppWindow}
                  onAction={() => openFontBook()}
                  shortcut={Keyboard.Shortcut.Common.Open}
                />
                <Action.ToggleQuickLook
                  shortcut={Keyboard.Shortcut.Common.ToggleQuickLook}
                />
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

      {!isLoading &&
      visibleFamilies.length === 0 &&
      families.length > 0 &&
      !includeHiddenFonts &&
      !error ? (
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
              <Action
                title="Open Font Book"
                icon={Icon.AppWindow}
                onAction={() => openFontBook()}
              />
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
                title={
                  includeHiddenFonts ? "Hide Hidden Fonts" : "Show Hidden Fonts"
                }
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
              <Action
                title="Open Font Book"
                icon={Icon.AppWindow}
                onAction={() => openFontBook()}
              />
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
                title={
                  includeHiddenFonts ? "Hide Hidden Fonts" : "Show Hidden Fonts"
                }
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
              <Action
                title="Open Font Book"
                icon={Icon.AppWindow}
                onAction={() => openFontBook()}
              />
            </ActionPanel>
          }
        />
      ) : null}
    </List>
  );
}
