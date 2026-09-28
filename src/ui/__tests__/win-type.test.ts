/**
 * 「荣和 / 自摸」两个入口的**接线**断言。
 *
 * ## 为什么要写这种「读源码」的测试
 *
 * 和了方式（`GameState.winType`）有两个入口：
 *
 *   1. 录入页「和牌张」标题行上的那对小按钮（新加的）
 *   2. 场况页「和了方式」那一栏（原来就有的）
 *
 * 两者改的是**同一个字段**，所以天然同步 —— 这是设计上的好处，但也带来
 * 一类**构建期发现不了**的故障：
 *
 *   · 按钮画出来了，但 `@update:game` 忘了接到 `<HandInput>` 上 ⇒ 点了没反应
 *   · `:game` 忘了传 ⇒ `v-if="game"` 恒假，按钮根本不出现
 *   · 组件里自己又存了一份 winType ⇒ 两个入口各说各话
 *
 * 这几条 `vite build` 全都不会报错（和第 1 条同类的坑，暗杠那边刚踩过一次：
 * 绑了点击但事件不冒泡，看起来也是「点了没反应」）。
 *
 * 沙箱里装不了 jsdom / @vue/test-utils（不能 spawn 子进程），
 * 没有 DOM 可以挂载；所以这里退一步，**直接读源码做结构断言**。
 * 项目里 `scripts/verify-layout.ts` 已经是这个路子（断言构建后的 CSS 文本），
 * 这里沿用同一个办法，只是目标换成「接线是否存在」。
 *
 * ⚠️ 这些断言只能防「接线丢了」，防不了「像素好不好看」——
 *    后者要在浏览器里看。
 */
import { readFileSync } from "node:fs";

/**
 * 读一个**相对于本文件**的源码文件。
 *
 * ⚠️ 这里刻意绕了一圈（用 `URL` 自己拆路径），而不是常见的
 *    `path.join(dirname(fileURLToPath(import.meta.url)), rel)`。
 *
 *    原因：这个项目**没装 `@types/node`** ——
 *      · `node:path` / `node:url` 没有类型声明，`tsc --noEmit` 报 TS2307；
 *      · 而 `readFileSync` 的声明只接受 `string`，直接传 URL 报 TS2345。
 *    所以只能走「全局 URL + 自己拼字符串」这条路，两条错误都能避开。
 *
 *    Windows 的 file URL pathname 形如 `/D:/dir/f`，要去掉开头那个斜杠；
 *    再 decodeURIComponent（路径里有中文，URL 会把它百分号编码）。
 */
function read(rel: string): string {
  const { pathname } = new URL(rel, import.meta.url);
  const file = decodeURIComponent(pathname).replace(/^\/([A-Za-z]:)/, "$1");
  return readFileSync(file, "utf8");
}

let pass = 0;
let fail = 0;
const failures: string[] = [];

function test(name: string, fn: () => void): void {
  try {
    fn();
    pass++;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    fail++;
    const msg = e instanceof Error ? e.message : String(e);
    failures.push(`${name}\n      ${msg}`);
    console.log(`  FAIL  ${name}\n        ${msg}`);
  }
}

function ok(cond: boolean, label = ""): void {
  if (!cond) throw new Error(label || "断言失败");
}

const HAND = read("../HandInput.vue");
const SETTINGS = read("../GameSettings.vue");
const APP = read("../../App.vue");

/**
 * 去掉 `/* … *\/` 块注释之后再断言 —— **CSS 断言一律用这个**。
 *
 * ⚠️ 不是洁癖，是被自己的文档绊过一次：
 *    源码里刻意留着一句「这里**不写** `.wt-btn:active`」（那是最重要的设计说明），
 *    可拿裸文本一匹配，这句注释自己就被判成了「存在 :active 规则」——
 *    测试反过来骂自己的文档。
 *    断言的是**代码**，所以先把注释剥掉。
 */
function stripBlockComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 只剩代码（注释已剥）的 HandInput.vue */
const HAND_CODE = stripBlockComments(HAND);

// ============================================================
console.log("\n【1】录入页：按钮真的存在，并且绑在 setWinType 上");
// ============================================================

test("「荣和」按钮绑 setWinType('ron')", () => {
  ok(
    /@click="setWinType\('ron'\)"/.test(HAND),
    "HandInput.vue 里找不到 @click=\"setWinType('ron')\"",
  );
});

test("「自摸」按钮绑 setWinType('tsumo')", () => {
  ok(
    /@click="setWinType\('tsumo'\)"/.test(HAND),
    "HandInput.vue 里找不到 @click=\"setWinType('tsumo')\"",
  );
});

test("按钮有 v-if=\"game\" 守卫 —— 没场况就不显示，别猜默认值", () => {
  ok(
    /<span v-if="game" class="win-type-seg">/.test(HAND),
    "那对按钮应该包在 v-if=\"game\" 里（game 是可选 prop）",
  );
});

test("选中态由 game.winType 决定（不是某个本地变量）", () => {
  ok(
    /:class="\{ on: game\.winType === 'ron' \}"/.test(HAND),
    "「荣和」的选中态必须读 game.winType",
  );
  ok(
    /:class="\{ on: game\.winType === 'tsumo' \}"/.test(HAND),
    "「自摸」的选中态必须读 game.winType",
  );
});

// ============================================================
console.log("\n【2】切的是场况：emit 声明 + 真的 emit 出去");
// ============================================================

