/*
 * Service Worker —— 让应用离线可用。
 *
 * ## 为什么这一层是「离线可用」的关键
 *
 * Android 调研（docs 里的报告）结论：`file://` 下 Service Worker **无法注册**，
 * 所以「发个 HTML 文件让朋友在手机上打开」这条路走不通。
 * 唯一可靠的方式是：**HTTPS 页面 + Service Worker 缓存**，
 * 让用户联网打开一次，之后完全离线可用。
 *
 * ## 缓存策略：运行时缓存，而不是预缓存清单
 *
 * 常见做法是构建时生成一份「要缓存的文件清单」注入 SW。
 * 那需要额外的构建插件，而且清单里的 hash 文件名每次都变。
 *
 * 这里改用**运行时缓存**：
 *   - 用户访问什么就缓存什么（这个应用总共才几个文件）
 *   - 不需要预知文件名，不需要构建插件
 *   - 首次访问后立刻可用，不需要等 SW 安装完预缓存
 *
 * ## 两类请求，两种策略
 *
 * 1. **页面导航**（HTML）→ 网络优先
 *    这样能及时拿到新版本；离线时回退到缓存的页面。
 *
 * 2. **静态资源**（JS/CSS/SVG/PNG）→ 缓存优先
 *    Vite 构建出来的文件名带 hash，内容变了文件名就变，
 *    所以缓存命中的一定是正确版本，不存在"缓存了旧版"的问题。
 *    命中缓存后立刻返回，同时在后台更新（stale-while-revalidate）。
 */

/** 缓存名。改动缓存策略时要改这个版本号，否则旧的缓存不会被清掉 */
const CACHE_VERSION = "riichi-v1";

/** 首屏必需的最小集合 —— 装 SW 时就缓存，保证离线也能打开 */
const PRECACHE = ["./", "./index.html", "./manifest.webmanifest"];

// ---------------------------------------------------------------- install

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // 逐个添加而不是 addAll —— addAll 遇到一个失败就整体失败，
      // 而 `./` 和 `./index.html` 在某些服务器上是同一个资源，可能重复
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(url).catch(() => {
            /* 单个失败不影响整体安装 */
          }),
        ),
      );
      // 立刻接管，不等旧页面关闭 —— 单页工具，没有兼容负担
      await self.skipWaiting();
    })(),
  );
});

// ---------------------------------------------------------------- activate

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // 清掉旧版本的缓存
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n !== CACHE_VERSION).map((n) => caches.delete(n)),
      );
      // 立刻接管所有页面，不用刷新
      await self.clients.claim();
    })(),
  );
});

// ---------------------------------------------------------------- fetch

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // 只处理 GET。POST 之类直接放行
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // 只处理同源请求。跨域的（如果将来加统计之类）不碰
  if (url.origin !== self.location.origin) return;

  // ---- 页面导航：网络优先，离线回退缓存 ----
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_VERSION);
          cache.put(req, fresh.clone());
          return fresh;
        } catch {
          // 离线：回退到缓存的页面
          const cache = await caches.open(CACHE_VERSION);
          const cached =
            (await cache.match(req)) ??
            (await cache.match("./index.html")) ??
            (await cache.match("./"));
          if (cached) return cached;
          // 连缓存都没有（首次访问就断网）→ 给个能看懂的提示
          return new Response(
            `<!doctype html><meta charset="utf-8">
             <title>离线</title>
             <div style="font:16px system-ui;padding:2rem;text-align:center">
               <p>还没有缓存到本地。</p>
               <p>请先联网打开一次，之后就能离线使用了。</p>
             </div>`,
            { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
          );
        }
      })(),
    );
    return;
  }

  // ---- 静态资源：缓存优先 + 后台更新 ----
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req);

      if (cached) {
        // 有缓存：立刻返回，同时后台拉新版本（stale-while-revalidate）
        event.waitUntil(
          (async () => {
            try {
              const fresh = await fetch(req);
              if (fresh && fresh.ok) await cache.put(req, fresh.clone());
            } catch {
              /* 离线，保持缓存即可 */
            }
          })(),
        );
        return cached;
      }

      // 没缓存：走网络并缓存下来
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok && fresh.type === "basic") {
          cache.put(req, fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch (e) {
        // 彻底失败 —— 返回一个空响应而不是抛错，避免控制台一堆报错
        return new Response("", { status: 504, statusText: "Offline" });
      }
    })(),
  );
});

// ---------------------------------------------------------------- message

// 支持页面主动要求「立刻更新」（备用，当前界面没用到）
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
