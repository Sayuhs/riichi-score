/**
 * 手牌录入的状态模型。
 *
 * 这是纯逻辑，**不依赖 Vue**，所以能独立测试。
 * UI 只负责把用户操作翻译成这里的动作，并渲染这里的状态。
 *
 * 关键概念：
 *  - 「门前牌」与「和牌张」分开存。和牌张单独一个槽位，
 *    因为它决定听牌形（两面/嵌张/边张/单骑），直接影响符数。
 *  - 副露按组存，每组 3 或 4 张。
 *  - 状态里保留「文本原文」，让用户能直接编辑文本 —— 这是 Q19 要求的
 *    排错救命通道，所以文本与结构化状态必须双向同步。
 */
import type { Meld } from "../score/types.ts";
import {
  formatHandText,
  isValidTile,
  parseHandText,
  segmentSort,
  sortTiles,
  type ParsedHandText,
} from "./tiles.ts";

export type MeldKind = "run" | "triplet" | "ankan" | "daiminkan" | "shouminkan";

export interface MeldedGroup {
  /** 稳定 id，供 Vue 的 :key 与增删使用 */
  id: number;
  /** 副露类型。默认按牌的形态猜测（连续=顺，相同=刻） */
  kind: MeldKind;
  tiles: string[];
  /**
   * 这组副露前面有多少张门前牌 —— 决定它在文本里的摆放位置。
   * 记下来是为了「文本 → 状态 → 文本」往返一致（见 tiles.ts 的 formatHandText）。
   * `undefined` 表示放末尾。
   */
  position?: number;
}

export interface HandState {
  /** 门前的暗牌，**不含和牌张** */
  concealed: string[];
  /** 和牌张，未录入时为 null */
  winningTile: string | null;
  /** 副露组 */
  melds: MeldedGroup[];
  /** 最近一次操作的提示信息（如「已加入 3 张」） */
  notice: string | null;
  /** 解析文本时的错误，供 UI 高亮显示 */
  textErrors: string[];
}

let nextMeldId = 1;

export function createEmptyHand(): HandState {
  return { concealed: [], winningTile: null, melds: [], notice: null, textErrors: [] };
}

/**
 * 门前（暗）牌的期望张数 = 13 - 3×副露组数。
 *
 * 这是与 Scorer 的硬契约（M1 实测得出）：
 *   concealed 张数 + 副露组数 × 3 + 1（和牌张） = 14
 * 而 riichi-score 的 `closedTiles` 恰好要 13 张（不含和牌张），
 * 所以录入界面的门前牌也必须是 13 - 3×副露组数 张。
 *
 * 一副完整手牌 14 张的构成：
 *   门前 13 张（听牌形） + 和牌张 1 张
 *   若有一组副露：门前 10 张 + 副露 3 张 + 和牌张 1 张
 */
export function expectedConcealedCount(melds: MeldedGroup[]): number {
  return 13 - 3 * melds.length;
}

/**
 * 当前是否已经凑齐。
 *
 * 两个条件缺一不可：
 *   1. 门前牌张数 == 13 - 3×副露组数
 *   2. 和牌张已指定
 *
 * ⚠️ 和牌张**不**计入门前张数。因为 Scorer 要的是「13 张听牌形 + 单独一张和牌张」。
 * 这也解释了为什么「把手里一张点成和牌张」之后门前会少一张、
 * 需要再补一张才完整 —— 那是正确的：14 张里有一张属于和牌张，
 * 暗牌部分本来就该只剩 13 张。
 */
export function isComplete(state: HandState): boolean {
  if (state.winningTile === null) return false;
  return state.concealed.length === expectedConcealedCount(state.melds);
}

/**
 * 门前还差几张牌。
 *
 * 注意：这里**不把和牌张算进去** —— 和牌张是独立的第 14 张，
 * 界面上应当分别提示「门前还差几张」与「和牌张是否已定」。
 */
export function remainingSlots(state: HandState): number {
  return expectedConcealedCount(state.melds) - state.concealed.length;
}

// ---------------------------------------------------------------- 动作

/**
 * 智能加牌 —— 这是 UI 主流程真正调用的入口。
 *
 * 规则（Q9 A）：门前满了之后再点一张，那张**自动成为和牌张**。
 * 这样录一手牌就是"把 14 张按顺序点完"，不需要额外去指定哪张是和牌张 ——
 * 线下念牌时本来就是"手里这 13 张……最后摸到这张"，顺序本身就是信息。
 *
 * 满了之后继续点则拒绝：静默留着多余的牌，会让"看着 14 张、实际算了 15 张"
 * 这种错误极难发现。
 */
