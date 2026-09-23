/**
 * 尺寸计算器：验证「更紧凑」的目标能否达成。
 *
 * 用户要求：整体小一点，让门前排不换行。
 * 关键约束：门前要放 13 张，牌表一行要放 9 张。
 *
 * 用法：node --experimental-strip-types scripts/calc-sizes.ts
 */

const VIEWPORTS = [
  { name: "iPhone SE / 小米 4.7\"", w: 320 },
  { name: "常见 5.5\"~6.1\"", w: 360 },
  { name: "大屏 6.5\"+", w: 393 },
  { name: "iPhone Pro Max", w: 430 },
  { name: "平板", w: 480 },
];

/** 页面横向占用：body 无 padding，卡片左右各 8px padding + 2px 边框 ×2 */
const CARD_CHROME = 8 * 2 + 2 * 2; // = 20
/** 手牌区一行内每张牌之间的 gap */
const GAP = 1.5;

type Plan = { label: string; tile: number };

const PLANS: Plan[] = [
  { label: "当前（门23 / 表34）", tile: 23 },
  { label: "再小一档（门21 / 表32）", tile: 21 },
  { label: "最小（门20 / 表30）", tile: 20 },
];

console.log("=== 尺寸可行性 ===\n");
console.log("约束 1：门前 13 张必须一行放得下，不换行");
console.log("约束 2：牌表一行 9 张 + 文字标签要放得下\n");

for (const vp of VIEWPORTS) {
  const avail = vp.w - CARD_CHROME;
  console.log(`--- ${vp.name}（${vp.w}px，可用 ${avail}px）---`);
  for (const plan of PLANS) {
    // 门前 13 张（用 size-lg = plan.tile，但门前比牌表更小，这里按门前算）
    const handNeed = 13 * plan.tile + 12 * GAP;
    // 牌表 9 张（size-md，比门前略大 1.4 倍左右；这里直接给牌表尺寸）
    const pickerTile = Math.round(plan.tile * 1.45);
    const pickerNeed = 9 * pickerTile + 8 * GAP;

    const handOk = handNeed <= avail;
    const pickerOk = pickerNeed <= avail;

    console.log(
      `  ${plan.label.padEnd(26)} 门前13张需 ${handNeed.toFixed(0)}px ${handOk ? "✅" : "❌ 换行"}   ` +
        `牌表9张需 ${pickerNeed.toFixed(0)}px（每张${pickerTile}px）${pickerOk ? "✅" : "❌ 换行"}`,
    );
  }
  console.log("");
}

console.log("=== 结论 ===");
console.log("门牌宽 21px 时：");
for (const vp of VIEWPORTS) {
  const avail = vp.w - CARD_CHROME;
  const need = 13 * 21 + 12 * GAP;
  const pickerTile = 30;
  const pickerNeed = 9 * pickerTile + 8 * GAP;
  console.log(
    `  ${String(vp.w).padStart(3)}px 屏：门前需 ${need.toFixed(0)}px ${need <= avail ? "✅" : "❌"}，` +
      `牌表需 ${pickerNeed.toFixed(0)}px ${pickerNeed <= avail ? "✅" : "❌"}`,
  );
}
