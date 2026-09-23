<script setup lang="ts">
/**
 * 单张牌的显示。
 *
 * ## 为什么牌面要用 Red 套素材（踩过的坑）
 *
 * 素材三套配色的**文字颜色是反的**：Black 用白字（配深色牌面），
 * Red/Yellow 用深色字（配浅色牌面）。我用 Black 配浅色底，
 * 结果东西南北白发中和「萬」字全看不见（白字写白底）。
 * 详见 tile-images.ts 的说明。
 *
 * ## 为什么底板要用白色
 *
 * FluffyStuff 的单张牌 SVG **不带牌身底板** —— 实测 Haku.svg（白）
 * 没有任何白色像素，因为实物里的「白」本来就是空牌面加个边框。
 * 所以底板必须由 CSS 补。
 *
 * ## 波普风处理
 *
 * 牌身：白色底板 + **粗黑描边** + 硬阴影，像贴纸一样从背景上立起来。
 * 不加圆角（或只加极小圆角），保持印刷品的硬边感。
 */
import { computed } from "vue";
import { tileLabel } from "./tiles.ts";
import { tileSvgPath } from "./tile-images.ts";

const props = withDefaults(
  defineProps<{
    /** 天凤记法的牌，如 `1m` / `0p` / `5z` */
    tile: string;
    /** 是否显示中文牌名（放牌下方） */
    showLabel?: boolean;
    /** 是否可点击 */
    clickable?: boolean;
    /** 变淡（该种牌已用满 4 张） */
    dim?: boolean;
    /** 尺寸档位 */
    size?: "sm" | "md" | "lg";
  }>(),
  {
    showLabel: false,
    clickable: false,
    dim: false,
    size: "md",
  },
);

const emit = defineEmits<{ (e: "pick"): void }>();

const src = computed(() => tileSvgPath(props.tile));
const label = computed(() => tileLabel(props.tile));
const isRed = computed(() => props.tile[0] === "0");
</script>

<template>
  <button
    type="button"
    class="tile"
    :class="[`size-${size}`, { clickable, dim }]"
    :disabled="!clickable"
    :aria-label="label"
    @click="emit('pick')"
  >
    <!--
      三层结构（修「牌面偏移」的关键）：
        .body  —— 只管尺寸 / 边框 / 阴影 / 圆角
        .frame —— 只管裁剪（overflow:hidden）+ 严格比例
        img    —— 绝对定位 + translate(-50%,-50%) 做数学精确居中

      为什么必须分层：
        1. 边框会污染 aspect-ratio。`.body` 若同时有 border 和 aspect-ratio，
           且 box-sizing:border-box，则 aspect-ratio 作用在**边框框**上，
           内容框变成 (w-3)×(h-3)、比例从 0.75 掉到 0.72 ——
           图片在这个比例不对的框里 contain，必然出现 letterbox，看起来就是偏的。
           所以裁剪层 `.frame` 必须**没有边框**。
        2. `img` 默认是 inline 元素，会带基线间隙造成垂直偏移。
           改成绝对定位 + translate(-50%,-50%) 后，水平垂直都是精确居中，
           不依赖 flex 的 align/justify，也不受字体行高影响。
    -->
    <span class="body" :class="{ red: isRed }">
      <span class="frame">
        <img :src="src" :alt="label" draggable="false" />
      </span>
    </span>
    <span v-if="showLabel" class="label">{{ label }}</span>
  </button>
</template>

<style scoped>
.tile {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  color: var(--ink);
  /* 行高压成 1 避免按钮高度被字体撑开 */
  line-height: 1;
  /* 按钮的 appearance 重置 —— 某些浏览器会给 button 默认的内边距/边框 */
  appearance: none;
  -webkit-appearance: none;
  /* 宽度由内容（.body）决定，不被父容器拉伸 */
  width: fit-content;
  /* 不因内容变化而改尺寸 */
  box-sizing: border-box;
}

/* 牌身：只管尺寸 / 边框 / 阴影 / 圆角。
   ⚠️ 不要让这里承担裁剪 —— 见 .frame 的说明。 */
.body {
  display: block;
  background: #fff;
  border: 1.5px solid var(--ink);
  border-radius: 3px;
  /* 硬阴影：实心、无模糊 */
  box-shadow: 1.5px 1.5px 0 var(--ink);
  /* ⚠️ border-box + **不要**在这里写 aspect-ratio。
     以前是 content-box + aspect-ratio:3/4，但那样有两个连锁问题：
       ① 总宽 = 设定值 + 3px 边框，手算布局时必须记得加这 3px
          ——这次的「页面被裁」就是忘了加，13 张一共少算 39px；
       ② 比例要靠 content-box 才能正确，换个写法就又歪了。
     现在改成：**比例只由 .frame 负责**（它没有边框，aspect-ratio 精确），
     .body 只负责边框 / 阴影 / 尺寸，用 border-box 让 width 就是最终宽度。 */
  box-sizing: border-box;
}