export function addTile(state: HandState, tile: string): HandState {
  if (!isValidTile(tile)) {
    return { ...state, notice: `'${tile}' 不是合法的牌`, textErrors: [] };
  }
  if (countKind(state, tile) >= 4) {
    return { ...state, notice: `'${tile}' 已经有 4 张了`, textErrors: [] };
  }

  const full = state.concealed.length >= expectedConcealedCount(state.melds);

  // 门前已满：若还没有和牌张，这一张就成为和牌张
  if (full) {
    if (state.winningTile === null) {
      return { ...state, winningTile: tile, notice: null, textErrors: [] };
    }
    return {
      ...state,
      // ⚠️ 不要把张数写死在这句话里。
      //    以前写的是「牌已经录满了（14 张）」—— 但有杠时物理牌是 15/16/17/18 张，
      //    用户看到「14」就会以为应用算错了，这正是他报「限制 14 张」困惑的来源。
      //    界面统一按**物理张数**口径说话，具体数字交给顶栏的计数显示。
      notice: "牌已经录满了。要换某张牌，先点掉它再点新的。",
      textErrors: [],
    };
  }

  return {
    ...state,
    concealed: sortTiles([...state.concealed, tile]),
    notice: null,
    textErrors: [],
  };
}

/**
 * 往门前牌里加入一张（严格版，不自动转和牌张）。
 * UI 用 `addTile`；这个保留给测试与需要精确控制的场合。
 */
export function addConcealed(state: HandState, tile: string): HandState {
  if (!isValidTile(tile)) {
    return { ...state, notice: `'${tile}' 不是合法的牌`, textErrors: [] };
  }
  const expected = expectedConcealedCount(state.melds);
  if (state.concealed.length >= expected) {
    return {
      ...state,
      notice: `门前牌已满（${expected} 张）。要换牌请先删掉一张，或把这张设为和牌张。`,
      textErrors: [],
    };
  }
  // 同种牌最多 4 张（赤 5 与普通 5 同种，合计也不超过 4）
  if (countKind(state, tile) >= 4) {
    return { ...state, notice: `'${tile}' 已经有 4 张了`, textErrors: [] };
  }
  return {
    ...state,
    concealed: sortTiles([...state.concealed, tile]),
    notice: null,
    textErrors: [],
  };
}

/** 统计某张牌在实际使用中的张数（赤 5 与普通 5 视为同种） */
export function countKind(state: HandState, tile: string): number {
  const norm = (t: string) => (t[0] === "0" ? `5${t[1]}` : t);
  const target = norm(tile);
  const all = [
    ...state.concealed,
    ...(state.winningTile ? [state.winningTile] : []),
    ...state.melds.flatMap((m) => m.tiles),
  ];
  return all.filter((t) => norm(t) === target).length;
}

/**
 * 撤回（删掉）任意一张牌之后的收尾。
 *
 * ⚠️ 和牌张必须**一起清掉**，不能留着。
 *
 * 和牌张是「门前满员之后再点的那张」**自动认定**的（见 `addTile`，Q9 A）。
 * 撤回一张牌之后门前就不再满员，那份认定的前提已经不存在了：
 * 用户补录的那张会进门前（而不是当和牌张），于是状态悄悄错位 ——
 * 界面上还挂着一个和牌张，但它已经不是「最后点的那张」了。
 *
 * 而和牌张决定听牌形（两面 / 嵌张 / 边张 / 单骑），直接算错符数 ——
 * 这种错很难靠肉眼发现，所以宁可让用户重新点一次。
 */
function afterWithdraw(state: HandState): Pick<HandState, "winningTile" | "notice"> {
  return {
    winningTile: null,
    notice: state.winningTile
      ? "已撤掉一张牌，和牌张也一并重置了 —— 请重新点最后一张"
      : null,
  };
}

/** 删除门前牌中指定下标的一张（Q19：必须能单张删，否则点错只能全清） */
export function removeConcealedAt(state: HandState, index: number): HandState {
  if (index < 0 || index >= state.concealed.length) return state;
  const next = [...state.concealed];
  next.splice(index, 1);
  return { ...state, concealed: next, ...afterWithdraw(state), textErrors: [] };
}

