/**
 * 牌记法解析与格式化。
 *
 * 采用**天凤 / 雀魂风格**（Q20 决议）：
 *   - 紧凑写法：`123m456p789s11122z`
 *   - 赤 5 用 `0` 表示：`0m` `0p` `0s`
 *   - 空格写法也接受：`1m 2m 3m`（自动判断，见下）
 *   - 副露用方括号：`123m456p[789s]11z` —— 方括号内为一个副露组
 *
 * 这里刻意**不做任何算番判断**，只负责「文字 <-> 牌数组」的转换，
 * 以及把副露的括号结构解析出来。规则校验交给 Scorer。
 */

/** 花色：万 / 筒 / 索 / 字 */
export type Suit = "m" | "p" | "s" | "z";

/** 解析错误，带位置信息，便于 UI 精确标出哪一段有问题 */
export interface ParseError {
  message: string;
  /** 出错处在原始字符串中的下标 */
  index: number;
}

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: ParseError[] };

/** 一个字牌的数牌范围是 1-7（东南西北白发中） */
const HONOR_MAX = 7;
/** 数牌 1-9，另加 0 表示赤 5 */
const SUIT_DIGITS = new Set(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
const SUITS = new Set<Suit>(["m", "p", "s", "z"]);

/**
 * 判断一个字符串是不是合法的单张牌，如 `1m` / `0p` / `7z`。
 */
export function isValidTile(token: string): boolean {
  if (token.length !== 2) return false;
  const rank = token[0]!;
  const suit = token[1]!;
  if (!SUITS.has(suit as Suit)) return false;
  if (!SUIT_DIGITS.has(rank)) return false;
  if (suit === "z") {
    // 字牌没有 0，也没有 8/9
    if (rank === "0") return false;
    return Number(rank) <= HONOR_MAX;
  }
  return true;
}

/** 赤 5 判定：0m / 0p / 0s */
export function isRedFive(token: string): boolean {
  return token[0] === "0";
}

/** 赤 5 折算成对应的普通牌（0p -> 5p），供显示与比较用 */
export function normalizeRedFive(token: string): string {
  return isRedFive(token) ? `5${token[1]}` : token;
}

/**
 * 牌的排序权重：万 < 筒 < 索 < 字，同花色按数字（赤 5 排在 5 的位置）
 */
export function tileSortKey(token: string): number {
  const suitOrder: Record<Suit, number> = { m: 0, p: 1, s: 2, z: 3 };
  const suit = token[1] as Suit;
  // 赤 5 与普通 5 同权，保持相邻
  const rank = token[0] === "0" ? 5 : Number(token[0]);
  return suitOrder[suit] * 100 + rank;
}

/** 按天凤习惯排序（万筒索字，同花色从小到大） */
export function sortTiles(tiles: string[]): string[] {
  return [...tiles].sort((a, b) => tileSortKey(a) - tileSortKey(b) || a.localeCompare(b));
}

/**
 * 按副露位置把手牌切成若干段。
 *
 * 段边界由 `positions` 给出：第 i 组副露前面有 `positions[i]` 张门前牌。
 * 所以段是 `[0, p1)`、`[p1, p2)`、…、`[pn, len)`。
 *
 * 为什么需要分段：用户输入 `123m456p[789s]1122z` 时副露夹在中间。
 * 如果一律全局排序后把副露挪到末尾，就会出现「输入的和显示的不一样」——
 * 这在排错时极其误导。分段排序让副露留在原位，做到往返一致。
 */
export function splitSegments(concealed: string[], positions: number[]): string[][] {
  if (positions.length === 0) return [concealed];
  const bounds = [...positions, concealed.length];
  const segments: string[][] = [];
  let prev = 0;
  for (const bound of bounds) {
    const end = Math.max(prev, Math.min(bound, concealed.length));
    segments.push(concealed.slice(prev, end));
    prev = end;
  }
  return segments;
}

/** 段内排序后拼回一维数组（副露位置不变） */
export function segmentSort(concealed: string[], positions: number[]): string[] {
  return splitSegments(concealed, positions).flatMap((seg) => sortTiles(seg));
}

// ---------------------------------------------------------------- 解析

/**
 * 把紧凑写法切成单张牌。
 *
 * 输入形如 `123m456p789s11z`，输出 `['1m','2m','3m','4p','5p','6p','7s','8s','9s','1z','1z']`。
 */
export function parseCompact(text: string): ParseResult<string[]> {
  const tiles: string[] = [];
  const errors: ParseError[] = [];
  let pending: string[] = [];
  let pendingStart = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;

    if (ch >= "0" && ch <= "9") {
      if (pending.length === 0) pendingStart = i;
      pending.push(ch);
      continue;
    }

    if (SUITS.has(ch as Suit)) {
      if (pending.length === 0) {
        errors.push({ message: `花色 '${ch}' 前面没有数字`, index: i });
        continue;
      }
      const suit = ch as Suit;
      for (const rank of pending) {
        const tile = `${rank}${suit}`;
        if (!isValidTile(tile)) {
          errors.push({
            message:
              suit === "z"
                ? `字牌只能是 1z-7z（东南西北白发中），'${tile}' 无效`
                : `'${tile}' 不是合法的牌`,
            index: pendingStart,
          });
        } else {
          tiles.push(tile);
        }
      }
      pending = [];
      continue;
    }

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "," || ch === "，") {
      // 空白与逗号是分隔符；若此时还挂着未接花色的数字，说明写法有问题
      if (pending.length > 0) {
        errors.push({
          message: `数字 '${pending.join("")}' 后面缺少花色字母（m/p/s/z）`,
          index: pendingStart,
        });
        pending = [];
      }
      continue;
    }

    // 方括号是副露的界符，对紧凑写法来说也是「数字串到此为止」的信号。
    // 必须在这里 terminate，否则 `11[1z1z1z]` 里的 `11` 会悬空报错。
    // （方括号本身的解析由 parseHandText 负责，这里只当作分隔符。）
    if (ch === "[" || ch === "]") {
      if (pending.length > 0) {
        errors.push({
          message: `数字 '${pending.join("")}' 后面缺少花色字母（m/p/s/z）`,
          index: pendingStart,
        });
        pending = [];
      }
      continue;
    }

    errors.push({ message: `无法识别的字符 '${ch}'`, index: i });
  }

  if (pending.length > 0) {
    errors.push({
      message: `数字 '${pending.join("")}' 后面缺少花色字母（m/p/s/z）`,
      index: pendingStart,
    });
  }

  return errors.length ? { ok: false, errors } : { ok: true, value: tiles };
}

