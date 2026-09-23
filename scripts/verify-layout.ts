/**
 * 布局预算的静态检查。
 *
 * ## 为什么需要它
 *
 * 这次「页面像被裁剪」的 bug 溜过了全部 274 个测试，也溜过了
 * `verify-build.ts` —— 因为后者只 grep 类名**是否存在**，
 * 从不检查「牌有多高」和「槽有多高」是否匹配。
 *
 * 具体地，当时 CSS 里同时存在两组互不相干的数字：
 *   - 牌宽：`min(26px, calc((100vw - 46px) / 13))`（手算，且少扣了 43px）
 *   - 槽高：`height: 30px`（写死，和牌宽公式没有任何机械联系）
 * 牌宽一改，槽高不会跟着改 —— bug 就是这么来的。
 *
 * ## 现在检查什么
 *
 * 布局已经改成 grid（列数固定、宽度交给浏览器），所以**算术基本消失了**。
 * 剩下的算术只有一处：`minmax(MIN, 1fr)` 里的下限 MIN ——
 * 它是「屏幕窄到什么时候会溢出」的阈值，必须确保在最窄的手机上不溢出。
 *
 * 除此之外检查**结构性不变量**（这些是让 bug 不可能再发生的东西）：
 *   1. 门前是固定 13 列、牌表是固定 9 列（列数一乱，牌宽就不再确定）
 *   2. 槽高必须**从容器宽度派生**（用 cqw），不能是写死的 px
 *   3. `aspect-ratio` 必须在 `.frame` 上（在 `.body` 上会被边框污染比例）
 *
 * 用法：node --experimental-strip-types scripts/verify-layout.ts
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(label: string, fn: () => void): void {
  try {
    fn();
    pass++;
    console.log(`  PASS  ${label}`);
  } catch (e) {
    fail++;
    const msg = e instanceof Error ? e.message : String(e);
    failures.push(`${label}\n      ${msg}`);
    console.log(`  FAIL  ${label}\n        ${msg}`);
  }
}

function ok(cond: boolean, label = ""): void {
  if (!cond) throw new Error(`${label}断言失败`);
}

// ---------------------------------------------------------------- 读取产物 CSS

const candidates = [
  "dist/assets",
  "dist",
];

function findCss(): string {
  for (const dir of candidates) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f) => f.endsWith(".css"));
    if (files.length) return readFileSync(`${dir}/${files[0]}`, "utf8");
  }
  return "";
}

const css = findCss();
if (!css) {
  console.log("找不到构建产物 CSS —— 先跑 pnpm run build");
  process.exitCode = 1;
  process.exit(1);
}

/** 去掉空格便于比对（CSS 会被压缩） */
const cssMin = css.replace(/\s+/g, "");

// ---------------------------------------------------------------- 1. 列数固定

console.log("\n【1】列数固定（牌宽由浏览器分配，不手算）");

check("门前是固定 13 列的 grid", () => {
  const m = cssMin.match(/\.tiles\[[^\]]*\]\{[^}]*grid-template-columns:repeat\((\d+),minmax\((\d+)px,1fr\)\)/);
  ok(!!m, "没找到 .tiles 的 grid 定义 —— 可能又退回 flex + 手算宽度了");
  ok(m![1] === "13", `列数应是 13，实际 ${m![1]}`);
  console.log(`        （列数 ${m![1]}，下限 ${m![2]}px）`);
});

check("牌表是固定 9 列的 grid", () => {
  const m = cssMin.match(/\.picker-row\[[^\]]*\]\{[^}]*grid-template-columns:repeat\((\d+),minmax\((\d+)px,1fr\)\)/);
  ok(!!m, "没找到 .picker-row 的 grid 定义");
  ok(m![1] === "9", `列数应是 9，实际 ${m![1]}`);
  console.log(`        （列数 ${m![1]}，下限 ${m![2]}px）`);
});

// ---------------------------------------------------------------- 2. 下限不溢出

console.log("\n【2】最窄的手机上不会溢出");

/**
 * 最窄支持的视口。
 *
 * 320px 是 iPhone SE（第 1 代）那一档，已经是实际会遇到的窄屏下限。
 */
const NARROWEST = 320;

/**
 * 页面横向开销（不含牌）—— 在**可用宽度**之上再扣掉的部分：
 *   app padding 6×2  +  卡片边框 2×2  +  卡片 padding 8×2  =  32px
 *
 * ⚠️ 注意 .app 是 `width: 96%`（用户的要求，不要改），
 *    所以第一层可用宽度是 `视口 × 0.96`，不是视口全宽。
 */
const CHROME = 12 + 4 + 16;

/** .app 的宽度占比（用户设定，见 App.vue 的 .app） */
const APP_WIDTH_RATIO = 0.96;

check("门前 13 张在最窄屏下放得下", () => {
  const m = cssMin.match(/\.tiles\[[^\]]*\]\{[^}]*grid-template-columns:repeat\(\d+,minmax\((\d+)px,1fr\)\)/);
  ok(!!m, "找不到 .tiles 的列下限");
  const min = Number(m![1]);

  const gap = cssMin.match(/\.tiles\[[^\]]*\]\{[^}]*gap:([\d.]+)px/);
  const gapPx = gap ? Number(gap[1]) : 0;

  const need = 13 * min + 12 * gapPx;
  const avail = NARROWEST * APP_WIDTH_RATIO - CHROME;
  ok(
    need <= avail,
    [
      `需要 ${need}px，最窄屏只有 ${avail}px（差 ${need - avail}px）—— 会溢出。`,
      `      要么把 minmax 的下限调小，要么接受横向滚动。`,
    ].join("\n"),
  );
  console.log(`        （需要 ${need}px ≤ 可用 ${avail}px）`);
});

