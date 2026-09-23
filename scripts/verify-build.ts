/**
 * 构建产物验收：起一个静态服务器，用真的 HTTP 请求检查关键资源可达。
 *
 * 为什么不用浏览器自动化：沙箱禁止 spawn 子进程，装不了 Playwright。
 * 但「资源是否 200 可达」「HTML 是否引用了正确的相对路径」这两件事
 * 用纯 HTTP 就能验，足以抓住最常见的部署事故（路径错、素材没复制）。
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = join(process.cwd(), "dist");
const PORT = 8137;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".md": "text/markdown; charset=utf-8",
};

/**
 * 部署子路径 —— 必须与 vite.config.ts 的 base 一致。
 *
 * GitHub Pages 把仓库部署在 /<repo>/ 下，所以产物里的 assets 引用是
 * `/riichi-score/assets/...`。如果这里把 dist 挂在根路径，那些引用会 404，
 * 后面所有「读 JS/CSS 内容」的检查会集体假失败 ——
 * 看起来像功能坏了，其实只是服务器挂错了地方。
 */
const BASE_PATH = "/riichi-score";

const server = createServer(async (req, res) => {
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);

  // 只服务部署子路径下的请求（模拟 GitHub Pages 的前缀）
  if (!urlPath.startsWith(BASE_PATH)) {
    res.writeHead(404).end("not found (outside deploy path)");
    return;
  }
  let rest = urlPath.slice(BASE_PATH.length).replace(/^\/+/, "");
  const rel = rest === "" ? "index.html" : rest;
  const filePath = normalize(join(ROOT, rel));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404).end("not found");
  }
});

await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", r));
const base = `http://127.0.0.1:${PORT}${BASE_PATH}`;
function toDeployPath(ref: string): string {
  if (ref.startsWith(BASE_PATH)) return ref.slice(BASE_PATH.length);
  if (ref.startsWith("./")) return "/" + ref.slice(2);
  return ref;
}

let pass = 0;
let fail = 0;

async function check(label: string, path: string, opts: { mustContain?: string[]; minBytes?: number } = {}) {
  try {
    const res = await fetch(base + path);
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const bytes = Buffer.byteLength(text);
    if (opts.minBytes && bytes < opts.minBytes) {
      throw new Error(`体积过小: ${bytes} < ${opts.minBytes}`);
    }
    for (const needle of opts.mustContain ?? []) {
      if (!text.includes(needle)) throw new Error(`内容里缺少 "${needle}"`);
    }
    pass++;
    console.log(`  PASS  ${label.padEnd(38)} ${String(bytes).padStart(7)} B`);
  } catch (e) {
    fail++;
    console.log(`  FAIL  ${label.padEnd(38)} ${e instanceof Error ? e.message : e}`);
  }
}

console.log("\n【构建产物验收 —— 真实 HTTP 请求】");

// --- index.html ---
await check("index.html 可访问", "/", { mustContain: ["<div id=\"app\">", "type=\"module\""] });

// --- JS / CSS（文件名带 hash，先从 index.html 里解析出来）---
const html = await readFile(join(ROOT, "index.html"), "utf8");
const jsMatch = html.match(/src="([^"]+\.js)"/);
const cssMatch = html.match(/href="([^"]+\.css)"/);

if (jsMatch) {
  const jsPath = toDeployPath(jsMatch[1]!);
  // 检查真正能证明「Vue 应用 + 牌面映射都被打进去了」的标志：
  //  - createApp：Vue 应用入口
  //  - tiles/：tile-images.ts 生成的路径前缀
  //  - Haku：字牌映射表里的一个词
  await check("主 JS 可访问", jsPath, {
    minBytes: 1000,
    mustContain: ["createApp", "tiles/", "Haku"],
  });
} else {
  fail++;
  console.log("  FAIL  无法从 index.html 解析出 JS 路径");
}

