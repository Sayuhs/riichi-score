/**
 * 离线能力验证：起一个静态服务器，用真实 HTTP 请求确认
 * 「首次联网访问后能离线打开」这条路是通的。
 *
 * ## 为什么需要这个
 *
 * PWA 的离线能力依赖三件事同时成立：
 *   1. 页面能被访问（服务器正常）
 *   2. SW 文件能被取到，且 MIME 类型正确（`text/javascript`）
 *      —— MIME 错了浏览器会拒绝注册，这是最常见的坑
 *   3. manifest 能被取到，且 MIME 类型正确（`application/manifest+json`）
 *
 * 静态检查（verify-pwa.ts）只能看文件在不在、内容对不对，
 * **看不到「服务器返回的 MIME 类型」** —— 而这恰恰是部署后最容易出问题的地方。
 *
 * 这个脚本模拟一个正确的静态服务器（GitHub Pages 的行为），
 * 用真实请求验证上述三点。
 *
 * 用法：node --experimental-strip-types scripts/verify-offline.ts
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = join(process.cwd(), "dist");
const PORT = 8139;

/**
 * MIME 类型表。
 *
 * ⚠️ 关键在于 `.js` 必须是 `text/javascript`。
 *    GitHub Pages 本身是对的，但如果用别的托管（或自己写服务器），
 *    返回 `text/plain` 会让 SW 注册失败 —— 而报错信息很难懂。
 */
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = createServer(async (req, res) => {
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]!);
  let rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  // 目录请求回退到 index.html（模拟 Pages 的行为）
  if (rel.endsWith("/")) rel += "index.html";
  const filePath = normalize(join(ROOT, rel));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const data = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      // 静态资源加缓存头（模拟 Pages）
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600",
    });
    res.end(data);
  } catch {
    res.writeHead(404).end("not found");
  }
});

await new Promise<void>((r) => server.listen(PORT, "127.0.0.1", r));
const base = `http://127.0.0.1:${PORT}`;

let pass = 0;
let fail = 0;
const failures: string[] = [];

async function check(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
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

console.log("=== 离线能力验证（真实 HTTP 请求）===\n");

// ============================================================
console.log("【1】首屏必需资源可达");
// ============================================================

await check("首页可访问", async () => {
  const r = await fetch(`${base}/`);
  ok(r.status === 200, `HTTP ${r.status}`);
  const html = await r.text();
  ok(html.includes("<div id=\"app\">"), "不是应用页面");
});

await check("SW 文件可达且 MIME 正确", async () => {
  const r = await fetch(`${base}/sw.js`);
  ok(r.status === 200, `HTTP ${r.status}`);
  const ct = r.headers.get("content-type") ?? "";
  // ⭐ 这是最关键的一条：MIME 错了浏览器拒绝注册 SW
  ok(
    ct.includes("javascript"),
    `MIME 必须是 javascript，实际是「${ct}」—— 浏览器会拒绝注册 SW`,
  );
  const src = await r.text();
  ok(src.includes("addEventListener"), "内容不像 SW");
});

await check("manifest 可达且 MIME 正确", async () => {
  const r = await fetch(`${base}/manifest.webmanifest`);
  ok(r.status === 200, `HTTP ${r.status}`);
  const ct = r.headers.get("content-type") ?? "";
  ok(
    ct.includes("manifest") || ct.includes("json"),
    `MIME 异常：「${ct}」`,
  );
  const m = JSON.parse(await r.text()) as Record<string, unknown>;
  ok(typeof m.name === "string", "manifest 缺 name");
});

await check("主 JS / CSS 可达", async () => {
  const html = await (await fetch(`${base}/`)).text();
  const jsRef = html.match(/(?:src|href)="([^"]+\.js)"/)?.[1];
  const cssRef = html.match(/(?:src|href)="([^"]+\.css)"/)?.[1];
  ok(!!jsRef, "页面没引用 JS");
  ok(!!cssRef, "页面没引用 CSS");
  for (const ref of [jsRef!, cssRef!]) {
    // 页面里是相对路径，要相对根解析
    const url = new URL(ref, `${base}/`).href;
    const r = await fetch(url);
    ok(r.status === 200, `${ref} → HTTP ${r.status}`);
  }
});

// ============================================================
console.log("\n【2】图标可达");
// ============================================================

for (const icon of [
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "apple-touch-icon.png",
]) {
  await check(`图标 ${icon}`, async () => {
    const r = await fetch(`${base}/${icon}`);
    ok(r.status === 200, `HTTP ${r.status}`);
    const ct = r.headers.get("content-type") ?? "";
    ok(ct.includes("image/png"), `MIME 异常：「${ct}」`);
    const buf = Buffer.from(await r.arrayBuffer());
    ok(buf[0] === 0x89 && buf[1] === 0x50, "不是 PNG");
  });
}