check("牌表 9 张在最窄屏下放得下", () => {
  const m = cssMin.match(/\.picker-row\[[^\]]*\]\{[^}]*grid-template-columns:repeat\(\d+,minmax\((\d+)px,1fr\)\)/);
  ok(!!m, "找不到 .picker-row 的列下限");
  const min = Number(m![1]);
  const gap = cssMin.match(/\.picker-row\[[^\]]*\]\{[^}]*gap:([\d.]+)px/);
  const gapPx = gap ? Number(gap[1]) : 0;

  const need = 9 * min + 8 * gapPx;
  const avail = NARROWEST - CHROME;
  ok(need <= avail, `需要 ${need}px，可用 ${avail}px`);
  console.log(`        （需要 ${need}px ≤ 可用 ${avail}px）`);
});

// ---------------------------------------------------------------- 3. 高度派生

console.log("\n【3】槽高必须从容器宽度派生（不能写死）");

check("门前的槽高用 cqw 派生（不是写死的 px）", () => {
  // ⚠️ scoped 样式编译后是 `.slot-hand .slot-body[data-v-xxx]{...}` ——
  //    data 属性只加在**最后一个**选择器上。
  //    而 cssMin 把空白全去掉了（连后代选择符的空格也没了），
  //    所以这里用 [\s]* 来同时匹配「有空格」和「没空格」两种形态。
  const m = cssMin.match(/\.slot-hand[\s]*\.slot-body\[[^\]]*\]\{([^}]*)\}/);
  ok(!!m, "找不到 .slot-hand .slot-body 规则");
  const body = m![1]!;

  ok(
    body.includes("100cqw"),
    [
      "槽高没有用到 cqw —— 说明它还是个写死的值，",
      "      牌宽一改就会重演「牌被裁」的 bug。",
      `      实际规则：${body}`,
    ].join("\n"),
  );
  ok(
    body.includes("overflow"),
    "槽没有 overflow 声明 —— 竖直方向的亚像素溢出会露出来",
  );
});

check("和牌张的槽高容得下 28px 的牌", () => {
  const m = cssMin.match(/\.slot-win[\s]*\.winning-body\[[^\]]*\]\{([^}]*)\}/);
  ok(!!m, "找不到 .slot-win .winning-body 规则");
  const h = m![1]!.match(/height:([\d.]+)px/);
  ok(!!h, "找不到高度值");

  // 牌宽 28px（border-box）→ 内容 25px → 3:4 高 33.33px + 边框 3px + 阴影 1.5px
  const needed = (28 - 3) * 4 / 3 + 3 + 1.5;
  const actual = Number(h![1]);
  ok(
    actual >= needed - 0.5,
    `槽高 ${actual}px 装不下牌高约 ${needed.toFixed(1)}px —— 牌会溢出压住标题`,
  );
  console.log(`        （槽高 ${actual}px ≥ 需要 ${needed.toFixed(1)}px）`);
});

// ---------------------------------------------------------------- 4. 比例位置

console.log("\n【4】aspect-ratio 的位置（结构不变量）");

check("aspect-ratio 在 .frame 上，不在 .body 上", () => {
  // .body 上有边框；如果把 aspect-ratio 放在它上面，
  // 比例会被边框污染（内容框从 3:4 变成约 0.72），图片 contain 后出现 letterbox
  const bodyRule = cssMin.match(/\.body\[[^\]]*\]\{([^}]*)\}/);
  ok(!!bodyRule, "找不到 .body 规则");
  ok(
    !bodyRule![1]!.includes("aspect-ratio"),
    [
      ".body 上出现了 aspect-ratio —— 它同时有 border，",
      "      比例会被边框污染，图片就会出现 letterbox（看起来像偏移）。",
      "      应该放在没有边框的 .frame 上。",
    ].join("\n"),
  );

  const frameRule = cssMin.match(/\.frame\[[^\]]*\]\{([^}]*)\}/);
  ok(!!frameRule, "找不到 .frame 规则");
  ok(
    frameRule![1]!.includes("aspect-ratio:3/4"),
    ".frame 上没有 aspect-ratio:3/4 —— 比例层丢了",
  );
});

// ---------------------------------------------------------------- 5. 防回退

console.log("\n【5】防回退：不该再有手算的牌宽公式");

check("CSS 里没有 100vw 手算牌宽的残留", () => {
  const bad = cssMin.match(/width:min\([\d.]+px,calc\(\(100vw[^)]*\)\/1[39]\)\)/);
  ok(
    !bad,
    [
      `发现手算牌宽的残留：${bad?.[0]}`,
      "      那个公式这次少扣了 43px 导致溢出，已经改成 grid 了。",
    ].join("\n"),
  );
});

check("CSS 里没有 -46px 这个错误的预算数字", () => {
  ok(
    !cssMin.includes("46px"),
    "-46px 是这次算错的预算（真实开销是 89px），不该再出现",
  );
});

// ---------------------------------------------------------------- 汇总

console.log(`\n=== pass=${pass} fail=${fail} ===`);
if (failures.length) {
  console.log("\n--- 失败明细 ---");
  failures.forEach((f) => console.log("  * " + f));
}
process.exitCode = fail > 0 ? 1 : 0;
