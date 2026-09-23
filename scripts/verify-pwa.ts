/**
 * PWA 配置校验。
 *
 * 检查「离线可用」所需的各项是否齐备。这些错误在本地就能发现，
 * 不用等部署到 GitHub Pages 才知道。
 *
 * 检查两类东西：
 *   1. **源码层**（public/ 与 index.html）—— 配置是否正确
 *   2. **产物层**（dist/）—— 该有的文件是否真的进去了
 *
 * 用法：node --experimental-strip-types scripts/verify-pwa.ts
 */
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";

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

/** 读 JSON 并校验 */
function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

// ============================================================
console.log("\n【1】manifest 完整性");
// ============================================================

const MANIFEST = "public/manifest.webmanifest";

check("manifest 文件存在", () => {
  ok(existsSync(MANIFEST), "文件不存在 ");
});

check("manifest 是合法 JSON", () => {
  readJson(MANIFEST);
});

check("必填字段齐备（可安装的最低要求）", () => {
  const m = readJson(MANIFEST);
  // 这四个是 Chrome 判定「可安装」的硬性要求
  ok(typeof m.name === "string" && m.name, "缺 name");
  ok(typeof m.short_name === "string" && m.short_name, "缺 short_name");
  ok(typeof m.start_url === "string", "缺 start_url");
  ok(m.display === "standalone" || m.display === "fullscreen", "display 应是 standalone");
  ok(Array.isArray(m.icons) && (m.icons as unknown[]).length > 0, "缺 icons");
});

check("start_url 与 scope 用相对路径（能部署到子路径）", () => {
  const m = readJson(MANIFEST);
  const start = m.start_url as string;
  const scope = m.scope as string | undefined;
  // 绝对路径 `/` 在 GitHub Pages 的 /repo-name/ 下会 404
  ok(!start.startsWith("/"), `start_url 不该是绝对路径: ${start}`);
  ok(scope === undefined || !scope.startsWith("/"), `scope 不该是绝对路径: ${scope}`);
});

check("图标尺寸覆盖 192 与 512（Chrome 要求）", () => {
  const m = readJson(MANIFEST);
  const icons = m.icons as { sizes: string; purpose?: string }[];
  const sizes = icons.map((i) => i.sizes);
  ok(sizes.includes("192x192"), `缺 192x192（实际: ${sizes.join(", ")}）`);
  ok(sizes.includes("512x512"), "缺 512x512");
});

check("有 maskable 图标（Android 自适应）", () => {
  const m = readJson(MANIFEST);
  const icons = m.icons as { sizes: string; purpose?: string }[];
  ok(
    icons.some((i) => i.purpose === "maskable"),
    "缺 purpose: maskable 的图标 —— Android 上会被裁得很难看",
  );
});

check("theme_color 与界面主色一致", () => {
  const m = readJson(MANIFEST);
  // style.css 里 --pop-orange: #ff6b35
  ok(m.theme_color === "#ff6b35", `theme_color 应是 #ff6b35，实际 ${m.theme_color}`);
});

// ============================================================
console.log("\n【2】图标文件");
// ============================================================

const ICONS = [
  ["public/icon-192.png", 192],
  ["public/icon-512.png", 512],
  ["public/icon-maskable-512.png", 512],
  ["public/apple-touch-icon.png", 180],
] as const;

for (const [path, size] of ICONS) {
  check(`图标 ${path}（${size}×${size}）`, () => {
    ok(existsSync(path), "文件不存在 ");
    const buf = readFileSync(path);
    // PNG 签名
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    ok(sig.every((b, i) => buf[i] === b), "不是合法 PNG ");
    // IHDR 里的宽高（偏移 16 与 20）
    ok(buf.readUInt32BE(16) === size, `宽度应是 ${size}，实际 ${buf.readUInt32BE(16)}`);
    ok(buf.readUInt32BE(20) === size, `高度应是 ${size}，实际 ${buf.readUInt32BE(20)}`);
    // 体积别太大（图标不该占几百 KB）
    ok(buf.length < 100 * 1024, `体积过大: ${(buf.length / 1024).toFixed(0)} KB`);
  });
}

// ============================================================
console.log("\n【3】Service Worker");
// ============================================================

const SW = "public/sw.js";

check("sw.js 存在且非空", () => {
  ok(existsSync(SW), "文件不存在 ");
  ok(statSync(SW).size > 500, "内容过少，可能不是完整的 SW");
});

check("SW 监听 install / activate / fetch（三个必需事件）", () => {
  const src = readFileSync(SW, "utf8");
  ok(src.includes('addEventListener("install"'), "缺 install");
  ok(src.includes('addEventListener("activate"'), "缺 activate");
  ok(src.includes('addEventListener("fetch"'), "缺 fetch —— 没有它就不会拦截请求，等于没缓存");
});

