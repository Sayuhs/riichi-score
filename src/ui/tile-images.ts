/**
 * 牌面图片映射：把天凤记法（`1m`/`0p`/`5z`）映射到 FluffyStuff 的 SVG 文件名。
 *
 * 素材来源：FluffyStuff/riichi-mahjong-tiles
 * 许可证：**public domain / CC0 1.0**（已核对 LICENSE 原文，随素材一起放在 tiles/ 下）
 *
 * ## ⚠️ 为什么用 Red 而不是 Black（踩过的坑）
 *
 * 素材有三套配色，我一开始选了 Black，结果是错的。实测各套的**文字颜色是反的**：
 *
 *   | 配色   | Ton.svg（东）的字色 | Front.svg 牌面底色 | 适用场景 |
 *   |--------|--------------------|-------------------|---------|
 *   | Black  | `#ffffff` 白色      | `#1e1e1e` 深灰     | 深色牌面 |
 *   | Red    | `#142896` 深蓝      | `#f5f0eb` 米白     | 浅色牌面 |
 *   | Yellow | `#142896` 深蓝      | `#f5f0eb` 米白     | 浅色牌面 |
 *
 * 我一开始只比对了「文件字节是否相同」，发现 Red 与 Yellow 的 40 个文件里
 * 39 个字节一样，就误以为「只差牌背」，于是删掉了 Red/Yellow。
 * **但字节相同不等于语义相同** —— Red/Yellow 的牌面文字是深色的，
 * 正是浅色牌面需要的。用 Black（白字）配白色底板，东西南北白发中
 * 和一万~九万的「萬」字就全看不见了；筒/索因为有深色描边所以碰巧还在。
 *
 * 结论：**浅色底板必须配 Red 这套**。
 * 只用一套（Red），构建产物约 0.8MB。
 *
 * ## 为什么不直接用 Unicode 麻将字符
 *
 * `🀄`(U+1F004) 是整个 Unicode 麻将区块里唯一的 emoji，
 * 在 Windows 上会被 Segoe UI Emoji 劫持渲染成彩色表情，而「中」是高频牌。
 * 其余字符在 Android/iOS 上也有变豆腐块的风险。
 */

/** 使用哪一套配色（见上方说明：浅色底必须用 Red） */
const COLOR_SET = "Red";

/** 数牌：天凤记法的花色 -> 素材的文件名前缀 */
const SUIT_PREFIX: Record<"m" | "p" | "s", string> = {
  m: "Man",
  p: "Pin",
  s: "Sou",
};

/** 字牌：1z..7z 对应素材文件名 */
const HONOR_FILE: Record<string, string> = {
  "1z": "Ton", // 东
  "2z": "Nan", // 南
  "3z": "Shaa", // 西
  "4z": "Pei", // 北
  "5z": "Haku", // 白
  "6z": "Hatsu", // 发
  "7z": "Chun", // 中
};

/**
 * 取某张牌的 SVG 文件名（不含目录与扩展名）。
 * 赤 5 用 `-Dora` 后缀的文件（0m -> Man5-Dora）。
 */
export function tileSvgName(token: string): string {
  const rank = token[0]!;
  const suit = token[1]!;

  if (suit === "z") {
    const name = HONOR_FILE[token];
    if (!name) throw new Error(`未知字牌: ${token}`);
    return name;
  }

  const prefix = SUIT_PREFIX[suit as "m" | "p" | "s"];
  if (!prefix) throw new Error(`未知花色: ${token}`);

  // 赤 5：0m / 0p / 0s -> Man5-Dora / Pin5-Dora / Sou5-Dora
  if (rank === "0") return `${prefix}5-Dora`;
  return `${prefix}${rank}`;
}

/** 牌的 SVG 完整路径（给 <img src> 用） */
export function tileSvgPath(token: string): string {
  return `tiles/${COLOR_SET}/${tileSvgName(token)}.svg`;
}

/** 牌的背面（盖着的牌） */
export function tileBackPath(): string {
  return `tiles/${COLOR_SET}/Back.svg`;
}

// ---------------------------------------------------------------- 牌表

/** 34 种基本牌，按 UI 上的排列顺序（万筒索字，各 1-9 / 1-7） */
export const ALL_TILE_KINDS: string[] = [
  ...["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((r) => `${r}m`),
  ...["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((r) => `${r}p`),
  ...["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((r) => `${r}s`),
  "1z", "2z", "3z", "4z", "5z", "6z", "7z",
];

/** 赤 5 的三种，在牌表里单独一行 */
export const RED_FIVE_KINDS: string[] = ["0m", "0p", "0s"];

/**
 * 一屏点选用的牌表（Q7：一屏点选为主）。
 *
 * 按「万 / 筒 / 索 / 字 / 赤5」排成 5 行，每行一个花色 ——
 * 这样找牌时眼睛只要横扫一行，比混合排列快得多。
 */
export const PICKER_ROWS: string[][] = [
  ALL_TILE_KINDS.slice(0, 9), // 万
  ALL_TILE_KINDS.slice(9, 18), // 筒
  ALL_TILE_KINDS.slice(18, 27), // 索
  ALL_TILE_KINDS.slice(27, 34), // 字
  RED_FIVE_KINDS, // 赤 5
];