// ============================================================
console.log("\n【3】模拟离线：缓存完整性");
// ============================================================
// 浏览器装 SW 后会把请求过的资源存进 Cache Storage。
// 这里没法真的跑 SW（沙箱限制），但可以验证**「离线时需要的资源全集」
// 是否都能通过 HTTP 取到** —— 因为 SW 的缓存就来自这些请求。
// 只要它们全部可达，且 SW 逻辑正确，离线就能打开。

await check("离线时需要的资源全集都可达", async () => {
  const html = await (await fetch(`${base}/`)).text();

  // 从 HTML 里提取所有引用
  const refs = new Set<string>();
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const ref = m[1]!;
    if (ref.startsWith("data:") || ref.startsWith("http")) continue;
    refs.add(new URL(ref, `${base}/`).href);
  }

  // 加上 manifest 里声明的图标
  const manifest = JSON.parse(
    await (await fetch(`${base}/manifest.webmanifest`)).text(),
  ) as { icons: { src: string }[] };
  for (const i of manifest.icons) {
    refs.add(new URL(i.src, `${base}/`).href);
  }

  // 加上页面动态引用的牌面 SVG。
  //
  // ⚠️ 构建后的 JS 里，路径是**模板字符串 + 变量**：
  //     `tiles/${COLOR_SET}/${name}.svg`
  //    压缩后变成 `tiles/${ea}/${na(e)}.svg`
  //    所以匹配不到字面量 `tiles/Red/` —— 只匹配 `tiles/` 前缀即可。
  const jsRef = html.match(/(?:src|href)="([^"]+\.js)"/)?.[1]!;
  const js = await (await fetch(new URL(jsRef, `${base}/`).href)).text();
  const hasTiles = /tiles\//.test(js);
  ok(hasTiles, "JS 里找不到牌面路径（tiles/）");

  const missing: string[] = [];
  for (const ref of refs) {
    const r = await fetch(ref);
    if (r.status !== 200) missing.push(`${ref} → ${r.status}`);
  }
  // 抽查几张牌面（路径写死在这里，因为 JS 里是变量拼的，解析不出完整路径）
  for (const tile of ["Man1.svg", "Pin5-Dora.svg", "Haku.svg", "Chun.svg", "Back.svg"]) {
    const r = await fetch(`${base}/tiles/Red/${tile}`);
    if (r.status !== 200) missing.push(`tiles/Red/${tile} → ${r.status}`);
  }

  ok(missing.length === 0, `以下资源不可达:\n        ${missing.join("\n        ")}`);
  console.log(`        （检查了 ${refs.size + 5} 个资源）`);
});

await check("全部牌面素材都可达（34 种 + 3 赤 + 牌背）", async () => {
  const PREFIX: Record<string, string> = { m: "Man", p: "Pin", s: "Sou" };
  const HONOR: Record<string, string> = {
    "1z": "Ton", "2z": "Nan", "3z": "Shaa", "4z": "Pei",
    "5z": "Haku", "6z": "Hatsu", "7z": "Chun",
  };
  const kinds = [
    ...["1","2","3","4","5","6","7","8","9"].map((r) => `${r}m`),
    ...["1","2","3","4","5","6","7","8","9"].map((r) => `${r}p`),
    ...["1","2","3","4","5","6","7","8","9"].map((r) => `${r}s`),
    "1z","2z","3z","4z","5z","6z","7z",
  ];
  const missing: string[] = [];
  for (const k of kinds) {
    const name = k[1] === "z" ? HONOR[k]! : `${PREFIX[k[1]!]}${k[0]}`;
    const r = await fetch(`${base}/tiles/Red/${name}.svg`);
    if (r.status !== 200) missing.push(k);
  }
  for (const s of ["m", "p", "s"]) {
    const r = await fetch(`${base}/tiles/Red/${PREFIX[s]}5-Dora.svg`);
    if (r.status !== 200) missing.push(`0${s}`);
  }
  const back = await fetch(`${base}/tiles/Red/Back.svg`);
  if (back.status !== 200) missing.push("Back");

  ok(missing.length === 0, `缺: ${missing.join(", ")}`);
});

// ============================================================
console.log("\n【4】子路径部署模拟（GitHub Pages 场景）");
// ============================================================
// 部署到 https://user.github.io/repo-name/ 时，页面在子路径下。
// 相对路径的资源引用必须在这种情况仍然正确。

await check("在子路径下资源引用仍然正确", async () => {
  const html = await (await fetch(`${base}/`)).text();
  // 所有引用都必须是相对的（不以 / 开头）
  const absRefs: string[] = [];
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const ref = m[1]!;
    if (ref.startsWith("/")) absRefs.push(ref);
  }
  ok(
    absRefs.length === 0,
    `发现绝对路径引用（部署到子路径会 404）: ${absRefs.join(", ")}`,
  );
});

server.close();

console.log(`\n=== pass=${pass} fail=${fail} ===`);
if (failures.length) {
  console.log("\n--- 失败明细 ---");
  failures.forEach((f) => console.log("  * " + f));
}
process.exitCode = fail > 0 ? 1 : 0;