if (cssMatch) {
  const cssPath = toDeployPath(cssMatch[1]!);
  await check("主 CSS 可访问", cssPath, { minBytes: 500 });
} else {
  fail++;
  console.log("  FAIL  无法从 index.html 解析出 CSS 路径");
}

// --- 牌面素材：抽查关键牌 ---
// 只保留 Red 一套（见 tile-images.ts：Black 是白字配深色牌面，
// 配浅色底板会看不见「东」和「萬」）
const tileChecks: [string, string][] = [
  ["一万", "/tiles/Red/Man1.svg"],
  ["赤5筒", "/tiles/Red/Pin5-Dora.svg"],
  ["赤5索", "/tiles/Red/Sou5-Dora.svg"],
  ["白", "/tiles/Red/Haku.svg"],
  ["中", "/tiles/Red/Chun.svg"],
  ["东", "/tiles/Red/Ton.svg"],
  ["牌背", "/tiles/Red/Back.svg"],
];
for (const [label, path] of tileChecks) {
  await check(label, path, { minBytes: 500 });
}

// ⭐ 防复发：验证牌面文字是**深色**的
//
// 这是「白板看不见」那个 bug 的根因所在：
// Black 套的 Ton.svg 用 #ffffff 白字画「东」，配浅色底板就消失了。
// Red 套的 Ton.svg 用 #142896 深蓝画「东」，才是对的。
//
// 所以这里直接检查 SVG 内容里的填充色，防止将来有人把配色换回 Black
// 却不知道这个坑。
async function checkDarkInk(label: string, path: string, mustNotContain: string) {
  try {
    const res = await fetch(base + path);
    const svg = await res.text();
    if (svg.includes(mustNotContain)) {
      fail++;
      console.log(
        `  FAIL  ${label.padEnd(38)} 含 ${mustNotContain}（浅色底会看不见字！）`,
      );
      return;
    }
    pass++;
    console.log(`  PASS  ${label.padEnd(38)} 不含 ${mustNotContain}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL  ${label.padEnd(38)} ${e instanceof Error ? e.message : e}`);
  }
}

// 「东」的字色必须是深色。白色字 = 会看不见
await checkDarkInk("东字不是白色（防白底白字）", "/tiles/Red/Ton.svg", "fill:#ffffff");
// 「萬」的字色：Man1 里除了黑色描边，不该有白色文字
await checkDarkInk("萬字不含白色填充", "/tiles/Red/Man1.svg", "fill:#ffffff");

// --- 34 种牌 + 3 张赤 5 全部存在（逐张验证，避免漏素材）---
const kinds = [
  ...["1","2","3","4","5","6","7","8","9"].map((r) => `${r}m`),
  ...["1","2","3","4","5","6","7","8","9"].map((r) => `${r}p`),
  ...["1","2","3","4","5","6","7","8","9"].map((r) => `${r}s`),
  "1z","2z","3z","4z","5z","6z","7z",
];
const PREFIX: Record<string, string> = { m: "Man", p: "Pin", s: "Sou" };
const HONOR: Record<string, string> = {
  "1z": "Ton", "2z": "Nan", "3z": "Shaa", "4z": "Pei",
  "5z": "Haku", "6z": "Hatsu", "7z": "Chun",
};
let missing: string[] = [];
for (const k of kinds) {
  const name = k[1] === "z" ? HONOR[k]! : `${PREFIX[k[1]!]}${k[0]}`;
  const res = await fetch(`${base}/tiles/Red/${name}.svg`);
  if (res.status !== 200) missing.push(k);
}
for (const r of ["m", "p", "s"]) {
  const res = await fetch(`${base}/tiles/Red/${PREFIX[r]}5-Dora.svg`);
  if (res.status !== 200) missing.push(`0${r}`);
}
if (missing.length === 0) {
  pass++;
  console.log(`  PASS  ${"34 种牌 + 3 张赤5 全部存在".padEnd(38)}`);
} else {
  fail++;
  console.log(`  FAIL  缺少牌面: ${missing.join(", ")}`);
}

