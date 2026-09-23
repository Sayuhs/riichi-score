/**
 * 生成「牌面校准页」—— 用真实尺寸渲染全部牌，供人工核对。
 *
 * ## 为什么做这个
 *
 * 视觉问题我判断不了（当前模型不支持图像输入）。
 * 更糟的是，我上一轮**尝试靠测量去修**，写了个 SVG bbox 解析器，
 * 结果解析器本身有 bug（算出 Pin7 的 y=-7683、Sou2 宽度只有 85），
 * 基于错误数据的补偿把图案推歪了 —— 用户反馈「往左边偏，贴边了」。
 *
 * **教训：看不见的问题，不要靠不可靠的间接测量去猜，要让能看见的人一眼确认。**
 * 这一页就是为此存在的。
 *
 * ## 输出
 *
 * 写到 `public/tile-preview.html` —— 放 `public/` 下有两个好处：
 *   1. `pnpm dev` 时可直接访问 http://localhost:5173/tile-preview.html
 *   2. 资源路径 `tiles/Red/...` 正好对得上（public 是站点根）
 *
 * 用法：node --experimental-strip-types scripts/gen-tile-preview.ts
 */
import { writeFileSync } from "node:fs";

/**
 * 与 TileImage.vue 完全一致的尺寸算法。
 * ⚠️ 必须与组件保持同步 —— 不一致的话校准页就没意义了。
 *
 * `.body` 用 content-box，所以「总宽 = 这里设的值 + 3px 边框」。
 */
const SIZES = {
  /** 牌表：一行 9 张 */
  md: { css: "min(34px, calc((100vw - 46px) / 9))", label: "牌表（一行 9 张）" },
  /** 门前：一行 13 张（硬约束） */
  lg: { css: "min(26px, calc((100vw - 46px) / 13))", label: "门前（一行 13 张）" },
  /** 副露：一组最多 4 张 */
  sm: { css: "28px", label: "副露（一组最多 4 张）" },
};

