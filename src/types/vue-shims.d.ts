/**
 * `.vue` 单文件组件的类型声明。
 *
 * 由 Vite + @vitejs/plugin-vue 在构建时处理，TypeScript 需要知道
 * 这些模块存在，否则 `import X from "./X.vue"` 会报找不到模块。
 */
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}
