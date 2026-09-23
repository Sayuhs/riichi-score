/**
 * 生成 PWA 图标（零依赖）。
 *
 * ## 为什么自己实现 PNG 编码
 *
 * 沙箱里装不了 `sharp` / `canvas` 这类图像库（需要编译原生模块，且 spawn 被禁）。
 * 但 PNG 本身很简单：签名 + IHDR + IDAT + IEND，IDAT 就是 zlib 压缩的扫描线。
 * Node 内置 `zlib` 就能做，不用引任何依赖。
 *
 * ## 图标设计（波普风）
 *
 * 与界面风格一致：高饱和橘底 + 粗黑边 + 白色牌身 + 红色圆点（一筒）。
 * 用超采样抗锯齿 —— 直接画会全是锯齿，4× 超采样后平均能得到平滑边缘。
 *
 * ## 为什么需要 maskable 版本
 *
 * Android 的 PWA 安装图标会被裁成圆形/水滴形。
 * 普通图标被裁会切掉内容，所以要单独出一个 **maskable** 版本：
 * 把内容缩到中心 80% 的安全区内（`SAFE_ZONE`），四周留出可被裁的余量。
 *
 * 用法：node --experimental-strip-types scripts/gen-icons.ts
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

// ---------------------------------------------------------------- PNG 编码

/** PNG 文件签名 */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** CRC32（PNG 每个 chunk 都要） */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) {
    c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/**
 * 把 RGBA 像素编码成 PNG。
 *
 * `pixels` 是 `width * height * 4` 的字节数组（R,G,B,A 顺序）。
 */
function encodePng(width: number, height: number, pixels: Uint8Array): Buffer {
  // IHDR: 宽、高、位深 8、颜色类型 6（RGBA）、压缩 0、过滤 0、隔行 0
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // 扫描线：每行开头加一个 filter byte（0 = 不过滤）
  const raw = Buffer.alloc(height * (1 + width * 4));
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0;
    const rowStart = y * width * 4;
    for (let x = 0; x < width * 4; x++) {
      raw[p++] = pixels[rowStart + x]!;
    }
  }

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- 绘图

type RGBA = [number, number, number, number];

const ORANGE: RGBA = [255, 107, 53, 255];
const WHITE: RGBA = [255, 253, 247, 255];
const INK: RGBA = [26, 26, 26, 255];
const RED: RGBA = [220, 38, 38, 255];

/** 圆角矩形：判断点 (x,y) 是否在矩形内 */
function inRoundRect(
  x: number,
  y: number,
  cx: number,
  cy: number,
  w: number,
  h: number,
  r: number,
): boolean {
  const dx = Math.abs(x - cx);
  const dy = Math.abs(y - cy);
  const hw = w / 2;
  const hh = h / 2;
  if (dx > hw || dy > hh) return false;
  // 四角：超出内矩形区域的点要用圆判断
  const ix = hw - r;
  const iy = hh - r;
  if (dx <= ix || dy <= iy) return true;
  const ox = dx - ix;
  const oy = dy - iy;
  return ox * ox + oy * oy <= r * r;
}

function inCircle(x: number, y: number, cx: number, cy: number, r: number): boolean {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/**
 * 画一个图标，返回 RGBA 像素。
 *
 * `safeZone` 为 true 时（maskable 用），内容缩到中心 80%。
 */
function drawIcon(size: number, safeZone: boolean): Uint8Array {
  const SS = 4; // 超采样倍数
  const out = new Uint8Array(size * size * 4);

  // 内容缩放：maskable 版本要留出可被裁掉的余量
  const k = safeZone ? 0.8 : 1;

  // 牌身尺寸（相对画布）
  const tileW = size * 0.52 * k;
  const tileH = size * 0.68 * k;
  const tileR = size * 0.06 * k;
  const c = size / 2;

  // 描边宽度
  const stroke = size * 0.035 * k;

  // 圆点（一筒）半径
  const dotR = size * 0.13 * k;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // 在该像素内做 SS×SS 超采样，统计各颜色占比
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      let aSum = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS;
          const y = py + (sy + 0.5) / SS;

          // 从底到上依次判断，后画覆盖先画
          let col: RGBA = ORANGE;

          // 牌身：先画"黑边"（比牌身大一圈），再画白牌身 ——
          // 用两层圆角矩形叠出描边效果
          const isInk =
            inRoundRect(x, y, c, c, tileW + stroke * 2, tileH + stroke * 2, tileR + stroke) &&
            !inRoundRect(x, y, c, c, tileW, tileH, tileR);
          const isTile = inRoundRect(x, y, c, c, tileW, tileH, tileR);

          if (isInk) col = INK;
          if (isTile) col = WHITE;

          // 圆点（只在牌身范围内）
          if (isTile && inCircle(x, y, c, c, dotR)) col = RED;

          rSum += col[0];
          gSum += col[1];
          bSum += col[2];
          aSum += col[3];
        }
      }

      const n = SS * SS;
      const i = (py * size + px) * 4;
      out[i] = Math.round(rSum / n);
      out[i + 1] = Math.round(gSum / n);
      out[i + 2] = Math.round(bSum / n);
      out[i + 3] = Math.round(aSum / n);
    }
  }

  return out;
}

// ---------------------------------------------------------------- 输出

const OUT_DIR = "public";
mkdirSync(OUT_DIR, { recursive: true });

const targets: { file: string; size: number; safeZone: boolean; desc: string }[] = [
  { file: "icon-192.png", size: 192, safeZone: false, desc: "PWA 常规图标 192" },
  { file: "icon-512.png", size: 512, safeZone: false, desc: "PWA 常规图标 512" },
  { file: "icon-maskable-512.png", size: 512, safeZone: true, desc: "Android 自适应图标（内容缩到 80%）" },
  { file: "apple-touch-icon.png", size: 180, safeZone: false, desc: "iOS 添加到主屏（不透明，iOS 不吃透明）" },
];

console.log("=== 生成 PWA 图标 ===\n");
for (const t of targets) {
  const pixels = drawIcon(t.size, t.safeZone);
  const png = encodePng(t.size, t.size, pixels);
  const path = `${OUT_DIR}/${t.file}`;
  writeFileSync(path, png);
  console.log(`  ✓ ${t.file.padEnd(26)} ${String(t.size).padStart(3)}×${t.size}  ${(png.length / 1024).toFixed(1).padStart(6)} KB  ${t.desc}`);
}

console.log("\n设计：橘底 + 黑色粗边 + 白色牌身 + 红色圆点（一筒），与界面波普风一致。");
console.log("超采样 4× 抗锯齿；maskable 版内容缩到中心 80% 避免被 Android 裁掉。");