/**
 * 把门前牌里的某一张设为和牌张（「我手里这张就是和牌张」）。
 *
 * 语义上与 `^` 标记一致：因为这张牌**本来就在门前牌里**，所以要从门前移除，
 * 否则会重复计数（Scorer 要求门前 13 张 + 和牌张单独一张）。
 *
 * 若 `index` 给定了，就移走那一张 —— 这样用户点哪张就是哪张，
 * 不会出现「点了第 1 张 4p、结果删掉第 2 张 4p」的困惑。
 */
export function setWinningTileFromHand(state: HandState, index: number): HandState {
  const tile = state.concealed[index];
  if (tile === undefined) return state;
  const next = [...state.concealed];
  next.splice(index, 1);
  return { ...state, winningTile: tile, concealed: next, notice: null, textErrors: [] };
}

/**
 * 设置和牌张（外来的一张：荣和的那张、自摸摸到的那张）。
 *
 * 若指定 `fromHandIndex`，等同于 `setWinningTileFromHand` —— 从门前移走那一张。
 * 否则门前牌不动（和牌张是额外的一张）。
 */
export function setWinningTile(
  state: HandState,
  tile: string,
  fromHandIndex?: number,
): HandState {
  if (!isValidTile(tile)) {
    return { ...state, notice: `'${tile}' 不是合法的牌` };
  }
  if (fromHandIndex !== undefined) {
    const next = [...state.concealed];
    next.splice(fromHandIndex, 1);
    return { ...state, winningTile: tile, concealed: next, notice: null, textErrors: [] };
  }
  // 外来牌：门前不变
  return { ...state, winningTile: tile, notice: null, textErrors: [] };
}

/** 清除和牌张 */
export function clearWinningTile(state: HandState): HandState {
  return { ...state, winningTile: null, notice: null };
}

/** 按形态猜副露类型 */
export function guessMeldKind(tiles: string[]): MeldKind {
  if (tiles.length === 4) {
    // 4 张相同 = 杠。暗杠还是明杠这里猜不出，默认暗杠（符数不同，UI 要能改）
    return "ankan";
  }
  const ranks = tiles.map((t) => Number(t[0]));
  const suit = tiles[0]?.[1];
  const sameSuit = tiles.every((t) => t[1] === suit);
  if (sameSuit && ranks.every((r) => r === ranks[0])) return "triplet";
  return "run";
}

/** 加入一组副露 */
/**
 * 一手牌的**物理张数** —— 实际摆在桌上的牌数。
 *
 * ## 为什么需要它（和「逻辑张数」的区别）
 *
 *   逻辑张数（引擎的契约）= 门前 + 副露组数×3 + 1     ← 每个杠只算 3 张
 *   物理张数（用户看到的）  = 门前 + 副露实际张数 + 1  ← 杠算 4 张
 *
 * 两者在没有杠时都是 14；有 1 个杠时逻辑仍是 14、物理是 15。
 *
 * **界面只展示物理张数** —— 用户能数出来的就是这么多张牌。
 * 「逻辑 14」是我们和引擎之间的内部约定，给用户看只会造成困惑
 * （之前那句「牌已经录满了（14 张）」就是这么把用户绕进去的）。
 */
export function physicalTileCount(state: HandState): number {
  const melded = state.melds.reduce((n, m) => n + m.tiles.length, 0);
  return state.concealed.length + melded + (state.winningTile ? 1 : 0);
}

/**
 * 一手完整手牌的**物理张数目标** = 14 + 杠数。
 *
 * 每多一个杠就多一张实体牌（杠是 4 张，但只占 3 格手牌位）。
 * 这就是用户说的「动态调整」：标一个杠，目标从 14 变成 15。
 */
export function expectedPhysicalCount(melds: MeldedGroup[]): number {
  const kans = melds.filter((m) => m.tiles.length === 4).length;
  return 14 + kans;
}

/** 门前里哪张牌刚好凑满 4 张（用于自动追问「这 4 张是杠吗？」） */
export function kanCandidate(state: HandState): string | null {
  const norm = (t: string) => (t[0] === "0" ? `5${t[1]}` : t);
  const counts = new Map<string, { n: number; sample: string }>();
  for (const t of state.concealed) {
    const k = norm(t);
    const cur = counts.get(k) ?? { n: 0, sample: t };
    cur.n += 1;
    counts.set(k, cur);
  }
  for (const [, v] of counts) if (v.n === 4) return v.sample;
  return null;
}