// --- 体积检查：HTML 内联资源不能超过 Chromium 的 2MB URL 上限 ---
const htmlBytes = Buffer.byteLength(html);
if (htmlBytes < 2 * 1024 * 1024) {
  pass++;
  console.log(`  PASS  ${"index.html 体积 < 2MB".padEnd(38)} ${htmlBytes} B`);
} else {
  fail++;
  console.log(`  FAIL  index.html 体积 ${htmlBytes} B 超过 2MB（Chromium kMaxURLChars）`);
}

// --- M3：确认发布包里没有测试专用的交叉验证引擎 ---
// `@sacckey/mahjong` 只在测试里当「第二意见」用。如果它被打进产物，
// 说明有人恢复了 score() 的 engine 选项，会让包白胖 6KB。
if (jsMatch) {
  const jsUrl = toDeployPath(jsMatch[1]!);
  const js = await (await fetch(base + jsUrl)).text();
  const tests: [string, string, boolean][] = [
    // [说明, 标志字符串, 期望存在?]
    ["主包含算番引擎 riichi-score", "kiriageMangan", true],
    ["主包不含测试引擎 sacckey", "mahjong_api_version", false],
    ["主包含役种中文名映射", "门前清自摸和", true],
    ["主包含符明细中文名", "中张暗刻", true],
  ];
  for (const [label, needle, shouldExist] of tests) {
    const found = js.includes(needle);
    if (found === shouldExist) {
      pass++;
      console.log(`  PASS  ${label.padEnd(38)} ${shouldExist ? "存在" : "不存在"}`);
    } else {
      fail++;
      console.log(
        `  FAIL  ${label.padEnd(38)} 期望${shouldExist ? "存在" : "不存在"}，实际${found ? "存在" : "不存在"}`,
      );
    }
  }
}

// --- 确认产物里没有残留的旧配色引用 ---
if (jsMatch) {
  const jsUrl = toDeployPath(jsMatch[1]!);
  const js = await (await fetch(base + jsUrl)).text();
  for (const wrong of ["tiles/Black/", "tiles/Yellow/"]) {
    if (js.includes(wrong)) {
      fail++;
      console.log(`  FAIL  产物引用了已删除的配色 ${wrong}`);
    } else {
      pass++;
      console.log(`  PASS  ${("不含 " + wrong).padEnd(38)} 已清理`);
    }
  }
}

// ============================================================
// 面向用户的文案检查（不出现里程碑编号）
// ============================================================
// 用户明确指出：界面上不该出现「结算在 M3」这类开发者说法。
// 检查构建产物的 JS 与 CSS（那才是真正交付给用户的东西）。
console.log("\n【面向用户的文案】");
if (jsMatch) {
  const js = await (await fetch(base + (toDeployPath(jsMatch[1]!)))).text();
  const banned: [string, string][] = [
    ["结算在 M3", "里程碑说法"],
    ["（M1", "里程碑编号"],
    ["（M2", "里程碑编号"],
    ["（M3", "里程碑编号"],
    ["（M4", "里程碑编号"],
  ];
  for (const [phrase, why] of banned) {
    if (js.includes(phrase)) {
      fail++;
      console.log(`  FAIL  产物含「${phrase}」（${why}）`);
    } else {
      pass++;
      console.log(`  PASS  ${("不含「" + phrase + "」").padEnd(38)} ok`);
    }
  }
}

// ============================================================
// M3.1：防抖动与失败提示的产物级检查
// ============================================================
console.log("\n【M3.1 打磨项的产物验证】");
if (jsMatch) {
  const js = await (await fetch(base + (toDeployPath(jsMatch[1]!)))).text();
  // 失败提示的三个分支文案（在 JS 里）
  const jsChecks: [string, string][] = [
    ["无役提示", "这手牌没有役，不能和牌"],
    ["手牌不成立提示", "手牌不成立"],
    ["场况矛盾提示", "场况有矛盾"],
  ];
  for (const [label, needle] of jsChecks) {
    if (js.includes(needle)) {
      pass++;
      console.log(`  PASS  ${label.padEnd(38)} 存在`);
    } else {
      fail++;
      console.log(`  FAIL  ${label.padEnd(38)} 缺失「${needle}」`);
    }
  }
}

