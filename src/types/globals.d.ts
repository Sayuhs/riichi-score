/**
 * 最小化的 Node 全局声明。
 *
 * 为什么不装 `@types/node`：本项目的测试 runner 是零依赖的（见 run.ts 说明），
 * 只用到 `process.exitCode` 这一个 Node 全局。为了它引一个几百 KB 的类型包
 * 不划算，所以在这里按需声明。
 *
 * 若将来真的大量用到 Node API（如 fs / path），再换成 @types/node。
 */
declare const process: {
  exitCode: number | undefined;
  argv: string[];
  env: Record<string, string | undefined>;
};

declare module "node:fs" {
  /** 读文本文件。项目里只用于「读引擎的类型定义来核对覆盖」这类事。 */
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function existsSync(path: string): boolean;
  export function readdirSync(path: string): string[];
}