/**
 * 把门前的 4 张同种牌提升为一组杠。
 *
 * ## 为什么必须由用户明确指定，而不能自动推断
 *
 * 「4 张同牌」不等于「杠」。实测过的反例：
 *
 *     1111m（杠）+ 2222m（**不是杠**）+ 345p + 99s
 *
 * 15 张实体牌，引擎正确地把 2222m 拆成 222m 刻子 + 234m 顺子里的那张。
 * 如果看到 4 张就当成杠，这手牌会**多算一个杠**（番符全错）。
 *
 * 所以这里做成一个明确的动作，由 UI 在用户确认后才调用。
 *
 * @param kind 暗杠还是明杠 —— 符数不同（16/32 vs 8/16），
 *             而且暗杠不破门清、算暗刻（影响三暗刻/四暗刻）。
 */
export function promoteToKan(
  state: HandState,
  tile: string,
  kind: "ankan" | "daiminkan",
): HandState {
  const norm = (t: string) => (t[0] === "0" ? `5${t[1]}` : t);
  const target = norm(tile);

  // ⚠️ 和牌张不能属于杠。真实牌局里不可能 ——
  //    杠的 4 张在和牌之前就都已经在手里了。
  //    这里拒绝而不是「自动清掉和牌张」：那等于偷偷改动用户已录的东西，
  //    会让他少一张牌却不明显。
  if (state.winningTile && norm(state.winningTile) === target) {
    return {
      ...state,
      notice:
        "这 4 张里有 1 张是当前的「和牌张」。杠的 4 张在和牌前就都在手里，请先把和牌张改成别的牌。",
      textErrors: [],
    };
  }

  const four = state.concealed.filter((t) => norm(t) === target);
  if (four.length !== 4) {
    return {
      ...state,
      notice: `门前只有 ${four.length} 张 ${tile}，凑不满一组杠`,
      textErrors: [],
    };
  }

  // 把这 4 张从门前移走
  const rest = [...state.concealed];
  for (let i = 0; i < 4; i++) {
    const idx = rest.findIndex((t) => norm(t) === target);
    if (idx >= 0) rest.splice(idx, 1);
  }

  const meld: MeldedGroup = {
    id: nextMeldId++,
    kind,
    tiles: sortTiles(four),
  };

  return {
    ...state,
    concealed: rest,
    melds: [...state.melds, meld],
    notice: null,
    textErrors: [],
  };
}

/**
 * 取消一组**暗杠**，把 4 张牌退回门前。
 *
 * ## 为什么不能直接复用 `removeMeld`
 *
 * 吃 / 碰的牌是从**别人那里**要来的 —— 删掉这组就是「这 3 张不属于我」，
 * 牌从手牌里消失是对的。
 *
 * 暗杠完全不同：那 4 张**一直是自己的牌**（`promoteToKan` 就是从门前
 * 把它们搬走的）。删掉时如果让它们凭空消失，用户就得重新点 4 次 ——
 * 而他的意思明明只是「这个杠标错了 / 我不要了」。
 * 所以这个动作做的是**撤销**，不是删除。
 *
 * ## 退回之后门前可能多 1 张 —— 只提示，不替用户删
 *
 * 标杠时门前目标从 13 掉到 10（少 3 张），但那组杠占 4 张实体牌，
 * 所以界面会要求用户再补 1 张（物理张数才回到 15）。
 * 取消杠时 4 张全退回来，若他已经补过，门前就会多出 1 张。
 *
 * 这不是算错，而是真实信息：拆掉杠之后，那 4 张里有 1 张是多余的。
 * 删哪一张只有用户知道，所以这里只给出张数，让他自己决定。
 *
 * @param id 要取消的那组暗杠。**kind 不是 `ankan` 时原样返回** ——
 *           明杠 / 加杠的 4 张里有一张是别人打的牌，「退回门前」不成立。
 */
