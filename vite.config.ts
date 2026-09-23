import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import { rmSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ⚠️ ESM 里没有 __dirname，要从 import.meta.url 推出来
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 从构建产物里排除开发用的文件。
 *
 * `public/` 目录是被**原样复制**到 `dist/` 的，Vite 没有内置的排除机制。
 * 但里面有个 `tile-preview.html` —— 那是给人工核对牌面居中用的**开发工具**，
 * 32KB，不该跟着发布。
 *
 * 用 `closeBundle` 钩子在复制完成后删掉。
 */
function excludeDevFiles(files: string[]): Plugin {
  return {
    name: "exclude-dev-files",
    apply: "build",
    closeBundle() {
      for (const f of files) {
        const p = resolve(__dirname, "dist", f);
        if (existsSync(p)) rmSync(p, { force: true });
      }
    },
  };
}

/**
 * Vite 配置。
 *
 * ## base: 绝对路径 /richi-score/
 *
 * ⚠️ 这个值**必须和 GitHub 仓库名一致**（仓库就是 Sayuhs/riichi-score），
 *    因为 GitHub Pages 把它部署在 https://<user>.github.io/richi-score/ 。
 *
 *    历史：一开始写的是相对路径 ./ ，那样理论上能部署到任意子路径、
 *    也不用预先知道仓库名；后来改成了现在这个绝对值（commit 修改baseurl）。
 *    代价是**仓库改名就会 404**，所以哪天改了仓库名，这里要跟着改
 *    （pnpm run verify:offline 会按真实部署路径访问，能抓到这类问题）。
 *
 *    注：public/ 里那些手写的路径（manifest、sw 注册、图标）仍是相对写法，
 *    所以它们是路径无关的；只有 Vite 生成的 assets 引用是绝对的。
 *
 * ## assetsInlineLimit 调大
 *
 * 牌面是 40 个小 SVG，内联成 data URI 能减少请求数。
 * 但**上限要远低于 2MB** —— 那是 Chromium 的 `kMaxURLChars` 限制
 * （见 docs 里的 Android 调研报告）。
 */
export default defineConfig({
  plugins: [
    vue(),
    // 校准页是开发工具，不进生产产物
    excludeDevFiles(["tile-preview.html"]),
  ],
  base: "/riichi-score/",
  build: {
    outDir: "dist",
    // 40 张小 SVG 合计约 800KB，逐个内联会撑大 HTML；
    // 这里保持 200KB 上限 —— 只有很小的资源才内联
    assetsInlineLimit: 200 * 1024,
    // 低端 Android 的 HTML 解析器对超大内联 script 是已知瓶颈，
    // 所以把分块警告阈值调高，避免噪音（不是要合并成巨大 chunk）
    chunkSizeWarningLimit: 1024,
  },
});
