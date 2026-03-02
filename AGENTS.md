## Project

Browser-based artificial life simulation using TypeScript + Vite. Entities evolve through natural selection, composed of colored line segments with different functions.

## Agent Directives

- Avoid starting any background commands or servers.
- Use semantic CSS class names when possible.

## Build Commands

```bash
npm run check      # A full check, runs tsc and eslint
npm run prune      # Occasionally check for unused exports
npm run build      # Production build, don't run this unless asked. There may be false positives due to scripts/*.mjs
```
