# TanStack Routing with Bun Fullstack Server

Herakles uses TanStack Router semantics and Start-style route organization for the browser UI, but the full-stack server is built around Bun's fullstack dev server rather than a Vite or Rsbuild Start runtime. The UI server imports HTML entrypoints into `Bun.serve`, lets Bun bundle frontend assets from those HTML routes, and defines typed API routes in the same server process; this keeps the UI aligned with the Bun-first product architecture while preserving the TanStack routing model that Start is built on.

This is a deliberate compatibility boundary. Current TanStack Start distribution paths are still centered on Vite or Rsbuild, while Herakles requires Bun's fullstack server and frontend bundler API as the primary runtime path. If Start exposes a first-class Bun bundler integration later, Herakles can adopt it without changing the core UI/API service model.