const KINDS = [
  ...["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((r) => `${r}m`),
  ...["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((r) => `${r}p`),
  ...["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((r) => `${r}s`),
  "1z", "2z", "3z", "4z", "5z", "6z", "7z",
];
const RED = ["0m", "0p", "0s"];

const PREFIX: Record<string, string> = { m: "Man", p: "Pin", s: "Sou" };
const HONOR: Record<string, string> = {
  "1z": "Ton", "2z": "Nan", "3z": "Shaa", "4z": "Pei",
  "5z": "Haku", "6z": "Hatsu", "7z": "Chun",
};
const LABEL: Record<string, string> = {
  "1z": "东", "2z": "南", "3z": "西", "4z": "北", "5z": "白", "6z": "发", "7z": "中",
};

function nameOf(t: string): string {
  if (t[1] === "z") return HONOR[t]!;
  return `${PREFIX[t[1]!]}${t[0]}`;
}

function labelOf(t: string): string {
  const suit = { m: "万", p: "筒", s: "索" } as Record<string, string>;
  if (t[1] === "z") return LABEL[t] ?? t;
  return t[0] === "0" ? `赤5${suit[t[1]!]}` : `${t[0]}${suit[t[1]!]}`;
}

function tile(t: string, size: keyof typeof SIZES, withGuide = false): string {
  const src = `tiles/Red/${nameOf(t)}.svg`;
  // 三层结构，与 TileImage.vue 保持一致
  return `<figure class="tile${withGuide ? " guide" : ""}">
  <span class="body" style="width:${SIZES[size].css}">
    <span class="frame">
      <img src="${src}" alt="${labelOf(t)}">
    </span>
  </span>
  <figcaption>${labelOf(t)}</figcaption>
</figure>`;
}

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>牌面校准页</title>
<style>
  :root {
    --bg: #eef1f4; --ink: #1a1a1a; --card: #fff;
    --pop-yellow: #ffd23f; --pop-pink: #ff4d94; --pop-cyan: #22b8cf;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 10px;
    font-family: system-ui, -apple-system, "Noto Sans SC", sans-serif;
    background: var(--bg); color: var(--ink);
    overflow-x: hidden;
  }
  h1 { font-size: 15px; margin: 0 0 6px; }
  .intro {
    font-size: 12px; line-height: 1.55; margin: 0 0 12px;
    padding: 8px 10px; background: #fff;
    border: 2px solid var(--ink); border-radius: 6px;
    box-shadow: 3px 3px 0 var(--ink);
  }
  .intro strong { background: var(--pop-yellow); padding: 0 3px; }
  h2 {
    font-size: 12px; margin: 16px 0 4px;
    padding: 3px 8px; background: var(--ink); color: #fff;
    border-radius: 999px; display: inline-block;
  }
  .note { font-size: 11px; opacity: 0.72; margin: 0 0 6px; line-height: 1.45; }

  .row { display: flex; flex-wrap: nowrap; gap: 1.5px; align-items: flex-start; }
  .row.wrap { flex-wrap: wrap; gap: 4px; }

  .tile {
    margin: 0; display: inline-flex; flex-direction: column; align-items: center;
    gap: 1px; flex: 0 0 auto;
    line-height: 1; width: fit-content;
  }
  /* 牌身：只管尺寸 / 边框 / 阴影 —— 与 TileImage.vue 一致 */
  .body {
    display: block; background: #fff;
    border: 1.5px solid var(--ink); border-radius: 3px;
    box-shadow: 1.5px 1.5px 0 var(--ink);
    /* ⭐ content-box：让 aspect-ratio 作用在内容框上，不被边框污染。
       用 border-box 时内容框比例会从 0.75 掉到 0.72，
       图片 contain 后出现 letterbox，看起来就是偏移。 */
    box-sizing: content-box;
    aspect-ratio: 3 / 4;
    position: relative;
  }
  /* 裁剪层：严格 3:4，不含边框 */
  .frame {
    position: absolute; inset: 0;
    overflow: hidden; border-radius: inherit;
  }
  /* 图片：绝对定位 + translate 做数学精确居中 */
  .frame img {
    position: absolute; left: 50%; top: 50%;
    transform: translate(-50%, -50%);
    width: 100%; height: 100%;
    object-fit: contain;
    display: block; vertical-align: middle;
  }
  figcaption {
    font-size: 8px; font-weight: 700; letter-spacing: -0.04em;
    line-height: 1.1; display: block;
  }

  /* 参考线：画出容器边界，便于看图案是否居中 */
  .guide .body { outline: 1px dashed var(--pop-pink); outline-offset: 0; }

  /* 模拟真实卡片 */
  .fake-card {
    background: #fff; border: 2px solid var(--ink); border-radius: 6px;
    box-shadow: 3px 3px 0 var(--ink); padding: 8px;
    display: block; max-width: 100%; overflow: hidden;
  }
  .fake-title {
    font-size: 9px; font-weight: 800; letter-spacing: 0.08em;
    opacity: 0.65; text-transform: uppercase; margin-bottom: 3px;
  }

  table { border-collapse: collapse; font-size: 11px; margin-top: 4px; }
  th, td { border: 1px solid #cbd5e1; padding: 3px 7px; text-align: left; }
  th { background: #f1f5f9; }
  code { background: #f1f5f9; padding: 1px 4px; border-radius: 3px; font-size: 10px; }
</style>
</head>
<body>
<h1>牌面校准页</h1>
<p class="intro">
  这一页用来确认两件事：<strong>牌面图案是否居中</strong>、<strong>大小是否合适</strong>。<br>
  下面的尺寸与真实界面<strong>完全一致</strong>（都是响应式 <code>min()</code> 公式，随屏宽自动变化）。<br>
  带 <span style="color:#ff4d94">粉色虚线框</span>的会画出容器边界 —— 如果图案贴到某一边，一眼就能看出。
</p>

<h2>① ${SIZES.md.label}</h2>
<p class="note">录入时点选用。一行 9 张刚好放满，不换行。</p>
${[0, 9, 18, 27].map((start) => `<div class="row" style="margin-bottom:3px">
${KINDS.slice(start, start + 9).map((t) => tile(t, "md")).join("\n")}
</div>`).join("\n")}
<div class="row">
${RED.map((t) => tile(t, "md")).join("\n")}
</div>

<h2>② ${SIZES.lg.label} — 带边界参考线</h2>
<p class="note">
  这是最容易出问题的地方：13 张必须一行放下，所以每张只能这么宽。<br>
  看图案有没有<strong>贴到左边或右边</strong>。
</p>
<div class="fake-card">
  <div class="fake-title">门前（模拟真实卡片）</div>
  <div class="row">
${["2m","3m","4m","2p","3p","4p","5s","6s","7s","8s","8s","3m","4m"].map((t) => tile(t, "lg")).join("\n")}
  </div>
</div>
<p class="note" style="margin-top:8px">同样 13 张，画出容器边界：</p>
<div class="row">
${["2m","3m","4m","2p","3p","4p","5s","6s","7s","8s","8s","3m","4m"].map((t) => tile(t, "lg", true)).join("\n")}
</div>

<h2>③ ${SIZES.sm.label} — 带边界参考线</h2>
<div class="row wrap">
${["1m","1m","1m","5z","5z","5z","0p","0p","0p"].map((t) => tile(t, "sm", true)).join("\n")}
</div>

<h2>④ 逐张核对居中（重点看这里）</h2>
<p class="note">
  所有牌按牌表尺寸平铺，每张都画了边界框。<br>
  <strong>重点看这几种：</strong>「白」（本来就空）、「二索」（图案窄）、「九筒」（图案宽）、
  「一筒」「七筒」（圆形图案最容易看出偏心）。<br>
  如果还有偏的，告诉我<strong>具体哪几张、往哪偏</strong>。
</p>
<div class="row wrap">
${[...KINDS, ...RED].map((t) => tile(t, "md", true)).join("\n")}
</div>

<h2>⑤ 当前尺寸参数</h2>
<table>
  <tr><th>档位</th><th>用在哪</th><th>内容宽公式</th><th>总宽（含 3px 边框）</th></tr>
  <tr><td>md</td><td>牌表</td><td><code>${SIZES.md.css}</code></td><td>+3px</td></tr>
  <tr><td>lg</td><td>门前</td><td><code>${SIZES.lg.css}</code></td><td>+3px</td></tr>
  <tr><td>sm</td><td>副露</td><td><code>${SIZES.sm.css}</code></td><td>+3px</td></tr>
</table>
<p class="note" style="margin-top:6px">
  用响应式公式而非固定像素 —— 小屏不换行、大屏自动变大（触顶后不再增长）。
</p>

<h2>⑥ 这次修了什么（「牌面偏移」的真正原因）</h2>
<p class="note">
  之前用 <code>object-fit: contain</code> + flex 居中，看起来没问题，但实际偏左。原因是两个叠加的小问题：
</p>
<table>
  <tr><th>问题</th><th>后果</th><th>修法</th></tr>
  <tr>
    <td>边框污染了 <code>aspect-ratio</code></td>
    <td>
      <code>.body</code> 有 1.5px 边框且用 <code>border-box</code>，
      于是 <code>aspect-ratio: 3/4</code> 作用在<strong>边框框</strong>上，
      内容框变成 <code>(w-3)×(h-3)</code>、比例从 0.75 掉到 0.72。
      图片在里面 contain 必然出现 letterbox，看起来就是偏的。
    </td>
    <td><code>box-sizing: content-box</code>，让比例作用在内容框上</td>
  </tr>
  <tr>
    <td><code>img</code> 是 inline 元素</td>
    <td>默认按基线对齐，字体行高会带来额外的垂直间隙</td>
    <td>改绝对定位 + <code>translate(-50%,-50%)</code></td>
  </tr>
</table>
<p class="note" style="margin-top:6px">
  <code>left:50% + translate(-50%)</code> 是<strong>数学上精确</strong>的居中：
  与容器尺寸、图片尺寸都无关，也不依赖 flex 或行高。
</p>

<h2>⑦ 已知的素材特性（不是 bug）</h2>
<table>
  <tr><th>现象</th><th>原因</th></tr>
  <tr><td>「白」几乎看不到图案</td><td>实物就是空白牌面，只有边框 —— 靠白底与黑框辨认</td></tr>
  <tr><td>不同牌留白多少不一</td><td>素材本身各牌构图不同（如「二索」图案窄、「九筒」宽），无法统一</td></tr>
  <tr><td>赤 5 是粉色描边</td><td>有意为之，便于一眼认出</td></tr>
</table>

<p class="note" style="margin-top:14px; padding-top:10px; border-top:1px solid #cbd5e1">
  注：本页<strong>没有</strong>对图案做任何缩放或平移补偿。<br>
  之前曾加过基于测量数据的 <code>transform</code> 补偿，但那个测量脚本本身有 bug
  （算出 Pin7 的 y=-7683 这类荒唐值），导致图案被推歪 —— 用户反馈「往左边偏，贴边了」。
  现已完全移除，改用「<code>content-box</code> + 绝对定位居中」从结构上解决。
</p>
</body>
</html>
`;

const out = "public/tile-preview.html";
writeFileSync(out, html, "utf8");
console.log(`✓ 已生成 ${out}`);
console.log("");
console.log("查看：pnpm dev → http://localhost:5173/tile-preview.html");
console.log("");
console.log("重点看 ④ 那一段（逐张核对居中），告诉我具体哪几张偏、往哪偏。");