// 防抖动的占位类名在 CSS 里（scoped 样式会被打进 CSS 文件）
if (cssMatch) {
  const css = await (await fetch(base + (toDeployPath(cssMatch[1]!)))).text();
  const cssChecks = ["slot-win", "slot-hand", "slot-notice", "notice-quiet"];
  for (const cls of cssChecks) {
    if (css.includes(cls)) {
      pass++;
      console.log(`  PASS  ${("占位样式 " + cls).padEnd(38)} 存在`);
    } else {
      fail++;
      console.log(`  FAIL  ${("占位样式 " + cls).padEnd(38)} 缺失`);
    }
  }

  // ============================================================
  // 防抖动：横向也检查（用户反馈「水平容器也容易抖动」）
  // ============================================================
  console.log("\n【防抖动：横向】");
  const hChecks: [string, string][] = [
    ["全局禁止横向滚动", "overflow-x:hidden"],
    ["grid 用 minmax(0,1fr)", "minmax(0,1fr)"],
    ["分段按钮 flex-basis 归零", "flex:1 1 0"],
    ["滚动条占位稳定", "scrollbar-gutter:stable"],
  ];
  // CSS 会被压缩，去掉空格后比对
  const cssMin = css.replace(/\s+/g, "");
  for (const [label, needle] of hChecks) {
    const compact = needle.replace(/\s+/g, "");
    if (cssMin.includes(compact)) {
      pass++;
      console.log(`  PASS  ${label.padEnd(38)} 存在`);
    } else {
      fail++;
      console.log(`  FAIL  ${label.padEnd(38)} 缺失「${needle}」`);
    }
  }

  // ============================================================
  // 副露模块已按用户要求移除（强调三次）—— 防回退
  // ============================================================
  // ⚠️ 这里只检查**副露的交互 UI**，不检查中文词。原因：
  //   「副露」「加杠」「顺子」「刻子」这些词在**役种说明**里都要用
  //   （比如抢杠的定义、「副露后不成立」的提示、三色同顺的判据），
  //   按字面一刀切会误报。
  //
  //   所以改查**结构性的东西**：副露添加模式的 CSS 类名与按钮。
  //   这些只属于副露 UI，不会出现在别处。
  console.log("\n【副露模块移除确认】");
  {
    // CSS 类：副露添加模式专用
    const meldCssClasses = ["meld-add", "meld-picked", "meld-actions", "meld-templates", "add-meld"];
    for (const cls of meldCssClasses) {
      if (cssMin.includes(cls)) {
        fail++;
        console.log(`  FAIL  ${("副露 UI 类名应已移除：" + cls).padEnd(38)} 仍存在`);
      } else {
        pass++;
        console.log(`  PASS  ${("已移除副露 UI 类：" + cls).padEnd(38)} 确认不在`);
      }
    }

    // JS 文案：副露添加按钮的独有字样
    const js = jsMatch
      ? await (await fetch(base + (toDeployPath(jsMatch[1]!)))).text()
      : "";
    // ⚠️ 不要检查「+ 添加」这个字符串 —— 宝牌点选器合法地复用了它。
    //    要检查的是**只有副露 UI 才会有**的文案（那几个模板按钮）。
    const meldOnlyStrings: [string, string][] = [
      ["吃模板按钮", "吃 123m"],
      ["碰模板按钮", "碰 111m"],
      ["杠模板按钮", "暗杠 1111m"],
      ["点击选副露的提示", "点下面的牌来选副露"],
    ];
    for (const [label, needle] of meldOnlyStrings) {
      if (js.includes(needle)) {
        fail++;
        console.log(`  FAIL  ${("副露 UI 应已移除：" + label).padEnd(38)} 仍存在`);
      } else {
        pass++;
        console.log(`  PASS  ${("已移除副露 UI：" + label).padEnd(38)} 确认不在`);
      }
    }

    // 反向确认：逻辑层必须还在（避免误删）
    const mustKeep: [string, string][] = [
      ["门清判定", "门清"],
      ["副露后不成立的提示", "副露后不成立"],
      ["抢杠的役种说明", "别人加杠时"],
    ];
    for (const [label, needle] of mustKeep) {
      if (js.includes(needle)) {
        pass++;
        console.log(`  PASS  ${("保留：" + label).padEnd(38)} 存在`);
      } else {
        fail++;
        console.log(`  FAIL  ${("逻辑丢失：" + label).padEnd(38)} 缺失`);
      }
    }
  }

  // ============================================================
  // 牌面：三层结构 + 数学精确居中
  // ============================================================
  // 背景：用户反馈「图片没有居中」。
  //
  // ❌ 第一轮尝试：写脚本量 SVG 内容边界，加 transform 补偿 ——
  //    但测量脚本本身有 bug（算出 Pin7 的 y=-7683），把图案推歪了，
  //    用户反馈「往左边偏，贴边了」。
  //
  // ✅ 最终做法：从**结构**上解决，不依赖任何测量数据：
  //    1. .body 用 content-box —— 否则 aspect-ratio 会被边框污染，
  //       内容框比例从 0.75 掉到 0.72，图片 contain 后出现 letterbox（看起来就是偏）
  //    2. 加一层 .frame 承担裁剪，让比例只作用于内容框
  //    3. img 用绝对定位 + translate(-50%,-50%) 做数学精确居中
  //       （不受 inline 基线、flex 对齐、字体行高影响）
  console.log("\n【牌面：三层结构 + 精确居中】");
  // ⚠️ scoped 样式会被编译成 `.frame[data-v-xxxx]{`，
  //    所以不能字面匹配 `.frame{` —— 改用不带花括号的类名。
  const tileChecks: [string, string][] = [
    ["body 用 border-box（宽度即最终宽）", "box-sizing:border-box"],
    ["aspect-ratio 3/4", "aspect-ratio:3/4"],
    ["裁剪层 frame", ".frame"],
    ["图片绝对定位", "position:absolute"],
    ["水平精确居中", "left:50%"],
    ["垂直精确居中", "top:50%"],
    ["translate 回移居中", "translate(-50%,-50%)"],
    ["不变形铺满", "object-fit:contain"],
  ];
  for (const [label, needle] of tileChecks) {
    const compact = needle.replace(/\s+/g, "");
    if (cssMin.includes(compact)) {
      pass++;
      console.log(`  PASS  ${label.padEnd(38)} 存在`);
    } else {
      fail++;
      console.log(`  FAIL  ${label.padEnd(38)} 缺失「${needle}」`);
    }
  }
  // ⭐ 防回退：不该再有缩放/平移补偿
  const shouldBeGone: [string, string][] = [
    ["图案缩放补偿", "--tile-zoom"],
    ["水平平移补偿", "--tile-dx"],
    ["垂直平移补偿", "--tile-dy"],
  ];
  for (const [label, needle] of shouldBeGone) {
    if (cssMin.includes(needle.replace(/\s+/g, ""))) {
      fail++;
      console.log(`  FAIL  ${("不该再有的：" + label).padEnd(38)} 仍存在`);
    } else {
      pass++;
      console.log(`  PASS  ${("已移除：" + label).padEnd(38)} 确认不在`);
    }
  }
}

