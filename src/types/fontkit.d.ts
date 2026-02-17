declare module "fontkit" {
  export interface FontPath {
    toSVG(): string;
  }

  export interface Glyph {
    id?: number;
    name?: string;
    advanceWidth?: number;
    getScaledPath?(size: number): FontPath;
  }

  export interface GlyphPosition {
    xAdvance?: number;
    yAdvance?: number;
    xOffset?: number;
    yOffset?: number;
  }

  export interface LayoutRun {
    glyphs?: Glyph[];
    positions?: GlyphPosition[];
  }

  export interface Font {
    familyName?: string;
    subfamilyName?: string;
    styleName?: string;
    postscriptName?: string;
    fullName?: string;
    unitsPerEm?: number;
    ascent?: number;
    descent?: number;
    characterSet?: number[];
    fonts?: Font[];
    glyphForCodePoint?(codePoint: number): Glyph | undefined;
    layout(text: string): LayoutRun;
  }

  export function openSync(
    filename: string,
    postscriptName?: string | null,
  ): Font;
}
