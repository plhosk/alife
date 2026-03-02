import { CAMERA_CONSTANTS, Config, Entity, RENDER_STYLE_CONSTANTS, SEGMENT_COLORS, Segment } from './types';

export function renderWorldBoundary(
  ctx: CanvasRenderingContext2D,
  config: Config,
  worldToScreen: (x: number, y: number) => { x: number; y: number }
): void {
  const corners = [
    worldToScreen(-1, -1),
    worldToScreen(config.worldWidth + 1, -1),
    worldToScreen(config.worldWidth + 1, config.worldHeight + 1),
    worldToScreen(-1, config.worldHeight + 1)
  ];

  ctx.strokeStyle = '#4a4a6a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) {
    ctx.lineTo(corners[i].x, corners[i].y);
  }
  ctx.closePath();
  ctx.stroke();
}

export function renderGrid(
  ctx: CanvasRenderingContext2D,
  camera: { x: number; y: number; zoom: number },
  canvasWidth: number,
  canvasHeight: number,
  worldToScreen: (x: number, y: number) => { x: number; y: number }
): void {
  const gridSize = CAMERA_CONSTANTS.gridSize;
  ctx.strokeStyle = '#2a2a4a';
  ctx.lineWidth = 0.5;

  const viewWidth = canvasWidth / camera.zoom;
  const viewHeight = canvasHeight / camera.zoom;
  const startX = Math.floor((camera.x - viewWidth / 2) / gridSize) * gridSize;
  const startY = Math.floor((camera.y - viewHeight / 2) / gridSize) * gridSize;

  for (let x = startX; x < startX + viewWidth + gridSize; x += gridSize) {
    const start = worldToScreen(x, camera.y - viewHeight / 2);
    const end = worldToScreen(x, camera.y + viewHeight / 2);
    ctx.beginPath();
    ctx.moveTo(start.x, 0);
    ctx.lineTo(end.x, canvasHeight);
    ctx.stroke();
  }

  for (let y = startY; y < startY + viewHeight + gridSize; y += gridSize) {
    const start = worldToScreen(camera.x - viewWidth / 2, y);
    const end = worldToScreen(camera.x + viewWidth / 2, y);
    ctx.beginPath();
    ctx.moveTo(0, start.y);
    ctx.lineTo(canvasWidth, end.y);
    ctx.stroke();
  }
}

export function createClipAndDraw(
  worldWidth: number,
  worldHeight: number,
  drawSegment: (x1: number, y1: number, x2: number, y2: number, seg: Segment) => void
): (x1: number, y1: number, x2: number, y2: number, seg: Segment) => void {
  return (x1: number, y1: number, x2: number, y2: number, seg: Segment): void => {
    const dx = x2 - x1;
    const dy = y2 - y1;

    let tMin = 0;
    let tMax = 1;

    const updateT = (p: number, q: number): boolean => {
      if (Math.abs(p) < 0.0001) return q >= 0;
      const r = q / p;
      if (p < 0) {
        if (r > tMax) return false;
        if (r > tMin) tMin = r;
      } else {
        if (r < tMin) return false;
        if (r < tMax) tMax = r;
      }
      return true;
    };

    if (!updateT(-dx, x1)) return;
    if (!updateT(dx, worldWidth - x1)) return;
    if (!updateT(-dy, y1)) return;
    if (!updateT(dy, worldHeight - y1)) return;

    const cx1 = x1 + dx * tMin;
    const cy1 = y1 + dy * tMin;
    const cx2 = x1 + dx * tMax;
    const cy2 = y1 + dy * tMax;

    drawSegment(cx1, cy1, cx2, cy2, seg);
  };
}

export function drawWrappedSegments(
  segments: Segment[],
  worldWidth: number,
  worldHeight: number,
  clipAndDraw: (x1: number, y1: number, x2: number, y2: number, seg: Segment) => void
): void {
  for (const seg of segments) {
    const x1 = seg.worldStart.x;
    const y1 = seg.worldStart.y;
    const x2 = seg.worldEnd.x;
    const y2 = seg.worldEnd.y;

    clipAndDraw(x1, y1, x2, y2, seg);

    const crossesLeft = x1 < 0 || x2 < 0;
    const crossesRight = x1 > worldWidth || x2 > worldWidth;
    const crossesTop = y1 < 0 || y2 < 0;
    const crossesBottom = y1 > worldHeight || y2 > worldHeight;

    if (crossesLeft) clipAndDraw(x1 + worldWidth, y1, x2 + worldWidth, y2, seg);
    if (crossesRight) clipAndDraw(x1 - worldWidth, y1, x2 - worldWidth, y2, seg);
    if (crossesTop) clipAndDraw(x1, y1 + worldHeight, x2, y2 + worldHeight, seg);
    if (crossesBottom) clipAndDraw(x1, y1 - worldHeight, x2, y2 - worldHeight, seg);
  }
}

export function renderEntityPreview(entity: Entity, previewCanvas: HTMLCanvasElement): void {
  const ctx = previewCanvas.getContext('2d')!;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const clientWidth = Math.round(previewCanvas.clientWidth);
  const clientHeight = Math.round(previewCanvas.clientHeight);
  const w = Math.max(1, clientWidth || previewCanvas.width);
  const h = Math.max(1, clientHeight || previewCanvas.height);
  const targetWidth = Math.max(1, Math.round(w * dpr));
  const targetHeight = Math.max(1, Math.round(h * dpr));

  if (previewCanvas.width !== targetWidth || previewCanvas.height !== targetHeight) {
    previewCanvas.width = targetWidth;
    previewCanvas.height = targetHeight;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = '#0f0f1a';
  ctx.fillRect(0, 0, w, h);

  const margin = RENDER_STYLE_CONSTANTS.previewMargin;
  const availableW = w - margin * 2;
  const availableH = h - margin * 2;
  const shortSide = Math.min(w, h);
  const hardMaxPreviewZoom = shortSide <= 64 ? 2.6 : 5;
  const hardMaxLineWidth = shortSide <= 64 ? 4 : RENDER_STYLE_CONSTANTS.previewMaxLineWidth;

  const entityW = Math.max(1, entity.aabbMax.x - entity.aabbMin.x);
  const entityH = Math.max(1, entity.aabbMax.y - entity.aabbMin.y);
  const fitScale = Math.min(availableW / entityW, availableH / entityH);
  const scale = Math.min(fitScale, hardMaxPreviewZoom);
  const lineWidth = Math.max(
    RENDER_STYLE_CONSTANTS.segmentLineWidth,
    Math.min(hardMaxLineWidth, RENDER_STYLE_CONSTANTS.segmentLineWidth * scale)
  );

  const entityCenterX = (entity.aabbMin.x + entity.aabbMax.x) / 2;
  const entityCenterY = (entity.aabbMin.y + entity.aabbMax.y) / 2;
  const centerX = w / 2;
  const centerY = h / 2;

  for (const seg of entity.segments) {
    const x1 = centerX + (seg.worldStart.x - entityCenterX) * scale;
    const y1 = centerY + (seg.worldStart.y - entityCenterY) * scale;
    const x2 = centerX + (seg.worldEnd.x - entityCenterX) * scale;
    const y2 = centerY + (seg.worldEnd.y - entityCenterY) * scale;

    ctx.strokeStyle = SEGMENT_COLORS[seg.type];
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
}
