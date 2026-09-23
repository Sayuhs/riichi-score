/**
 * 组件渲染冒烟测试。
 *
 * 「构建成功」不等于「组件能渲染」—— 模板里引用不存在的变量、
 * props 名写错这类问题，构建阶段是发现不了的。
 *
 * 沙箱禁止 spawn 子进程（装不了 jsdom / happy-dom），所以用 Vue 自带的
 * 服务端渲染把结构渲染成 HTML 字符串来验证。
 *
 * `.vue` 文件需要 Vite 编译，Node 直跑不了，所以这里用 h() 手写等价结构，
 * 测「状态 → 界面」的绑定逻辑；`*.vue` 的模板正确性由 `vite build` 保证
 * （编译期报错即失败）。
 */
import { createSSRApp, h, ref } from "vue";
import { renderToString } from "vue/server-renderer";
import {
  addMeld,
  addTile,
  createEmptyHand,
  isComplete,
  remainingSlots,
  stateToText,
  textToState,
} from "../hand-state.ts";
import { PICKER_ROWS, ALL_TILE_KINDS, tileSvgPath } from "../tile-images.ts";

let pass = 0;
let fail = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    pass++;
    console.log(`  PASS  ${name}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL  ${name}\n        ${e instanceof Error ? e.message : e}`);
  }
}

function ok(cond: boolean, label = "") {
  if (!cond) throw new Error(`${label}断言失败`);
}