export function unpromoteKan(state: HandState, id: number): HandState {
  const meld = state.melds.find((m) => m.id === id);
  if (!meld || meld.kind !== "ankan") return state;

  const melds = state.melds.filter((m) => m.id !== id);
  const back = sortTiles([...state.concealed, ...meld.tiles]);
  const over = back.length - expectedConcealedCount(melds);

  const parts = ["已取消杠，4 张退回门前"];
  if (over > 0) parts.push(`门前多了 ${over} 张，请删掉`);
  if (state.winningTile) {
    // 和牌张是「门前满员之后再点的那张」自动认定的（见 afterWithdraw），
    // 门前张数一变，那份认定的前提就没了。
    parts.push("和牌张也一并重置了 —— 请重新点最后一张");
  }

  return {
    ...state,
    concealed: back,
    melds,
    winningTile: null,
    notice: `${parts.join("；")}。`,
    textErrors: [],
  };
}

/**
 * 校验一组副露的形态是否合法。返回 `null` 表示合法。
 *
 * ## 为什么要自己做（引擎也会校验）
 *
 * 引擎会吐 `A run was called from south, but ...` 这种英文，
 * 而且不说是哪几张不对。自己校验能给出**中文的、具体的**提示。
 *
 * ## 规则
 *
 *   碰 / 明杠 → 必须是相同的牌
 *   吃        → 必须同一花色、且连续（如 3-4-5）
 *
 * 赤 5 与普通 5 视为同种（`0m` 和 `5m` 是一张牌的两个形态）。
 */
export function checkMeldShape(kind: MeldKind, tiles: string[]): string | null {
  if (tiles.length === 0) return "还没有选牌";
  const norm = (t: string) => (t[0] === "0" ? `5${t[1]}` : t);
  const ns = tiles.map(norm);

  if (kind === "triplet" || kind === "daiminkan" || kind === "ankan") {
    const want = kind === "triplet" ? 3 : 4;
    if (tiles.length !== want) return `需要 ${want} 张`;
    if (!ns.every((t) => t === ns[0])) {
      return kind === "triplet" ? "碰需要 3 张相同的牌" : "杠需要 4 张相同的牌";
    }
    return null;
  }

  // 吃
  if (tiles.length !== 3) return "吃需要 3 张";
  const suit = ns[0]![1];
  if (!ns.every((t) => t[1] === suit)) return "吃需要同一花色的三张牌";
  const ranks = ns.map((t) => Number(t[0])).sort((a, b) => a - b);
  if (ranks[1] !== ranks[0]! + 1 || ranks[2] !== ranks[1]! + 1) {
    return "吃需要连续的三张（如 3-4-5）";
  }
  return null;
}

export function addMeld(state: HandState, tiles: string[]): HandState {
  if (tiles.length !== 3 && tiles.length !== 4) {
    return { ...state, notice: `一组副露必须是 3 或 4 张，收到 ${tiles.length} 张` };
  }
  if (!tiles.every(isValidTile)) {
    return { ...state, notice: "副露里有不合法的牌" };
  }
  const meld: MeldedGroup = {
    id: nextMeldId++,
    kind: guessMeldKind(tiles),
    tiles: sortTiles(tiles),
  };
  // 副露变多后，门前牌上限变小；若超了要提示，但不能偷偷丢牌
  const nextMelds = [...state.melds, meld];
  const over = state.concealed.length - expectedConcealedCount(nextMelds);
  return {
    ...state,
    melds: nextMelds,
    notice:
      over > 0
        ? `加了副露后门前牌超了 ${over} 张，请删掉几张`
        : null,
    textErrors: [],
  };
}

/**
 * 删除一组副露。
 *
 * 副露少一组 → 门前要多 3 张，同样会把「和牌张已经认定过」这个前提打掉，
 * 所以和牌张一起重置（理由见 `afterWithdraw`）。
 */
export function removeMeld(state: HandState, id: number): HandState {
  if (!state.melds.some((m) => m.id === id)) return state;
  return {
    ...state,
    melds: state.melds.filter((m) => m.id !== id),
    ...afterWithdraw(state),
    textErrors: [],
  };
}

/** 修改副露类型（暗杠 vs 明杠的符数不同，必须让用户能改） */
export function setMeldKind(state: HandState, id: number, kind: MeldKind): HandState {
  return {
    ...state,
    melds: state.melds.map((m) => (m.id === id ? { ...m, kind } : m)),
    notice: null,
  };
}

/** 清空全部 */
export function clearAll(): HandState {
  return createEmptyHand();
}

// ---------------------------------------------------------------- 文本互通

