# Bun Plugin Tailwind for Workbench Styling

Herakles Workbench uses Tailwind through Bun's fullstack HTML import pipeline with `bun-plugin-tailwind`, rather than StyleX, Vite, PostCSS, or a separate Tailwind CLI build. This keeps the browser UI aligned with Herakles's Bun-first server and bundler model while allowing the design system to be expressed with Tailwind utilities, theme tokens, and local CSS assets.