// ============================================================
// M3.3：被移除的功能不该再出现在产物里
// ============================================================
console.log("\n【M3.3 移除项确认】");
if (jsMatch) {
  const js = await (await fetch(base + (toDeployPath(jsMatch[1]!)))).text();
  // 文本输入 / 复制 / 撤销的 UI 文案不该再出现
  const removed: [string, string][] = [
    ["文本输入入口", "文本输入"],
    ["复制按钮", "已复制"],
    ["撤销按钮", "↶ 撤销"],
    ["副露模板（旧）", "副露 ▾"],
    ["结算在 M3（旧文案）", "结算在 M3"],
  ];
  for (const [label, needle] of removed) {
    if (js.includes(needle)) {
      fail++;
      console.log(`  FAIL  ${("已移除的「" + label + "」仍存在").padEnd(38)}`);
    } else {
      pass++;
      console.log(`  PASS  ${("已移除：" + label).padEnd(38)} 确认不在`);
    }
  }
}

// ============================================================
// 役种速查弹窗的内容必须打进产物
// ============================================================
console.log("\n【役种速查弹窗】");
if (jsMatch) {
  const js = await (await fetch(base + (toDeployPath(jsMatch[1]!)))).text();
  const guideChecks: [string, string][] = [
    ["弹窗标题", "役种速查"],
    ["「没役怎么办」标签", "没役怎么办"],
    ["「全部役种」标签", "全部役种"],
    ["关键提示：宝牌不算役", "不算役"],
    ["役种名：立直", "立直"],
    ["役种名：清一色", "清一色"],
    ["役种名：国士无双", "国士无双"],
    ["副露后不成立的标注", "副露后不成立"],
    ["连风提示", "连风"],
    ["示例牌型说明", "例"],
  ];
  for (const [label, needle] of guideChecks) {
    if (js.includes(needle)) {
      pass++;
      console.log(`  PASS  ${label.padEnd(38)} 存在`);
    } else {
      fail++;
      console.log(`  FAIL  ${label.padEnd(38)} 缺失「${needle}」`);
    }
  }
}