/**
 * 解析「空格分开」写法：`1m 2m 3m` 或 `1m,2m,3m`。
 * 也容忍紧凑写法混在里头（如 `123m 456p`）。
 */
export function parseSpaced(text: string): ParseResult<string[]> {
  const tokens = text
    .split(/[\s,，]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const tiles: string[] = [];
  const errors: ParseError[] = [];

  for (const token of tokens) {
    if (isValidTile(token)) {
      tiles.push(token);
      continue;
    }
    // 不是单张牌，试当作紧凑写法的片段（如 `123m`）
    const sub = parseCompact(token);
    if (sub.ok && sub.value.length > 0) {
      tiles.push(...sub.value);
      continue;
    }
    errors.push({ message: `'${token}' 不是合法的牌`, index: text.indexOf(token) });
  }

  return errors.length ? { ok: false, errors } : { ok: true, value: tiles };
}

/**
 * 副露组：由方括号 `[...]` 标出。
 * 解析结果把牌分成「门前牌」与「副露组」两部分。
 */
export interface ParsedHandText {
  /** 门前（暗）牌，不含和牌张 */
  concealed: string[];
  /** 每一组副露的牌（3 或 4 张） */
  melds: string[][];
  /**
   * 每组副露在原始文本里的**摆放位置**，以「它前面有多少张门前牌」表示。
   *
   * 为什么要记这个：用户输入的 `123m456p[789s]1122z` 里副露夹在中间，
   * 如果格式化时一律把副露挪到末尾，就会出现「输入的和显示的不一样」，
   * 这种不一致在排错时极其误导。所以往返要保持原位。
   * 没有位置信息时（如程序内新建的副露）为 undefined，格式化时放末尾。
   */
  meldPositions?: number[];
}

/**
 * 解析完整手牌文本，支持方括号表示副露。
 *
 * 例：
 *   `123m456p789s1122z`          → 门前 13 张，无副露
 *   `123m456p[789s]1122z`        → 门前 10 张 + 一组副露（位于中段）
 *   `[111m][222p]123s456s11z`    → 两组副露（位于开头）
 */
export function parseHandText(text: string): ParseResult<ParsedHandText> {
  const errors: ParseError[] = [];
  const concealed: string[] = [];
  const melds: string[][] = [];
  const meldPositions: number[] = [];

  let rest = text;
  let offset = 0;

  while (rest.length > 0) {
    const open = rest.indexOf("[");
    if (open === -1) {
      // 剩下全是门前牌
      const r = parseTilesLoose(rest);
      if (!r.ok) {
        errors.push(...r.errors.map((e) => ({ ...e, index: e.index + offset })));
      } else {
        concealed.push(...r.value);
      }
      break;
    }

    // 方括号前的部分
    if (open > 0) {
      const head = rest.slice(0, open);
      const r = parseTilesLoose(head);
      if (!r.ok) {
        errors.push(...r.errors.map((e) => ({ ...e, index: e.index + offset })));
      } else {
        concealed.push(...r.value);
      }
    }

    const close = rest.indexOf("]", open);
    if (close === -1) {
      errors.push({ message: "方括号 '[' 没有对应的 ']'", index: open + offset });
      break;
    }

    const inner = rest.slice(open + 1, close);
    const r = parseTilesLoose(inner);
    if (!r.ok) {
      errors.push(...r.errors.map((e) => ({ ...e, index: e.index + open + 1 + offset })));
    } else if (r.value.length !== 3 && r.value.length !== 4) {
      errors.push({
        message: `一组副露应当是 3 张（顺/刻）或 4 张（杠），这里解析出 ${r.value.length} 张`,
        index: open + offset,
      });
    } else {
      // 记下这组副露前面已累计了多少张门前牌 —— 这就是它的位置
      meldPositions.push(concealed.length);
      melds.push(r.value);
    }

    offset += close + 1;
    rest = rest.slice(close + 1);
  }

  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: { concealed, melds, meldPositions } };
}

