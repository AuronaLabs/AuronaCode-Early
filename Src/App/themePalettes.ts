import type { AccentThemeId } from "../Foundation/Types/Config";

export type ThemeMode = "light" | "dark";

export interface ThemeAmbientField {
  rgb: [number, number, number];
  /** 光域中心 X / Y（百分比）。 */
  x: number;
  y: number;
  /** 光域横向 / 纵向尺寸（百分比）。 */
  sizeX: number;
  sizeY: number;
  alpha: number;
}

export interface ThemePalette {
  baseStart: string;
  baseMiddle: string;
  baseEnd: string;
  fields: ThemeAmbientField[];
}

export interface ThemeDefinition {
  id: AccentThemeId;
  accentRgb: string;
  isDefault?: boolean;
  palettes: Record<ThemeMode, ThemePalette>;
}

/**
 * 主题调色板元数据：与 Theme.css 中每套主题的 Atmosphere 保持一致，
 * 专供 Theme Picker 的微型预览使用。CSS 仍是视觉的事实来源。
 */
export const THEME_DEFINITIONS: ThemeDefinition[] = [
  {
    id: "aurora",
    accentRgb: "37, 99, 235",
    isDefault: true,
    palettes: {
      light: {
        baseStart: "#eaf3fc",
        baseMiddle: "#e7eef9",
        baseEnd: "#dbeaf5",
        fields: [
          { rgb: [96, 148, 240], x: 12, y: -6, sizeX: 110, sizeY: 95, alpha: 0.5 },
          { rgb: [88, 200, 228], x: 88, y: 12, sizeX: 72, sizeY: 62, alpha: 0.34 },
          { rgb: [116, 140, 238], x: 72, y: 108, sizeX: 90, sizeY: 82, alpha: 0.28 },
        ],
      },
      dark: {
        baseStart: "#101d36",
        baseMiddle: "#0e1a2e",
        baseEnd: "#0a1c28",
        fields: [
          { rgb: [58, 130, 218], x: 8, y: -6, sizeX: 115, sizeY: 100, alpha: 0.34 },
          { rgb: [48, 180, 210], x: 90, y: 8, sizeX: 75, sizeY: 65, alpha: 0.2 },
          { rgb: [74, 128, 225], x: 75, y: 112, sizeX: 95, sizeY: 85, alpha: 0.24 },
        ],
      },
    },
  },
  {
    id: "violet",
    accentRgb: "124, 58, 237",
    palettes: {
      light: {
        baseStart: "#f0e9fc",
        baseMiddle: "#ece7f8",
        baseEnd: "#e3e5f7",
        fields: [
          { rgb: [150, 108, 232], x: 85, y: -8, sizeX: 105, sizeY: 95, alpha: 0.42 },
          { rgb: [118, 122, 236], x: 8, y: 30, sizeX: 75, sizeY: 70, alpha: 0.3 },
          { rgb: [172, 138, 244], x: 92, y: 96, sizeX: 65, sizeY: 55, alpha: 0.28 },
        ],
      },
      dark: {
        baseStart: "#241644",
        baseMiddle: "#1e1638",
        baseEnd: "#181735",
        fields: [
          { rgb: [130, 88, 215], x: 88, y: -10, sizeX: 110, sizeY: 95, alpha: 0.32 },
          { rgb: [98, 104, 215], x: 6, y: 32, sizeX: 80, sizeY: 70, alpha: 0.22 },
          { rgb: [152, 116, 228], x: 94, y: 100, sizeX: 60, sizeY: 55, alpha: 0.22 },
        ],
      },
    },
  },
  {
    id: "rose",
    accentRgb: "225, 29, 72",
    palettes: {
      light: {
        baseStart: "#fdeaf0",
        baseMiddle: "#f9e8ed",
        baseEnd: "#f8e7de",
        fields: [
          { rgb: [240, 114, 144], x: 10, y: -8, sizeX: 105, sizeY: 90, alpha: 0.4 },
          { rgb: [255, 176, 152], x: 90, y: 18, sizeX: 80, sizeY: 70, alpha: 0.36 },
          { rgb: [224, 130, 168], x: 70, y: 105, sizeX: 85, sizeY: 80, alpha: 0.24 },
        ],
      },
      dark: {
        baseStart: "#351526",
        baseMiddle: "#2c1322",
        baseEnd: "#2f1b18",
        fields: [
          { rgb: [216, 84, 118], x: 8, y: -8, sizeX: 110, sizeY: 95, alpha: 0.28 },
          { rgb: [235, 142, 110], x: 92, y: 16, sizeX: 80, sizeY: 70, alpha: 0.18 },
          { rgb: [200, 96, 140], x: 72, y: 108, sizeX: 90, sizeY: 85, alpha: 0.2 },
        ],
      },
    },
  },
  {
    id: "coral",
    accentRgb: "234, 88, 12",
    palettes: {
      light: {
        baseStart: "#fdede4",
        baseMiddle: "#f9eae1",
        baseEnd: "#f9edcf",
        fields: [
          { rgb: [240, 138, 92], x: 12, y: -6, sizeX: 110, sizeY: 95, alpha: 0.44 },
          { rgb: [250, 192, 116], x: 90, y: 22, sizeX: 80, sizeY: 70, alpha: 0.42 },
          { rgb: [226, 124, 96], x: 75, y: 106, sizeX: 90, sizeY: 80, alpha: 0.22 },
        ],
      },
      dark: {
        baseStart: "#391a10",
        baseMiddle: "#2f1711",
        baseEnd: "#35250e",
        fields: [
          { rgb: [222, 104, 58], x: 10, y: -8, sizeX: 115, sizeY: 95, alpha: 0.3 },
          { rgb: [238, 170, 92], x: 92, y: 18, sizeX: 85, sizeY: 70, alpha: 0.22 },
          { rgb: [210, 92, 66], x: 76, y: 108, sizeX: 90, sizeY: 85, alpha: 0.2 },
        ],
      },
    },
  },
  {
    id: "amber",
    accentRgb: "202, 138, 4",
    palettes: {
      light: {
        baseStart: "#fcf1dc",
        baseMiddle: "#f8eedd",
        baseEnd: "#f6e3c9",
        fields: [
          { rgb: [226, 172, 70], x: 50, y: -10, sizeX: 100, sizeY: 90, alpha: 0.4 },
          { rgb: [208, 160, 80], x: 88, y: 85, sizeX: 80, sizeY: 75, alpha: 0.3 },
          { rgb: [250, 208, 122], x: 8, y: 40, sizeX: 70, sizeY: 60, alpha: 0.34 },
        ],
      },
      dark: {
        baseStart: "#342710",
        baseMiddle: "#2c2212",
        baseEnd: "#33200e",
        fields: [
          { rgb: [208, 150, 52], x: 50, y: -12, sizeX: 105, sizeY: 90, alpha: 0.26 },
          { rgb: [196, 142, 62], x: 90, y: 88, sizeX: 85, sizeY: 75, alpha: 0.2 },
          { rgb: [242, 192, 100], x: 6, y: 42, sizeX: 70, sizeY: 60, alpha: 0.16 },
        ],
      },
    },
  },
  {
    id: "jade",
    accentRgb: "5, 150, 105",
    palettes: {
      light: {
        baseStart: "#e0f5e9",
        baseMiddle: "#e4f1ea",
        baseEnd: "#d9f0ea",
        fields: [
          { rgb: [72, 172, 132], x: 8, y: -6, sizeX: 105, sizeY: 90, alpha: 0.38 },
          { rgb: [108, 210, 184], x: 90, y: 25, sizeX: 80, sizeY: 70, alpha: 0.32 },
          { rgb: [62, 158, 142], x: 70, y: 106, sizeX: 90, sizeY: 85, alpha: 0.2 },
        ],
      },
      dark: {
        baseStart: "#133120",
        baseMiddle: "#12281f",
        baseEnd: "#0e2b24",
        fields: [
          { rgb: [52, 158, 116], x: 8, y: -8, sizeX: 110, sizeY: 95, alpha: 0.3 },
          { rgb: [80, 198, 172], x: 92, y: 22, sizeX: 85, sizeY: 70, alpha: 0.2 },
          { rgb: [46, 144, 130], x: 72, y: 108, sizeX: 90, sizeY: 85, alpha: 0.2 },
        ],
      },
    },
  },
  {
    id: "mint",
    accentRgb: "13, 148, 136",
    palettes: {
      light: {
        baseStart: "#dcf5f1",
        baseMiddle: "#e2f1f1",
        baseEnd: "#dcebf7",
        fields: [
          { rgb: [62, 176, 168], x: 12, y: -8, sizeX: 110, sizeY: 95, alpha: 0.4 },
          { rgb: [96, 176, 214], x: 88, y: 20, sizeX: 85, sizeY: 70, alpha: 0.34 },
          { rgb: [80, 192, 182], x: 78, y: 104, sizeX: 80, sizeY: 70, alpha: 0.22 },
        ],
      },
      dark: {
        baseStart: "#0f2f2b",
        baseMiddle: "#102727",
        baseEnd: "#132537",
        fields: [
          { rgb: [50, 164, 156], x: 10, y: -10, sizeX: 115, sizeY: 95, alpha: 0.28 },
          { rgb: [72, 156, 200], x: 90, y: 16, sizeX: 90, sizeY: 70, alpha: 0.22 },
          { rgb: [58, 178, 170], x: 76, y: 106, sizeX: 85, sizeY: 75, alpha: 0.2 },
        ],
      },
    },
  },
  {
    id: "slate",
    accentRgb: "71, 85, 105",
    palettes: {
      light: {
        baseStart: "#e8edf3",
        baseMiddle: "#eaedf2",
        baseEnd: "#e1e9ef",
        fields: [
          { rgb: [116, 136, 164], x: 8, y: -8, sizeX: 110, sizeY: 95, alpha: 0.36 },
          { rgb: [166, 184, 204], x: 90, y: 20, sizeX: 85, sizeY: 75, alpha: 0.34 },
          { rgb: [130, 148, 176], x: 72, y: 106, sizeX: 90, sizeY: 85, alpha: 0.2 },
        ],
      },
      dark: {
        baseStart: "#1c2531",
        baseMiddle: "#19202b",
        baseEnd: "#18212d",
        fields: [
          { rgb: [98, 118, 148], x: 8, y: -8, sizeX: 115, sizeY: 95, alpha: 0.26 },
          { rgb: [146, 166, 190], x: 92, y: 18, sizeX: 90, sizeY: 75, alpha: 0.16 },
          { rgb: [112, 132, 162], x: 74, y: 108, sizeX: 95, sizeY: 85, alpha: 0.18 },
        ],
      },
    },
  },
];

const fieldGradient = (field: ThemeAmbientField) =>
  `radial-gradient(${field.sizeX}% ${field.sizeY}% at ${field.x}% ${field.y}%, rgba(${field.rgb.join(", ")}, ${field.alpha}) 0%, transparent 60%)`;

/** 生成 Theme Picker 微型预览使用的背景（与 Theme.css 的 Atmosphere 结构一致）。 */
export function buildThemePreviewGradient(theme: ThemeDefinition, mode: ThemeMode): string {
  const palette = theme.palettes[mode];
  const fields = palette.fields.map(fieldGradient);
  return [
    ...fields,
    `linear-gradient(160deg, ${palette.baseStart} 0%, ${palette.baseMiddle} 46%, ${palette.baseEnd} 100%)`,
  ].join(", ");
}

export function getThemeDefinition(id: AccentThemeId): ThemeDefinition {
  const fallback = THEME_DEFINITIONS[0];
  if (!fallback) throw new Error("Theme definitions are empty");
  return THEME_DEFINITIONS.find((theme) => theme.id === id) ?? fallback;
}
