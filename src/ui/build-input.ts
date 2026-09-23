/**
 * M2 → M1 的接缝：把手牌录入状态 + 局面状态拼成 Scorer 要的 HandInput。
 *
 * 这是两个里程碑之间唯一的接口，也是**最容易出错的地方** ——
 * 张数契约、副露类型映射、座位补全都在这里完成。
 * 所以单独成文件、单独测试。
 */
import type { HandInput, Meld, Seat, WinContext } from "../score/types.ts";
import type { HandState } from "./hand-state.ts";
import { expectedConcealedCount, isComplete } from "./hand-state.ts";
import type { GameState } from "./game-state.ts";
import { KAMICHA } from "./game-state.ts";

export type BuildResult =
  | { ok: true; input: HandInput }
  | { ok: false; reason: string };

/**
 * 把手牌状态 + 局面状态拼成 HandInput。
 *
 * 返回 `{ok:false}` 而不是抛异常：录入过程中手牌不完整是正常状态，
 * 界面需要的是"能不能算"，而不是崩溃。
 */
export function buildHandInput(hand: HandState, game: GameState): BuildResult {
  if (hand.winningTile === null) {
    return { ok: false, reason: "还没有和牌张" };
  }

  const expected = expectedConcealedCount(hand.melds);
  if (hand.concealed.length !== expected) {
    return {
      ok: false,
      reason: `门前牌应当是 ${expected} 张，现在是 ${hand.concealed.length} 张`,
    };
  }

  if (hand.melds.some((m) => m.tiles.length !== 3 && m.tiles.length !== 4)) {
    return { ok: false, reason: "有副露的张数不对" };
  }

  const context: WinContext = {
    roundWind: game.roundWind,
    seatWind: game.seatWind,
    winType: game.winType,
    ...(game.winType === "ron" ? { from: game.from } : {}),

    isRiichi: game.isRiichi,
    isDoubleRiichi: game.isDoubleRiichi,
    isIppatsu: game.isIppatsu,
    isHaitei: game.isHaitei,
    isHoutei: game.isHoutei,
    isRinshan: game.isRinshan,
    isChankan: game.isChankan,
    isTenhou: game.isTenhou,
    isChiihou: game.isChiihou,

    doraIndicators: game.doraIndicators,
    uradoraIndicators: game.uradoraIndicators,

    honba: game.honba,
    riichiSticks: game.riichiSticks,

    ruleset: game.ruleset,
  };

  return {
    ok: true,
    input: {
      concealed: hand.concealed,
      melds: toEngineMelds(hand, game.seatWind),
      winningTile: hand.winningTile,
      context,
    },
  };
}

/**
 * 把 UI 的副露组转成引擎要的 Meld。
 *
 * 两件事：类型映射，以及**给 `from` 补默认值**。
 * `run`（吃）必须来自上家，这是规则决定的，UI 不该让用户操心；
 * 其余类型的 `from` 只影响显示，不影响算分，所以给个合理默认。
 */
export function toEngineMelds(hand: HandState, seatWind: Seat): Meld[] {
  return hand.melds.map((m) => {
    const tiles = [...m.tiles];

    if (m.kind === "ankan") {
      // 暗杠没有鸣牌来源，也没有被鸣的牌
      return { type: "ankan" as const, tiles };
    }

    // 吃只能来自上家
    const from =
      m.kind === "run"
        ? KAMICHA[seatWind]
        : // 碰/杠的来源不影响算分，默认取上家之外的第一个座位
          (["east", "south", "west", "north"] as Seat[]).find(
            (s) => s !== seatWind && s !== KAMICHA[seatWind],
          ) ?? "west";

    // 被鸣的牌：顺子取中间张（不影响算分），刻子取第一张
    const calledIndex = m.kind === "run" ? 1 : 0;

    return {
      type: m.kind as Meld["type"],
      tiles,
      from,
      calledIndex,
    };
  });
}

/** 一手牌是否具备"可以算番"的条件 */
export function canScore(hand: HandState): boolean {
  return isComplete(hand);
}