function eq(a: unknown, b: unknown, label = "") {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${label}\n      期望 ${JSON.stringify(b)}\n      实际 ${JSON.stringify(a)}`);
  }
}

const THIRTEEN = [
  "1m","2m","3m","4m","5m","6m","7m","8m","9m","1p","2p","3p","4p",
];

// 用 h() 复刻录入面板的关键结构
const Panel = {
  setup() {
    const state = ref(createEmptyHand());
    return { state };
  },
  render(this: { state: ReturnType<typeof createEmptyHand> }) {
    const s = this.state;
    return h("div", { class: "app" }, [
      h("div", { class: "top" }, [
        h("span", { class: "count" }, `${s.concealed.length}/${13 - 3 * s.melds.length}`),
        h("div", { class: "winning" }, s.winningTile ?? "录满后自动"),
        h(
          "div",
          { class: "tiles" },
          s.concealed.map((t) => h("img", { src: tileSvgPath(t), alt: t, "data-tile": t })),
        ),
      ]),
      h(
        "div",
        { class: "bottom" },
        s.melds.map((m) => h("div", { class: "meld" }, m.tiles.join(","))),
      ),
      h("div", { class: "text" }, stateToText(s)),
    ]);
  },
};

console.log("\n【1】Vue SSR 渲染可用性");
await test("空状态能渲染", async () => {
  const html = await renderToString(createSSRApp(Panel));
  ok(html.includes("0/13"), "应显示 0/13 ");
  ok(html.includes("录满后自动"), "应显示和牌张待定提示 ");
  ok(html.includes('class="top"'), "应有钉住区 ");
  ok(html.includes('class="bottom"'), "应有滚动区 ");
});

await test("有牌状态渲染出正确图片路径", async () => {
  const App = {
    setup() {
      let s = createEmptyHand();
      for (const t of ["1m", "0p", "5z"]) s = addTile(s, t);
      return { s };
    },
    render(this: { s: ReturnType<typeof createEmptyHand> }) {
      return h(
        "div",
        this.s.concealed.map((t) => h("img", { src: tileSvgPath(t), "data-tile": t })),
      );
    },
  };
  const html = await renderToString(createSSRApp(App));
  ok(html.includes("tiles/Red/Man1.svg"), "1m 路径 ");
  ok(html.includes("tiles/Red/Pin5-Dora.svg"), "赤5筒应指向 -Dora 文件 ");
  ok(html.includes("tiles/Red/Haku.svg"), "白应指向 Haku ");
});

console.log("\n【2】自动和牌张在界面上的表现（Q9 A）");
await test("第 13 张时还没和牌张", async () => {
  let s = createEmptyHand();
  for (const t of THIRTEEN) s = addTile(s, t);
  const App = {
    setup: () => ({ s }),
    render(this: { s: ReturnType<typeof createEmptyHand> }) {
      return h("div", [
        h("span", { class: "win" }, this.s.winningTile ?? "录满后自动"),
        h("span", { class: "cnt" }, String(this.s.concealed.length)),
      ]);
    },
  };
  const html = await renderToString(createSSRApp(App));
  ok(html.includes('class="win">录满后自动<'), "应仍是待定 ");
  ok(html.includes('class="cnt">13<'), "门前 13 张 ");
});

await test("第 14 张后自动出现和牌张", async () => {
  let s = createEmptyHand();
  for (const t of [...THIRTEEN, "9s"]) s = addTile(s, t);
  const App = {
    setup: () => ({ s }),
    render(this: { s: ReturnType<typeof createEmptyHand> }) {
      return h("div", [
        h("span", { class: "win" }, this.s.winningTile ?? "录满后自动"),
        h("span", { class: "cnt" }, String(this.s.concealed.length)),
      ]);
    },
  };
  const html = await renderToString(createSSRApp(App));
  ok(html.includes('class="win">9s<'), "和牌张应是 9s ");
  ok(html.includes('class="cnt">13<'), "门前仍 13 张 ");
});

console.log("\n【3】进度提示");
await test("剩余张数递减", () => {
  let s = createEmptyHand();
  eq(remainingSlots(s), 13, "初始 13");
  s = addTile(s, "1m");
  eq(remainingSlots(s), 12, "加一张后 12");
  s = addTile(s, "9s");
  eq(remainingSlots(s), 11, "再一张 11");
});

await test("副露会减少所需张数", () => {
  let s = createEmptyHand();
  s = addMeld(s, ["1m", "2m", "3m"]);
  eq(remainingSlots(s), 10, "一副露后 10");
});

console.log("\n【4】牌表布局（Q7 / Q8 A / Q18 A）");
await test("牌表覆盖 34 种牌 + 3 张赤 5", () => {
  const all = PICKER_ROWS.flat();
  eq(all.length, 37, "共 37 个可点项");
  for (const t of ALL_TILE_KINDS) ok(all.includes(t), `${t} 应在牌表里 `);
  for (const r of ["0m", "0p", "0s"]) ok(all.includes(r), `${r} 应在牌表里 `);
});

await test("牌表 5 行，一行一个花色，每行不超 9 张", () => {
  eq(PICKER_ROWS.length, 5, "5 行（万筒索字赤5）");
  for (const row of PICKER_ROWS) ok(row.length <= 9, `每行不超 9 张，实际 ${row.length} `);
  // 前 4 行分别是万筒索字
  eq(PICKER_ROWS[0]![0], "1m", "第 1 行是万");
  eq(PICKER_ROWS[1]![0], "1p", "第 2 行是筒");
  eq(PICKER_ROWS[2]![0], "1s", "第 3 行是索");
  eq(PICKER_ROWS[3]![0], "1z", "第 4 行是字");
  eq(PICKER_ROWS[4], ["0m", "0p", "0s"], "第 5 行是赤 5");
});

await test("37 种牌的图片路径都能生成（且指向 Red 配色）", () => {
  for (const t of [...ALL_TILE_KINDS, "0m", "0p", "0s"]) {
    const p = tileSvgPath(t);
    // 必须是 Red：Black 套是白字配深色牌面，配浅色底板会看不见「东」和「萬」
    ok(p.startsWith("tiles/Red/"), `${t} 应指向 Red: ${p} `);
    ok(p.endsWith(".svg"), `${t} 应是 svg: ${p} `);
  }
});

console.log("\n【5】与 M1 的衔接");
await test("完整手牌能构造出 Scorer 需要的输入", () => {
  let s = createEmptyHand();
  for (const t of THIRTEEN) s = addTile(s, t);
  eq(s.concealed.length, 13, "门前 13 张");
  eq(isComplete(s), false, "还差和牌张");
  s = addTile(s, "9s");
  ok(isComplete(s), "14 张应完整");
  // Scorer 契约：concealed 13 张 + winningTile 单独一张
  eq(s.concealed.length, 13, "concealed 应是 13 张");
  eq(s.winningTile, "9s", "和牌张");
  ok(!s.concealed.includes("9s"), "和牌张不占门前");
});

await test("文本往返一致", () => {
  let s = createEmptyHand();
  for (const t of [...THIRTEEN, "9s"]) s = addTile(s, t);
  const text = stateToText(s);
  const back = textToState(text);
  eq(back.winningTile, s.winningTile, "和牌张一致");
  eq(back.concealed, s.concealed, "门前一致");
});

console.log(`\n=== pass=${pass} fail=${fail} ===`);
process.exitCode = fail > 0 ? 1 : 0;
