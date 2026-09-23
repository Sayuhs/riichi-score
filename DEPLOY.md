# 部署指南（M4）

> 这份文档讲**怎么把应用放到网上、让朋友在手机上装上并离线用**。
>
> 这些步骤需要你的 GitHub 账号，**只有你能做**。代码和配置都已经准备好了。

---

## 一、为什么必须走这条路

Android 调研（见 `mahjong-android-offline-research.md`）的结论很硬：

| 方式 | 结果 |
|------|------|
| 微信发 HTML 文件让朋友打开 | ❌ 微信官方文档只提供「上传到服务器」一条路；企业微信的预览格式列表里没有 HTML |
| 文件管理器打开本地 HTML | ❌ Android 10+ 走 `content://`，相对路径的 JS/CSS/图片**全部失效** |
| Firefox Android 打开本地 HTML | ❌ **官方已移除该能力** |
| 离线页面「添加到主屏」 | ❌ 那个选项只对联网页面出现 |

**唯一可靠的路径：HTTPS 页面 + Service Worker。**

流程是：发链接 → 朋友联网打开一次 → 浏览器把资源缓存下来 → 「安装到主屏」→ **之后完全离线可用**。

而且因为缓存完成后不依赖网络，**「GitHub 在国内是否可达」只影响首次安装那一次**。

---

## 二、你要做的（大约 5 分钟）

### 步骤 1：在 GitHub 上建一个 public 仓库

1. 打开 https://github.com/new
2. **Repository name** 填一个，比如 `riichi-score`
3. **必须选 Public** —— 免费账号的 GitHub Pages 只能从 public 仓库部署
4. **不要**勾 "Add a README"（本地已经有内容了）
5. 点 Create repository

### 步骤 2：把 `app/` 推上去

假设仓库地址是 `https://github.com/你的用户名/riichi-score.git`：

```bash
cd D:\学习\日麻\app

git init
git add .
git commit -m "日麻算番算分工具：M1-M4"
git branch -M main
git remote add origin https://github.com/Sayuhs/riichi-score.git
git push -u origin main
```

> ⚠️ `app/.gitignore` 已经把 `node_modules/` 和 `dist/` 排除了，不会误传。

### 步骤 3：打开 GitHub Pages

1. 进仓库 → **Settings** → 左侧 **Pages**
2. **Source** 选 **GitHub Actions**（不是 "Deploy from a branch"）
3. 保存

推送完成后，Actions 会自动跑一次（约 1~2 分钟）。
成功后地址是：

```
https://你的用户名.github.io/riichi-score/
```

---

## 三、怎么让朋友装上

把上面那个网址发给朋友，然后：

**Android（Chrome）**
1. 用 Chrome 打开网址
2. 等页面加载完（这一步在缓存，只需一次）
3. 右上角菜单 → **「安装应用」** 或 **「添加到主屏幕」**
4. 之后桌面会有图标，**断网也能打开**

**iPhone（Safari）**
1. 用 **Safari** 打开（必须 Safari，Chrome 不行）
2. 底部 **分享** 按钮 → **「添加到主屏幕」**
3. 之后从主屏图标打开，离线可用

> 💡 **首次必须联网**。装好之后就可以完全离线了 —— 线下打牌不用担心信号。

---

## 四、自动部署是怎么跑起来的

`.github/workflows/deploy.yml` 已经写好，推 `main` 分支就自动：

```
装依赖 → 类型检查 → 跑测试 → 构建
      → 验收构建产物
      → 验收 PWA 配置
      → 验收离线能力
      → 部署到 Pages
```

**任何一步失败都不会部署** —— 不会把坏版本推上线。

想手动触发：仓库 → Actions → 左侧 "Deploy to GitHub Pages" → Run workflow。

---

## 五、本地验证（不用等 CI）

```bash
cd D:\学习\日麻\app

pnpm run build      # 构建
pnpm run verify     # 三道验收全跑
```

`verify` 包含：

| 命令 | 检查什么 |
|------|---------|
| `verify:build` | 构建产物完整性、牌面素材、界面文案、防回退项 |
| `verify:pwa` | manifest 字段、图标尺寸、SW 结构、index.html 接线 |
| `verify:offline` | **起真实 HTTP 服务器**，验证资源可达 + **MIME 类型正确** + 子路径部署可行 |

> `verify:offline` 是最有价值的一条 —— 它检查 **SW 的 MIME 类型**。
> 如果服务器把 `sw.js` 返回成 `text/plain`，浏览器会**拒绝注册 SW**，
> 而报错信息很难懂。这是部署后最常见的坑，静态检查看不出来。

---

## 六、缓存策略说明

`public/sw.js` 用**运行时缓存**而不是预缓存清单：

| 请求类型 | 策略 | 为什么 |
|---------|------|--------|
| 页面导航（HTML） | **网络优先**，离线回退缓存 | 能及时拿到新版本 |
| 静态资源（JS/CSS/SVG/PNG） | **缓存优先** + 后台更新 | Vite 产物文件名带 hash，内容变了名字就变，不存在"缓存了旧版" |

**为什么不用预缓存清单**：那需要额外的构建插件，且清单里的 hash 文件名每次都变。
运行时缓存不需要预知文件名，首次访问后立刻可用。

**更新应用**：改了代码推上去后，用户下次联网打开会自动拿到新版（导航请求是网络优先）。
旧缓存会在 SW 的 `activate` 阶段清掉。

---

## 七、如果出问题

| 现象 | 原因 | 处理 |
|------|------|------|
| 朋友打开是 404 | Pages 还没跑完，或 Source 没选 Actions | 等 Actions 跑完；检查 Settings → Pages |
| 打开了但没「安装」选项 | 没走 HTTPS，或没等页面加载完 | 确认网址是 `https://`；刷新一次再试 |
| 装了但断网打不开 | 首次缓存没完成 | 联网打开一次，等加载完再关 |
| 改了代码但朋友看到旧版 | SW 还没更新 | 让朋友完全关掉应用再打开（或下拉刷新） |
| Actions 失败 | 测试或验收没过 | 看 Actions 日志，本地跑 `pnpm run verify` 复现 |

---

## 八、成本

| 项 | 费用 |
|----|------|
| GitHub public 仓库 | 免费 |
| GitHub Pages 托管 | 免费（public 仓库） |
| HTTPS 证书 | 免费（GitHub 自动签） |
| **合计** | **0 元** |

---

## 九、日常改完怎么更新

```bash
cd D:\学习\日麻\app
git add .
git commit -m "改了什么"
git push
```

等一两分钟 Actions 跑完即可。朋友下次联网打开会自动拿到新版。
