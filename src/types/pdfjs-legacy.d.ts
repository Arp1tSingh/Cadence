// The legacy PDF.js build is the Node-compatible entry point. Its runtime is
// identical to the browser build; only the worker bootstrap differs.
declare module 'pdfjs-dist/legacy/build/pdf.mjs' {
  export * from 'pdfjs-dist';
}
