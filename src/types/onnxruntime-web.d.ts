/**
 * `onnxruntime-web` ships `types.d.ts` but its package `exports` map does not
 * expose a `types` condition, so TypeScript's bundler resolution cannot see
 * them. The public API is re-exported from `onnxruntime-common`.
 */
declare module 'onnxruntime-web' {
  export * from 'onnxruntime-common';
}