/** 自动判断用哪种写法解析一段牌文本 */
function parseTilesLoose(text: string): ParseResult<string[]> {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: [] };
  // 含空格/逗号 → 用空格写法；否则用紧凑写法
  if (/[\s,，]/.test(trimmed)) return parseSpaced(trimmed);
  return parseCompact(trimmed);
}

// ---------------------------------------------------------------- 格式化

const SUIT_ORDER: Suit[] = ["m", "p", "s", "z"];

/** 把牌数组格式化成紧凑写法 */
export function formatTiles(tiles: string[]): string {
  const sorted = sortTiles(tiles);
  return SUIT_ORDER.map((suit) => {
    const ranks = sorted
      .filter((t) => t[1] === suit)
      .map((t) => t[0])
      .join("");
    return ranks ? `${ranks}${suit}` : "";
  }).join("");
}

/**
 * 把整手牌格式化回可编辑文本（副露保留方括号）。
 *
 * 副露会**放回原位**：按 `meldPositions[i]` 指出它前面有多少张门前牌，
 * 把门前牌按这些位置切成若干段，每段内部排序，副露插在段之间。
 *
 * 这样用户输入 `123m456p[789s]1122z` 再编辑，副露不会莫名其妙跑到末尾 ——
 * 「输入什么就看到什么」在排错时很重要。
 *
 * 没有位置信息时（如程序内新建的副露）一律放末尾。
 */
export function formatHandText(hand: ParsedHandText): string {
  const positions = hand.meldPositions;
  const hasPositions =
    positions != null && positions.length === hand.melds.length && hand.melds.length > 0;

  if (!hasPositions) {
    const concealedPart = formatTiles(hand.concealed);
    const meldPart = hand.melds.map((m) => `[${formatTiles(m)}]`).join("");
    return concealedPart + meldPart;
  }

  // 段内排序，副露插回它原来的档位
  const segments = splitSegments(hand.concealed, positions);
  let result = "";
  for (let i = 0; i < hand.melds.length; i++) {
    result += formatTiles(segments[i] ?? []);
    result += `[${formatTiles(hand.melds[i]!)}]`;
  }
  // 最后一段（最后那组副露之后剩的门前牌）
  result += formatTiles(segments[hand.melds.length] ?? []);
  return result;
}

/** 给 UI 显示牌名用的中文标签 */
export const TILE_LABELS: Record<string, string> = {
  "1z": "东",
  "2z": "南",
  "3z": "西",
  "4z": "北",
  "5z": "白",
  "6z": "发",
  "7z": "中",
};

/**
 * 牌的显示名。
 * 数牌用 `1万`/`2筒`/`3索`，字牌用中文，赤 5 前缀 `赤`。
 */
export function tileLabel(token: string): string {
  const rank = token[0]!;
  const suit = token[1]!;
  if (suit === "z") return TILE_LABELS[token] ?? token;
  const suitName = { m: "万", p: "筒", s: "索" }[suit as "m" | "p" | "s"] ?? suit;
  if (rank === "0") return `赤5${suitName}`;
  return `${rank}${suitName}`;
}
