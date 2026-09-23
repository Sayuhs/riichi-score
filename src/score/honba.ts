/**
 * 本场数（积棒）与立直棒的补算。
 *
 * `riichi-score` **完全不处理**这两项（实测：honbaCount 字段存在但输出不变，
 * 立直棒连字段都没有），所以这一层是我们自己加的。
 *
 * 规则（天凤）：
 *  - 本场：和牌时每本场额外 300 点，由放铳者独付（荣和）；自摸时每家各付 100 点
 *  - 立直棒：供托中每根 1000 点，全部归和牌者
 */
import type { Payment, Seat, WinContext } from "./types";

const ALL_SEATS: Seat[] = ["east", "south", "west", "north"];

export function isDealer(context: Pick<WinContext, "seatWind">): boolean {
  return context.seatWind === "east";
}

/**
 * 本场数带来的额外支付。
 *
 * 荣和：放铳者付 300 × honba
 * 自摸：除和牌者外每家付 100 × honba（含亲家，天凤规则下本场不区分亲闲）
 */
export function honbaPayments(
  honba: number,
  context: Pick<WinContext, "winType" | "seatWind" | "from">,
): Payment[] {
  if (!Number.isInteger(honba) || honba <= 0) return [];

  if (context.winType === "ron") {
    if (!context.from) return [];
    return [{ seat: context.from, value: 300 * honba }];
  }

  return ALL_SEATS.filter((seat) => seat !== context.seatWind).map((seat) => ({
    seat,
    value: 100 * honba,
  }));
}

/** 立直棒收入：每根 1000 点，全归和牌者 */
export function riichiBonus(riichiSticks: number): number {
  if (!Number.isInteger(riichiSticks) || riichiSticks <= 0) return 0;
  return 1000 * riichiSticks;
}

/** 把两组合并到同一座位（用于把本场加进引擎的支付明细） */
export function mergePayments(a: Payment[], b: Payment[]): Payment[] {
  const bySeat = new Map<Seat, number>();
  for (const { seat, value } of [...a, ...b]) {
    bySeat.set(seat, (bySeat.get(seat) ?? 0) + value);
  }
  return ALL_SEATS.filter((seat) => bySeat.has(seat)).map((seat) => ({
    seat,
    value: bySeat.get(seat)!,
  }));
}

export function sumPayments(payments: Payment[]): number {
  return payments.reduce((sum, p) => sum + p.value, 0);
}