test("声明了 update:game 事件（带 GameState 参数）", () => {
  ok(
    /\(e:\s*"update:game",\s*game:\s*GameState\)\s*:\s*void/.test(HAND),
    "defineEmits 里应有 (e: \"update:game\", game: GameState): void",
  );
});

test("setWinType 里真的 emit 了，而且只改 winType 这一个字段", () => {
  ok(
    /emit\("update:game",\s*\{\s*\.\.\.g,\s*winType:\s*w\s*\}\)/.test(HAND),
    "setWinType 应 emit(\"update:game\", { ...g, winType: w })",
  );
});

test("组件里没有再存一份 winType（两份真相必然走偏）", () => {
  ok(
    !/ref<WinType>/.test(HAND),
    "HandInput.vue 不该出现 ref<WinType> —— 和了方式归 App 持有",
  );
});

test("★ App 把 update:game 接到了 <HandInput> 上", () => {
  // 这是最容易漏、后果最直接的一条：不接就是「按钮点了没反应」
  const tag = APP.match(/<HandInput[\s\S]*?\/>/);
  ok(tag !== null, "App.vue 里找不到 <HandInput ... /> 标签");
  ok(
    /@update:game\s*=/.test(tag![0]),
    "<HandInput> 没有 @update:game —— 录入页那对按钮会点了没反应",
  );
});

test("★ App 同时也把 :game 传进去了（否则 v-if 恒假、按钮不出现）", () => {
  const tag = APP.match(/<HandInput[\s\S]*?\/>/);
  ok(tag !== null, "App.vue 里找不到 <HandInput ... /> 标签");
  ok(
    /:game="game"/.test(tag![0]),
    "<HandInput> 没传 :game —— v-if=\"game\" 恒假，按钮永远不显示",
  );
});

// ============================================================
console.log("\n【3】场况页那对按钮还在，改的是同一个字段");
// ============================================================

test("场况页仍有「荣和 / 自摸」，且 patch 的是 winType", () => {
  ok(
    /patch\(\{\s*winType:\s*'ron'\s*\}\)/.test(SETTINGS),
    "GameSettings.vue 里找不到 patch({ winType: 'ron' })",
  );
  ok(
    /patch\(\{\s*winType:\s*'tsumo'\s*\}\)/.test(SETTINGS),
    "GameSettings.vue 里找不到 patch({ winType: 'tsumo' })",
  );
});

test("两个入口写的是**同一个字段名** winType（写错了就不会同步）", () => {
  ok(HAND.includes("winType: w"), "录入页应写 winType");
  ok(SETTINGS.includes("winType: 'ron'"), "场况页应写 winType");
  // 都指向 GameState.winType 这一个字段 —— 没有第二份状态
  ok(
    /winType: WinType;/.test(read("../game-state.ts")),
    "GameState 里应该只有 winType 这一个和了方式字段",
  );
});

// ============================================================
console.log("\n【4】布局不变量：别把标题行撑高、别把字截掉");
// ============================================================

test("按钮字号保持 9px（它撑高标题行，而牌面区是钉住的）", () => {
  const block = HAND.match(/\.wt-btn\s*\{[\s\S]*?\}/);
  ok(block !== null, "找不到 .wt-btn 的样式块");
  ok(
    /font-size:\s*9px/.test(block![0]),
    "按钮字号应保持 9px —— 变大就会把「和牌张」这张卡片撑高、压矮下面的牌表",
  );
  ok(
    /padding:\s*1\.5px 5px/.test(block![0]),
    "内边距应保持 1.5px 5px（15px 高是还能点得中的最小尺寸）",
  );
});

test("按钮样式里没有静默截断（上次那个「…」的教训）", () => {
  const block = HAND.match(/\.wt-btn\s*\{[\s\S]*?\}/);
  ok(block !== null, "找不到 .wt-btn 的样式块");
  ok(!/ellipsis/.test(block![0]), ".wt-btn 不该有 text-overflow: ellipsis");
  ok(!/white-space:\s*nowrap/.test(block![0]), ".wt-btn 不该锁 nowrap 后靠裁切兜底");
});

test("选中态用实心深底：父级 .card-title 有 opacity，浅色描边会被淡化掉", () => {
  ok(
    /\.wt-btn\.on\s*\{[\s\S]*?background:\s*var\(--ink\)/.test(HAND),
    ".wt-btn.on 应该用 var(--ink) 实心底，才能穿过 .card-title 的 opacity 看出来",
  );
});

test("★ 不做按下位移 —— 上面就是牌面，一挪会让人以为牌也在动", () => {
  ok(!/\.wt-btn:active/.test(HAND_CODE), ".wt-btn 不该有 :active 规则（按下去会位移）");
  ok(
    !/\.wt-btn\s*\{[^}]*transform/.test(HAND_CODE),
    ".wt-btn 本体也不该带 transform —— 要反馈就用不改位置的方式（颜色）",
  );
});

test("暗杠那一组同理：点完它就整条消失，不需要按下位移", () => {
  ok(!/\.ankan-group:active/.test(HAND_CODE), ".ankan-group 不该有 :active 规则");
});

// ============================================================
console.log(`\n=== pass=${pass} fail=${fail} ===`);
if (failures.length) {
  console.log("\n--- 失败明细 ---");
  failures.forEach((f) => console.log("  * " + f));
}
process.exitCode = fail > 0 ? 1 : 0;
