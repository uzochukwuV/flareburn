import { app } from "./server/index.js";

// Vercel wraps this exported Express app as a serverless function.
// Do NOT call app.listen() here — Vercel manages the HTTP socket.
export default app;
  