# A-Life Simulator

Browser-based artificial life simulation built with TypeScript and Vite. Entities are made of colored line segments (Photosynth, Locomotor, Neural, Attack, Armor) and evolve through mutation and natural selection. Inspired by Primorial Life.

## What it does

- Simulates populations of autonomous entities in a wrapped 2D world.
- Models energy, health, reproduction, combat, and nutrient-field interactions.
- Supports manual experimentation with live controls, presets, and overlays.
- Includes automation presets for running reproducible experiment batches.
- Exports results, census logs, mosaics, screenshots, and analysis artifacts.

## Quick start

```bash
npm install
npm run dev
```

Open the local Vite URL, spawn entities, and adjust controls from the right-side panels.

## Scripts

- `npm run dev` - Start local development server.
- `npm run check` - Run TypeScript and ESLint checks.
- `npm run build` - Create a production build.
- `npm run preview` - Serve the production build locally.

## Controls at a glance

- Click and drag to pan; scroll/pinch to zoom.
- Click an entity to inspect stats, genome, and relatives.
- Use **Enable turbo**, **Sim steps per frame**, and **Sim step time** to change simulation speed.
- Use **Sliders & presets** and **Automation** for tuning and batch runs.