// ============================================================
// 错误信息不该外露英文
// ============================================================
// ⚠️ 说明：不能检查「产物里有没有英文错误字符串」——
//    那些字符串来自第三方依赖 riichi-score 本身，必然被打进包里。
//    真正要检查的是：**界面组件有没有把 error.message 直接渲染出来**。
//    正确做法是把 kind 翻成中文（见 App.vue 的 humanizeError），
//    英文原文只写进 console 供排查。
console.log("\n【错误信息本地化】");
{
  // 从源码检查界面组件是否直接渲染引擎错误
  const { readFileSync } = await import("node:fs");
  const uiFiles = ["App.vue", "ui/HandInput.vue", "ui/GameSettings.vue", "ui/ScoreResultView.vue", "ui/YakuGuide.vue"];
  let leaked: string[] = [];
  for (const f of uiFiles) {
    let src: string;
    try {
      src = readFileSync(`src/${f}`, "utf8");
    } catch {
      continue;
    }
    // 只看模板部分（script 里的 console.error 是有意保留的）
    const template = src.split("<template>")[1]?.split("</template>")[0] ?? "";
    // 模板里若出现 error.message / r.error.message 就是外露
    if (/\berror\.message\b/.test(template)) leaked.push(f);
  }
  if (leaked.length === 0) {
    pass++;
    console.log(`  PASS  ${"界面不直接渲染引擎错误".padEnd(38)} ok`);
  } else {
    fail++;
    console.log(`  FAIL  这些组件直接渲染了引擎错误: ${leaked.join(", ")}`);
  }

  // 确认中文错误提示存在（说明确实做了翻译）
  const appSrc = readFileSync("src/App.vue", "utf8");
  const zhHints = ["这手牌没有役", "手牌不成立", "场况有矛盾"];
  const missing = zhHints.filter((h) => !appSrc.includes(h));
  if (missing.length === 0) {
    pass++;
    console.log(`  PASS  ${"三类错误都有中文提示".padEnd(38)} ok`);
  } else {
    fail++;
    console.log(`  FAIL  缺少中文提示: ${missing.join(", ")}`);
  }
}

server.close();

console.log(`\n=== pass=${pass} fail=${fail} ===`);
process.exitCode = fail > 0 ? 1 : 0;
