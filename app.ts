// Vercel wraps this exported Express app as a serverless function.
// Dynamic import keeps the explicit ESM extension through Vercel's transpiler.
const { app } = await import("./server/index.js");

export default app;