/**
 * 把状态导出成可编辑文本。
 *
 * 和牌张用 `+` 附加在末尾（与 `textToState` 的约定对应）。
 * 因为状态里已经保证了「和牌张不在门前牌中」，所以导出时用 `+`（外来）
 * 语义即可，再导入回来结果一致，不会重复删牌。
 */
export function stateToText(state: HandState): string {
  const hand: ParsedHandText = {
    concealed: state.concealed,
    melds: state.melds.map((m) => m.tiles),
    meldPositions: state.melds.map((m) => m.position ?? state.concealed.length),
  };
  const base = formatHandText(hand);
  return state.winningTile ? `${base}+${state.winningTile}` : base;
}

/**
 * 从文本导入状态。
 *
 * ## 和牌张的表示法
 *
 * 用 `+` 前缀标出和牌张，但它有**两种语义**，必须区分：
 *
 *  - `+` 后面写一张**门前已有的牌**（且用 `^` 标记）→ 「我手里这张就是和牌张」
 *  - 普通 `+xxx` → 「这是别人打的牌，我荣和/自摸」→ 门前不动
 *
 * 为了避免歧义（`456p` 里的 4p 和单独一张 4p 长得一样），约定：
 *
 *  - **`+` = 外来和牌张**（荣和的那张、自摸摸到的那张），门前牌不受影响
 *  - **`^` = 取自门前的和牌张**（把手里已有的牌点成和牌张），会从门前移走一张
 *
 * 这样两种场景都表达得清楚，也不会因为「同种牌在门前已存在」而误删。
 * 若两者都没写，和牌张留空，让用户在界面上点选。
 */
export function textToState(text: string, prev?: HandState): HandState {
  const errors: string[] = [];

  // 切出和牌张标记。`^` 优先（取自门前），其次 `+`（外来）
  let winning: string | null = null;
  let winningFromHand = false;
  let body = text;

  const caretMatch = text.match(/\^([0-9][mpsz])/);
  const plusMatch = text.match(/\+([0-9][mpsz])/);
  if (caretMatch) {
    winning = caretMatch[1]!;
    winningFromHand = true;
    body = text.replace(caretMatch[0], "");
  } else if (plusMatch) {
    winning = plusMatch[1]!;
    winningFromHand = false;
    body = text.replace(plusMatch[0], "");
  }

  const parsed = parseHandText(body);
  if (!parsed.ok) {
    return {
      concealed: prev?.concealed ?? [],
      winningTile: prev?.winningTile ?? null,
      melds: prev?.melds ?? [],
      notice: "文本里有无法解析的内容",
      textErrors: parsed.errors.map((e) => `${e.message}（第 ${e.index + 1} 个字符）`),
    };
  }

  const positions = parsed.value.meldPositions ?? [];
  const melds: MeldedGroup[] = parsed.value.melds.map((tiles, i) => ({
    id: nextMeldId++,
    kind: guessMeldKind(tiles),
    tiles: sortTiles(tiles),
    position: positions[i],
  }));

  // 只有 `^` 语义才从门前移走一张（把手里已有的牌点成和牌张）
  let concealed = parsed.value.concealed;
  if (winning && winningFromHand) {
    const idx = concealed.indexOf(winning);
    if (idx >= 0) {
      concealed = concealed.filter((_, i) => i !== idx);
    }
  }

  return {
    // 段内排序：副露位置不变，只把各段内部的牌理顺
    concealed: segmentSort(concealed, positions),
    winningTile: winning ?? (prev?.winningTile ?? null),
    melds,
    notice: null,
    textErrors: errors,
  };
}

/** 把状态转成 Scorer 需要的 Meld 数组（进行中的录入可能不完整，故做宽松处理） */
export function toScoreMelds(state: HandState): Meld[] {
  return state.melds.map((m) => {
    const type =
      m.kind === "ankan"
        ? ("ankan" as const)
        : m.kind === "daiminkan"
          ? ("daiminkan" as const)
          : m.kind === "shouminkan"
            ? ("shouminkan" as const)
            : m.kind === "triplet"
              ? ("triplet" as const)
              : ("run" as const);
    // 暗杠没有鸣牌来源；其余类型的 from 由适配器按座位补默认值
    return type === "ankan" ? { type, tiles: m.tiles } : { type, tiles: m.tiles };
  });
}