check("SW 调用了 skipWaiting 与 clients.claim", () => {
  const src = readFileSync(SW, "utf8");
  // 不调用的话，新版 SW 要等所有页面关闭才生效，用户会一直看到旧版
  ok(src.includes("skipWaiting"), "缺 skipWaiting");
  ok(src.includes("clients.claim"), "缺 clients.claim");
});

check("SW 有缓存清理逻辑（避免旧缓存永久占用）", () => {
  const src = readFileSync(SW, "utf8");
  ok(src.includes("caches.delete"), "缺缓存清理");
});

check("SW 对导航请求有离线回退", () => {
  const src = readFileSync(SW, "utf8");
  ok(src.includes("navigate"), "没处理导航请求 —— 离线时打不开页面");
  ok(src.includes("caches.open"), "没有用缓存");
});

// ============================================================
console.log("\n【4】index.html 接线");
// ============================================================

check("index.html 引用了 manifest", () => {
  const html = readFileSync("index.html", "utf8");
  ok(html.includes('rel="manifest"'), "缺 manifest link");
  ok(html.includes("./manifest.webmanifest"), "manifest 路径应相对");
});

check("index.html 里注册了 SW", () => {
  const html = readFileSync("index.html", "utf8");
  ok(html.includes("serviceWorker"), "没注册 SW");
  ok(html.includes('register("./sw.js"'), "SW 路径应相对");
});

check("有 iOS 的 apple-touch-icon（iOS 不吃 manifest 图标）", () => {
  const html = readFileSync("index.html", "utf8");
  ok(html.includes("apple-touch-icon"), "缺 apple-touch-icon");
});

check("有 theme-color（移动端地址栏配色）", () => {
  const html = readFileSync("index.html", "utf8");
  ok(html.includes('name="theme-color"'), "缺 theme-color");
});

check("SW 注册失败不影响应用（用 catch 兜住）", () => {
  const html = readFileSync("index.html", "utf8");
  // 注册代码里必须有 .catch —— 否则 SW 出错会让整页脚本挂掉
  const idx = html.indexOf("serviceWorker.register");
  ok(idx > 0, "找不到注册代码");
  ok(html.slice(idx, idx + 300).includes(".catch"), "注册没有 catch，失败会抛错");
});

// ============================================================
console.log("\n【5】构建产物");
// ============================================================

const DIST = "dist";
const distExists = existsSync(DIST);

if (!distExists) {
  console.log("  （dist 不存在，跳过 —— 先跑 pnpm run build）");
} else {
  check("dist 里 PWA 文件齐全", () => {
    const needed = [
      "index.html",
      "sw.js",
      "manifest.webmanifest",
      "icon-192.png",
      "icon-512.png",
      "icon-maskable-512.png",
      "apple-touch-icon.png",
    ];
    const missing = needed.filter((f) => !existsSync(`${DIST}/${f}`));
    ok(missing.length === 0, `缺: ${missing.join(", ")}`);
  });

  // ⚠️ 这里原本有一条「dist 里的资源引用必须是相对路径」的断言 —— **已删除**。
  //    那是**写错前提**的检查：它把「用相对 base」当成了唯一正确做法，
  //    而实际部署用的是绝对 base（仓库名就是 riichi-score）。
  //    结果用户一改 base 它就误报，差点让 CI 拦住正常部署。
  //
  //    「按真实部署路径能不能取到」这件事由 verify:offline 负责 ——
  //    它会起一个挂在 /richi-score 前缀下的服务器逐个请求资源，
  //    对相对 / 绝对两种 base 都成立，而且更强。

  check("dist 里不含开发用的校准页", () => {
    ok(
      !existsSync(`${DIST}/tile-preview.html`),
      "tile-preview.html 不该进生产产物（32KB 的开发工具）",
    );
  });

  check("产物总体积合理（移动端要下载）", () => {
    // 递归算 dist 体积
    const walk = (dir: string): number => {
      let total = 0;
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) total += walk(p);
        else total += statSync(p).size;
      }
      return total;
    };
    const total = walk(DIST);
    const mb = total / 1024 / 1024;
    ok(mb < 3, `产物 ${mb.toFixed(2)} MB 偏大`);
    console.log(`        （实际 ${mb.toFixed(2)} MB）`);
  });
}

// ============================================================
console.log(`\n=== pass=${pass} fail=${fail} ===`);
if (failures.length) {
  console.log("\n--- 失败明细 ---");
  failures.forEach((f) => console.log("  * " + f));
}
process.exitCode = fail > 0 ? 1 : 0;