/* 裁剪层 + 比例层：严格 3:4，且不含边框。
   放在这里而不是 .body 上，是为了让 aspect-ratio 作用在一个
   **没有边框**的盒子上 —— 比例精确，不受边框宽度干扰。 */
.frame {
  display: block;
  width: 100%;
  aspect-ratio: 3 / 4;
  position: relative;
  overflow: hidden;
  border-radius: inherit;
}

/* ============ 图片：绝对定位 + translate 精确居中 ============
 *
 * ## 为什么不用 flex 居中
 *
 * 之前用 `object-fit: contain` + flex 居中，看起来应该没问题，但实际偏左。
 * 原因有两个：
 *
 * 1. **边框污染了比例** —— `.body` 有 1.5px 边框且 box-sizing:border-box，
 *    于是 `aspect-ratio: 3/4` 作用在**边框框**上，内容框实际是
 *    `(w-3) × (h-3)`，比例从 0.75 掉到约 0.72。
 *    图片在这个比例不对的框里 `contain`，必然出现 letterbox ——
 *    而 letterbox 的留白在视觉上就是"偏移"。
 *
 * 2. **img 是 inline 元素** —— 默认按基线对齐，行高会带来额外的垂直间隙。
 *
 * ## 改成绝对定位 + translate 后
 *
 *   position: absolute; left: 50%; top: 50%;
 *   transform: translate(-50%, -50%);
 *
 * 这是**数学上精确**的居中：把图片的左上角移到容器中心，
 * 再按图片自身尺寸的 50% 回移 —— 结果与容器/图片尺寸无关，永远居中。
 * 不依赖 flex 的 align-items、不依赖行高、不受 inline 基线影响。
 */
.frame img {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  /* 保证不变形地铺满裁剪区。
     因为 .frame 与 SVG 都是 3:4，所以实际是正好铺满、没有 letterbox。 */
  width: 100%;
  height: 100%;
  object-fit: contain;
  /* 消除 inline 元素可能带来的基线间隙（双保险） */
  display: block;
  vertical-align: middle;
}

/* 赤 5：换一圈亮色描边，一眼能认出 */
.body.red {
  border-color: var(--pop-pink);
  box-shadow: 1.5px 1.5px 0 var(--pop-pink);
}

/* ============ 尺寸：由 grid 决定，不再手算像素 ============
 *
 * ## 为什么删掉了 calc((100vw - 46px) / 13) 这种东西
 *
 * 那个公式是这次「页面像被裁剪」的**根因**：它少扣了 43px。
 * 真实开销是
 *     app padding 12 + 卡片边框 4 + 卡片 padding 16
 *     + 13 张牌各自的边框 39 + 12 个间隙 18  =  89px
 * 公式只扣了 46px —— 于是 320px 屏溢出 43px、390px 溢出 37px，
 * 被三层 overflow:hidden 静默裁掉（第 13 张整张消失、第 12 张切一半）。
 *
 * 而且那个数字是**手算**的：改任何一处 padding，公式不会自己变。
 *
 * ## 现在的做法：把算术交给浏览器
 *
 * 牌表容器（.tiles / .picker-row，见 HandInput.vue）用
 *     grid-template-columns: repeat(N, minmax(MIN, 1fr))
 * 固定 N 列，宽度由浏览器分配 —— **零算术，不可能再算错**。
 *
 * 这里只写「填满我那一列」，max-width 防止大屏上牌大得离谱。
 * 固定列数还有一个好的副作用：**输入过程中牌不会缩放** ——
 * 录第 1 张和录满 13 张，每张牌一样大。
 */
/* ⚠️ 默认值必须是**固定宽度**，不能写 width:100%。
 *
 *    `width: 100%` 只在 **grid** 里正确 —— grid 会把宽度均分给每一列。
 *    但在 **flex 行**里，每个子项都想要 100%，结果是全部被压扁成
 *    一个个小点（役种示例、宝牌选择表都踩过这个坑）。
 *
 *    所以：这里给固定宽度（flex 场景用），
 *    真正需要「填满 grid 列」的两处由 HandInput.vue 用 :deep() 覆盖。
 */
.size-md .body {
  /* 牌表 / 役种示例 / 宝牌选择表：34px 是够用的点击目标 */
  width: 34px;
}
.size-lg .body {
  /* 门前：会被 grid 覆盖成 100%，这里只是兜底 */
  width: 24px;
}
.size-sm .body {
  /* 和牌张：只出现一张，用固定宽度 */
  width: 28px;
}

/* 牌名标签 */
.label {
  font-size: 8px;
  font-weight: 700;
  white-space: nowrap;
  letter-spacing: -0.04em;
  /* 固定行高，避免不同字体的度量差异造成垂直偏移 */
  line-height: 1.1;
  display: block;
}

.clickable {
  cursor: pointer;
}
.clickable .body {
  transition: transform 0.06s ease, box-shadow 0.06s ease;
}
.tile:disabled {
  cursor: default;
}

.dim .body {
  opacity: 0.35;
}
</style>
