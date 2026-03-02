import { Entity, Camera, SEGMENT_COLORS, BAR_COLORS, Config, CAMERA_CONSTANTS, INPUT_CONSTANTS, VISUAL_EFFECTS_CONSTANTS, RENDER_STYLE_CONSTANTS, EnvironmentChannelId, FLASH_COLORS, SegmentType } from './types';
import { createClipAndDraw, drawWrappedSegments, renderEntityPreview as drawEntityPreview, renderGrid, renderWorldBoundary } from './rendererDraw';
import { EnvironmentField } from './environmentField';
import { getNeuralCircles, maxCircleIntersectionDistance } from './entity/neuralSense';

interface EnvironmentOverlayColorRamp {
  rBase: number;
  rScale: number;
  gBase: number;
  gScale: number;
  bBase: number;
  bScale: number;
}

const ENVIRONMENT_OVERLAY_COLORS: Record<EnvironmentChannelId, EnvironmentOverlayColorRamp> = {
  nutrient: {
    rBase: 64,
    rScale: 191,
    gBase: 32,
    gScale: 96,
    bBase: 0,
    bScale: 0,
  },
};

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private camera: Camera;
  private selectedEntity: Entity | null = null;
  private config: Config | null = null;
  private showHealthbars: boolean = false;
  private showFlashEffects: boolean = true;
  private showGrid: boolean = false;
  private environmentOverlayChannel: EnvironmentChannelId | 'none' = 'none';
  private showEnvironmentFootprintDebug: boolean = false;
  private showNeuralAndLocomotorActivity: boolean = false;
  private currentSimTimeMs: number = 0;
  private currentWallClockMs: number = 0;
  private entities: Entity[] = [];
  private environmentOverlayAlpha: number = 0.35;
  private environmentOverlayCanvas: HTMLCanvasElement | null = null;
  private environmentOverlayVersion: number = -1;
  private environmentOverlayChannelVersion: EnvironmentChannelId | 'none' | null = null;
  private speedMultiplier: number = 1;
  private dragStartX: number = 0;
  private dragStartY: number = 0;
  private dragExceededDeadZone: boolean = false;
  private isDragging: boolean = false;
  private lastMouseX: number = 0;
  private lastMouseY: number = 0;
  private lastTouchDist: number = 0;
  private lastTouchCenterX: number = 0;
  private lastTouchCenterY: number = 0;
  private dpr: number = 1;
  private logicalWidth: number = 0;
  private logicalHeight: number = 0;

  private readonly handleMouseDown = (e: MouseEvent): void => {
    this.isDragging = true;
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.dragExceededDeadZone = false;
  };

  private readonly handleMouseMove = (e: MouseEvent): void => {
    if (!this.isDragging) {
      return;
    }

    const dx = e.clientX - this.lastMouseX;
    const dy = e.clientY - this.lastMouseY;

    if (!this.dragExceededDeadZone) {
      const totalDx = e.clientX - this.dragStartX;
      const totalDy = e.clientY - this.dragStartY;
      const distance = Math.sqrt(totalDx * totalDx + totalDy * totalDy);
      if (distance > INPUT_CONSTANTS.panDeadZone) {
        this.dragExceededDeadZone = true;
      }
    }

    this.camera.x -= dx / this.camera.zoom;
    this.camera.y -= dy / this.camera.zoom;
    this.clampCamera();
    this.lastMouseX = e.clientX;
    this.lastMouseY = e.clientY;
  };

  private readonly handleMouseUp = (): void => {
    this.isDragging = false;
  };

  private readonly handleWheel = (e: WheelEvent): void => {
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = this.camera.zoom * zoomFactor;
    const isZoomingOut = e.deltaY > 0;
    const isAtMinZoom = this.camera.zoom <= CAMERA_CONSTANTS.zoomMin + 0.001;
    
    if (isZoomingOut && isAtMinZoom) {
      return;
    }
    
    e.preventDefault();
    this.camera.zoom = Math.max(CAMERA_CONSTANTS.zoomMin, Math.min(CAMERA_CONSTANTS.zoomMax, newZoom));
  };

  private readonly handleTouchStart = (e: TouchEvent): void => {
    if (e.touches.length === 1) {
      this.isDragging = true;
      this.lastMouseX = e.touches[0].clientX;
      this.lastMouseY = e.touches[0].clientY;
      this.dragStartX = e.touches[0].clientX;
      this.dragStartY = e.touches[0].clientY;
      this.dragExceededDeadZone = false;
    } else if (e.touches.length === 2) {
      this.lastTouchDist = this.getTouchDistance(e.touches);
      this.lastTouchCenterX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      this.lastTouchCenterY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    }
  };

  private readonly handleTouchMove = (e: TouchEvent): void => {
    if (e.touches.length === 1 && this.isDragging) {
      const dx = e.touches[0].clientX - this.lastMouseX;
      const dy = e.touches[0].clientY - this.lastMouseY;

      if (!this.dragExceededDeadZone) {
        const totalDx = e.touches[0].clientX - this.dragStartX;
        const totalDy = e.touches[0].clientY - this.dragStartY;
        const distance = Math.sqrt(totalDx * totalDx + totalDy * totalDy);
        if (distance > INPUT_CONSTANTS.panDeadZone) {
          this.dragExceededDeadZone = true;
        }
      }

      const newX = this.camera.x - dx / this.camera.zoom;
      const newY = this.camera.y - dy / this.camera.zoom;

      const clampedNewX = this.clampCameraX(newX);
      const clampedNewY = this.clampCameraY(newY);

      const atXLimit = clampedNewX !== newX;
      const atYLimit = clampedNewY !== newY;

      const wouldPanBeyondXLimit = (dx > 0 && atXLimit && newX < clampedNewX) || 
                                   (dx < 0 && atXLimit && newX > clampedNewX);
      const wouldPanBeyondYLimit = (dy > 0 && atYLimit && newY < clampedNewY) || 
                                   (dy < 0 && atYLimit && newY > clampedNewY);

      if (wouldPanBeyondXLimit || wouldPanBeyondYLimit) {
        this.lastMouseX = e.touches[0].clientX;
        this.lastMouseY = e.touches[0].clientY;
        return;
      }

      e.preventDefault();
      this.camera.x = clampedNewX;
      this.camera.y = clampedNewY;
      this.lastMouseX = e.touches[0].clientX;
      this.lastMouseY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      const dist = this.getTouchDistance(e.touches);
      const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;

      if (this.lastTouchDist > 0) {
        const zoomFactor = dist / this.lastTouchDist;
        const isZoomingOut = zoomFactor < 1;
        const isAtMinZoom = this.camera.zoom <= CAMERA_CONSTANTS.zoomMin + 0.001;

        if (isZoomingOut && isAtMinZoom) {
          this.lastTouchDist = dist;
          this.lastTouchCenterX = centerX;
          this.lastTouchCenterY = centerY;
          return;
        }

        e.preventDefault();
        this.camera.zoom = Math.max(
          CAMERA_CONSTANTS.zoomMin,
          Math.min(CAMERA_CONSTANTS.zoomMax, this.camera.zoom * zoomFactor)
        );

        const dx = centerX - this.lastTouchCenterX;
        const dy = centerY - this.lastTouchCenterY;
        this.camera.x -= dx / this.camera.zoom;
        this.camera.y -= dy / this.camera.zoom;
        this.clampCamera();
      }

      this.lastTouchDist = dist;
      this.lastTouchCenterX = centerX;
      this.lastTouchCenterY = centerY;
    }
  };

  private readonly handleTouchEnd = (): void => {
    this.isDragging = false;
    this.lastTouchDist = 0;
  };

  private readonly handleVisualViewportResize = (): void => {
    this.resize();
  };

  private getTouchDistance(touches: TouchList): number {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }
  
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.setupInteraction();
  }

  private clampCamera(): void {
    this.camera.x = this.clampCameraX(this.camera.x);
    this.camera.y = this.clampCameraY(this.camera.y);
  }

  private clampCameraX(x: number): number {
    if (!this.config) return x;
    const maxOffset = Math.max(this.config.worldWidth, this.config.worldHeight) * CAMERA_CONSTANTS.panMaxOffsetRatio;
    const centerX = this.config.worldWidth / 2;
    return Math.max(centerX - maxOffset, Math.min(centerX + maxOffset, x));
  }

  private clampCameraY(y: number): number {
    if (!this.config) return y;
    const maxOffset = Math.max(this.config.worldWidth, this.config.worldHeight) * CAMERA_CONSTANTS.panMaxOffsetRatio;
    const centerY = this.config.worldHeight / 2;
    return Math.max(centerY - maxOffset, Math.min(centerY + maxOffset, y));
  }
  
  private setupInteraction(): void {
    this.canvas.addEventListener('mousedown', this.handleMouseDown);
    this.canvas.addEventListener('mouseup', this.handleMouseUp);
    window.addEventListener('mousemove', this.handleMouseMove);
    window.addEventListener('mouseup', this.handleMouseUp);
    window.addEventListener('blur', this.handleMouseUp);
    this.canvas.addEventListener('wheel', this.handleWheel);
    this.canvas.addEventListener('touchstart', this.handleTouchStart, { passive: false });
    this.canvas.addEventListener('touchmove', this.handleTouchMove, { passive: false });
    this.canvas.addEventListener('touchend', this.handleTouchEnd);
    window.visualViewport?.addEventListener('resize', this.handleVisualViewportResize);
  }

  dispose(): void {
    this.canvas.removeEventListener('mousedown', this.handleMouseDown);
    this.canvas.removeEventListener('mouseup', this.handleMouseUp);
    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('mouseup', this.handleMouseUp);
    window.removeEventListener('blur', this.handleMouseUp);
    this.canvas.removeEventListener('wheel', this.handleWheel);
    this.canvas.removeEventListener('touchstart', this.handleTouchStart);
    this.canvas.removeEventListener('touchmove', this.handleTouchMove);
    this.canvas.removeEventListener('touchend', this.handleTouchEnd);
    window.visualViewport?.removeEventListener('resize', this.handleVisualViewportResize);
  }
  
  setSelectedEntity(entity: Entity | null): void {
    this.selectedEntity = entity;
  }
  
  setShowHealthbars(show: boolean): void {
    this.showHealthbars = show;
  }
  
  setShowFlashEffects(show: boolean): void {
    this.showFlashEffects = show;
  }
  
  setShowGrid(show: boolean): void {
    this.showGrid = show;
  }

  setShowEnvironmentFootprintDebug(show: boolean): void {
    this.showEnvironmentFootprintDebug = show;
  }

  setShowNeuralAndLocomotorActivity(show: boolean): void {
    this.showNeuralAndLocomotorActivity = show;
  }

  setEnvironmentOverlayChannel(channel: EnvironmentChannelId | 'none'): void {
    this.environmentOverlayChannel = channel;
  }
  
  setSpeedMultiplier(speed: number): void {
    this.speedMultiplier = speed;
  }

  private getFlashDuration(): number {
    return (
      VISUAL_EFFECTS_CONSTANTS.flashDurationMs /
      (this.speedMultiplier * (this.config?.simulationTimeScale || 1))
    );
  }

  getCamera(): Camera {
    return this.camera;
  }

  centerCamera(
    worldWidth: number,
    worldHeight: number,
    framingWidth: number = this.logicalWidth,
    framingHeight: number = this.logicalHeight,
  ): void {
    const safeWorldWidth = Math.max(1, worldWidth);
    const safeWorldHeight = Math.max(1, worldHeight);
    const fitWidth = Math.max(1, this.logicalWidth - CAMERA_CONSTANTS.fallbackBorderPaddingPx * 2);
    const fitHeight = Math.max(1, this.logicalHeight - CAMERA_CONSTANTS.fallbackBorderPaddingPx * 2);
    const fitWidthZoom = fitWidth / safeWorldWidth;
    const fitHeightZoom = fitHeight / safeWorldHeight;
    const useHorizontalInset = framingWidth >= framingHeight;

    this.camera.zoom = Math.max(
      CAMERA_CONSTANTS.zoomMin,
      Math.min(CAMERA_CONSTANTS.zoomMax, useHorizontalInset ? fitWidthZoom : fitHeightZoom)
    );

    const horizontalPadding = Math.max(0, (this.logicalWidth - worldWidth * this.camera.zoom) / 2);
    const verticalPadding = Math.max(0, (this.logicalHeight - worldHeight * this.camera.zoom) / 2);
    const hasHorizontalSlack = horizontalPadding > 0;
    const hasVerticalSlack = verticalPadding > 0;
    const insetPaddingScale = CAMERA_CONSTANTS.insetPaddingScale;

    this.camera.x = worldWidth / 2;
    this.camera.y = worldHeight / 2;

    if (hasHorizontalSlack && hasVerticalSlack) {
      // Keep centered when the full world is visible on both axes.
    } else if (useHorizontalInset) {
      if (hasVerticalSlack) {
        this.camera.x = (this.logicalWidth / 2 - verticalPadding * insetPaddingScale) / this.camera.zoom;
      }
    } else if (hasHorizontalSlack) {
      this.camera.y = (this.logicalHeight / 2 - horizontalPadding * insetPaddingScale) / this.camera.zoom;
    }

    this.clampCamera();
  }

  centerCameraOn(x: number, y: number): void {
    this.camera.x = x;
    this.camera.y = y;
    this.clampCamera();
  }

  centerCameraOnAtScreenPoint(worldX: number, worldY: number, screenX: number, screenY: number): void {
    this.camera.x = worldX - (screenX - this.logicalWidth / 2) / this.camera.zoom;
    this.camera.y = worldY - (screenY - this.logicalHeight / 2) / this.camera.zoom;
    this.clampCamera();
  }
  
  didDragExceedDeadZone(): boolean {
    return this.dragExceededDeadZone;
  }
  
  resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const visualScale = window.visualViewport?.scale || 1;
    const effectiveDpr = Math.min(dpr * visualScale, 2);
    const logicalWidth = this.canvas.clientWidth || this.logicalWidth || 1;
    const logicalHeight = this.canvas.clientHeight || this.logicalHeight || 1;
    
    if (logicalWidth < 1 || logicalHeight < 1) {
      return;
    }
    
    this.dpr = effectiveDpr;
    this.logicalWidth = logicalWidth;
    this.logicalHeight = logicalHeight;
    this.canvas.width = Math.round(logicalWidth * effectiveDpr);
    this.canvas.height = Math.round(logicalHeight * effectiveDpr);
    this.ctx.setTransform(effectiveDpr, 0, 0, effectiveDpr, 0, 0);
  }

  getLogicalWidth(): number {
    return this.logicalWidth;
  }

  getLogicalHeight(): number {
    return this.logicalHeight;
  }

  applyHorizontalAnchorShift(widthDelta: number, anchor: 'center' | 'left' | 'right'): void {
    if (widthDelta === 0) {
      return;
    }

    if (anchor === 'left') {
      this.camera.x += widthDelta / (2 * this.camera.zoom);
    } else if (anchor === 'right') {
      this.camera.x -= widthDelta / (2 * this.camera.zoom);
    }
    this.clampCamera();
  }

  private normalizeAxisBorderVisibility(
    worldScreenLength: number,
    canvasLength: number,
    startBorder: number,
    endBorder: number,
    applyShift: (shiftScreenPx: number) => void,
  ): void {
    const epsilon = CAMERA_CONSTANTS.borderVisibilityEpsilonPx;

    if (worldScreenLength <= canvasLength) {
      const centerPadding = Math.max(0, (canvasLength - worldScreenLength) / 2);
      const desiredPadding = Math.min(CAMERA_CONSTANTS.fallbackBorderPaddingPx, centerPadding);
      const minStart = Math.max(epsilon, desiredPadding);
      const maxStart = canvasLength - worldScreenLength - minStart;
      if (maxStart < minStart) {
        return;
      }

      const clampedStart = Math.max(minStart, Math.min(maxStart, startBorder));
      const shiftScreen = clampedStart - startBorder;
      if (Math.abs(shiftScreen) < 0.01) {
        return;
      }

      applyShift(shiftScreen);
      this.clampCamera();
      return;
    }

    const startVisible = startBorder >= 0;
    const endVisible = endBorder <= canvasLength;
    if (startVisible === endVisible) {
      return;
    }

    const shiftScreen = endVisible
      ? canvasLength + epsilon - endBorder
      : -epsilon - startBorder;
    applyShift(shiftScreen);
    this.clampCamera();
  }

  normalizeHorizontalBorderVisibility(worldWidth: number): void {
    const worldScreenWidth = worldWidth * this.camera.zoom;
    const leftBorderX = (0 - this.camera.x) * this.camera.zoom + this.logicalWidth / 2;
    const rightBorderX = (worldWidth - this.camera.x) * this.camera.zoom + this.logicalWidth / 2;

    this.normalizeAxisBorderVisibility(
      worldScreenWidth,
      this.logicalWidth,
      leftBorderX,
      rightBorderX,
      (shiftScreenX) => {
        this.camera.x -= shiftScreenX / this.camera.zoom;
      }
    );
  }

  normalizeVerticalBorderVisibility(worldHeight: number): void {
    const worldScreenHeight = worldHeight * this.camera.zoom;
    const topBorderY = (0 - this.camera.y) * this.camera.zoom + this.logicalHeight / 2;
    const bottomBorderY = (worldHeight - this.camera.y) * this.camera.zoom + this.logicalHeight / 2;

    this.normalizeAxisBorderVisibility(
      worldScreenHeight,
      this.logicalHeight,
      topBorderY,
      bottomBorderY,
      (shiftScreenY) => {
        this.camera.y -= shiftScreenY / this.camera.zoom;
      }
    );
  }
  
  clear(): void {
    this.ctx.fillStyle = '#1a1a2e';
    this.ctx.fillRect(0, 0, this.logicalWidth, this.logicalHeight);
  }
  
  private worldToScreen(x: number, y: number): { x: number; y: number } {
    return {
      x: (x - this.camera.x) * this.camera.zoom + this.logicalWidth / 2,
      y: (y - this.camera.y) * this.camera.zoom + this.logicalHeight / 2
    };
  }

  private wrappedAxisDelta(from: number, to: number, worldSize: number): number {
    let delta = to - from;
    const half = worldSize * 0.5;
    if (delta > half) delta -= worldSize;
    else if (delta < -half) delta += worldSize;
    return delta;
  }

  private isEntityVisible(entity: Entity): boolean {
    if (!this.config) return true;
    if (this.logicalWidth <= 0 || this.logicalHeight <= 0 || this.camera.zoom <= 0) return true;

    const halfViewWorldWidth = this.logicalWidth / (2 * this.camera.zoom);
    const halfViewWorldHeight = this.logicalHeight / (2 * this.camera.zoom);
    const margin = entity.boundingRadius + RENDER_STYLE_CONSTANTS.segmentLineWidth;

    const dx = this.wrappedAxisDelta(this.camera.x, entity.com.x, this.config.worldWidth);
    const dy = this.wrappedAxisDelta(this.camera.y, entity.com.y, this.config.worldHeight);

    return Math.abs(dx) <= halfViewWorldWidth + margin && Math.abs(dy) <= halfViewWorldHeight + margin;
  }
  
  render(entities: Entity[], config: Config, environmentField?: EnvironmentField | null, simulationTimeSec?: number): void {
    this.config = config;
    this.currentSimTimeMs = (simulationTimeSec ?? 0) * 1000;
    this.currentWallClockMs = performance.now();
    this.entities = entities;
    const dpr = window.devicePixelRatio || 1;
    const visualScale = window.visualViewport?.scale || 1;
    const effectiveDpr = Math.min(dpr * visualScale, 2);
    const clientWidth = this.canvas.clientWidth;
    const clientHeight = this.canvas.clientHeight;
    
    if (
      clientWidth > 0 &&
      clientHeight > 0 &&
      (Math.abs(effectiveDpr - this.dpr) > 0.001 ||
        clientWidth !== this.logicalWidth ||
        clientHeight !== this.logicalHeight)
    ) {
      this.resize();
    }
    this.clampCamera();
    this.clear();
    if (this.environmentOverlayChannel !== 'none' && environmentField) {
      this.renderEnvironmentOverlay(environmentField, config);
    }
    if (this.showGrid) {
      renderGrid(this.ctx, this.camera, this.logicalWidth, this.logicalHeight, (x, y) => this.worldToScreen(x, y));
    }
    
    for (const entity of entities) {
      if (!this.isEntityVisible(entity)) {
        continue;
      }
      this.renderEntity(entity);
    }

    if (this.showEnvironmentFootprintDebug) {
      this.renderEnvironmentFootprintDebug(entities, config);
    }
    
    if (this.showNeuralAndLocomotorActivity) {
      this.renderNeuralRangeDebug(entities);
    }
    
    renderWorldBoundary(this.ctx, config, (x, y) => this.worldToScreen(x, y));
  }

  private renderEnvironmentOverlay(environmentField: EnvironmentField, config: Config): void {
    const width = environmentField.getFieldWidth();
    const height = environmentField.getFieldHeight();
    if (width <= 0 || height <= 0) return;

    if (!this.environmentOverlayCanvas || this.environmentOverlayCanvas.width !== width || this.environmentOverlayCanvas.height !== height) {
      this.environmentOverlayCanvas = document.createElement('canvas');
      this.environmentOverlayCanvas.width = width;
      this.environmentOverlayCanvas.height = height;
      this.environmentOverlayVersion = -1;
      this.environmentOverlayChannelVersion = null;
    }

    if (
      this.environmentOverlayVersion !== environmentField.getVersion()
      || this.environmentOverlayChannelVersion !== this.environmentOverlayChannel
    ) {
      const ctx = this.environmentOverlayCanvas.getContext('2d');
      if (!ctx) return;
      if (this.environmentOverlayChannel === 'none') return;
      const channelId = this.environmentOverlayChannel;
      const values = environmentField.getChannelValues(channelId);
      const colorRamp = ENVIRONMENT_OVERLAY_COLORS[channelId];
      const imageData = ctx.createImageData(width, height);
      const data = imageData.data;

      for (let i = 0; i < values.length; i++) {
        const value = Math.max(0, Math.min(1, values[i]));
        const di = i * 4;
        data[di] = Math.round(colorRamp.rBase + value * colorRamp.rScale);
        data[di + 1] = Math.round(colorRamp.gBase + value * colorRamp.gScale);
        data[di + 2] = Math.round(colorRamp.bBase + value * colorRamp.bScale);
        data[di + 3] = Math.round(value * 255);
      }

      ctx.putImageData(imageData, 0, 0);
      this.environmentOverlayVersion = environmentField.getVersion();
      this.environmentOverlayChannelVersion = this.environmentOverlayChannel;
    }

    const topLeft = this.worldToScreen(0, 0);
    const bottomRight = this.worldToScreen(config.worldWidth, config.worldHeight);
    const drawX = Math.min(topLeft.x, bottomRight.x);
    const drawY = Math.min(topLeft.y, bottomRight.y);
    const drawWidth = Math.abs(bottomRight.x - topLeft.x);
    const drawHeight = Math.abs(bottomRight.y - topLeft.y);

    this.ctx.save();
    this.ctx.globalAlpha = this.environmentOverlayAlpha;
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.drawImage(this.environmentOverlayCanvas, drawX, drawY, drawWidth, drawHeight);
    this.ctx.restore();
  }

  private renderEnvironmentFootprintDebug(entities: Entity[], config: Config): void {
    if (!this.selectedEntity) return;
    const entity = entities.find(candidate => candidate.id === this.selectedEntity?.id);
    if (!entity) return;

    const radiusWorld = Math.max(
      config.environmentCellSize * 0.75,
      entity.boundingRadius * config.environmentFootprintScale
    );
    const radiusScreen = radiusWorld * this.camera.zoom;

    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    this.ctx.fillStyle = 'rgba(120, 220, 255, 0.1)';
    this.ctx.setLineDash([6, 4]);
    this.ctx.lineWidth = 1.5;

    const center = this.worldToScreen(entity.com.x, entity.com.y);
    if (
      center.x + radiusScreen >= 0
      && center.x - radiusScreen <= this.logicalWidth
      && center.y + radiusScreen >= 0
      && center.y - radiusScreen <= this.logicalHeight
    ) {
      this.ctx.beginPath();
      this.ctx.arc(center.x, center.y, radiusScreen, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  private renderNeuralRangeDebug(entities: Entity[]): void {
    if (!this.showNeuralAndLocomotorActivity) return;
    if (!this.selectedEntity) return;
    const entity = entities.find(candidate => candidate.id === this.selectedEntity?.id);
    if (!entity) return;

    const neuralSegments = entity.segments.filter(s => s.type === SegmentType.Neural);
    if (neuralSegments.length === 0) return;

    const circles = getNeuralCircles(neuralSegments);
    if (circles.length === 0) return;

    const originX = entity.com.x;
    const originY = entity.com.y;

    const steps = 64;
    const points: { x: number; y: number }[] = [];

    for (let i = 0; i <= steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      const dirX = Math.cos(angle);
      const dirY = Math.sin(angle);
      const maxDist = maxCircleIntersectionDistance(originX, originY, circles, dirX, dirY);

      points.push({
        x: originX + dirX * maxDist,
        y: originY + dirY * maxDist,
      });
    }

    this.ctx.save();
    this.ctx.strokeStyle = 'rgba(230, 194, 0, 0.7)';
    this.ctx.fillStyle = 'rgba(230, 194, 0, 0.08)';
    this.ctx.setLineDash([4, 3]);
    this.ctx.lineWidth = 1.5;

    const screenPoints = points.map(p => this.worldToScreen(p.x, p.y));
    if (
      !screenPoints.every(p => p.x < 0)
      && !screenPoints.every(p => p.x > this.logicalWidth)
      && !screenPoints.every(p => p.y < 0)
      && !screenPoints.every(p => p.y > this.logicalHeight)
    ) {
      this.ctx.beginPath();
      this.ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
      for (let i = 1; i < screenPoints.length; i++) {
        this.ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
      }
      this.ctx.closePath();
      this.ctx.fill();
      this.ctx.stroke();
    }

    this.ctx.restore();
  }
  
  private renderEntity(entity: Entity): void {
    const isSelected = this.selectedEntity?.id === entity.id;
    const now = this.currentSimTimeMs;
    const nowWallClock = this.currentWallClockMs;
    const w = this.config?.worldWidth ?? 1000;
    const h = this.config?.worldHeight ?? 1000;
    const cameraX = this.camera.x;
    const cameraY = this.camera.y;
    const zoom = this.camera.zoom;
    const halfWidth = this.logicalWidth / 2;
    const halfHeight = this.logicalHeight / 2;
    const lineWidth = RENDER_STYLE_CONSTANTS.segmentLineWidth * zoom;
    const flashDuration = this.getFlashDuration();
    this.ctx.lineWidth = lineWidth;
    this.ctx.lineCap = 'round';
    
    const drawSegment = (x1: number, y1: number, x2: number, y2: number, seg: typeof entity.segments[0]): void => {
      const startX = (x1 - cameraX) * zoom + halfWidth;
      const startY = (y1 - cameraY) * zoom + halfHeight;
      const endX = (x2 - cameraX) * zoom + halfWidth;
      const endY = (y2 - cameraY) * zoom + halfHeight;
      
      let color: string;
      if (
        this.showFlashEffects &&
        entity.dead &&
        nowWallClock - entity.deathTimeMs < flashDuration
      ) {
        color = FLASH_COLORS.deathFlashColor;
      } else if (
        this.showFlashEffects &&
        nowWallClock - seg.lastAttackedTimeMs < flashDuration
      ) {
        color = FLASH_COLORS.attackFlashColor;
      } else {
        color = SEGMENT_COLORS[seg.type];
      }
      
      this.ctx.strokeStyle = color;
      
      this.ctx.beginPath();
      this.ctx.moveTo(startX, startY);
      this.ctx.lineTo(endX, endY);
      this.ctx.stroke();
    };
    
    const clipAndDraw = createClipAndDraw(w, h, drawSegment);
    
    drawWrappedSegments(entity.segments, w, h, clipAndDraw);
    this.renderNeuralAndLocomotorActivity(entity, now, this.entities);
    
    if (isSelected) {
      const padding = 4 / this.camera.zoom;
      const boxMinX = entity.aabbMin.x - padding;
      const boxMinY = entity.aabbMin.y - padding;
      const boxMaxX = entity.aabbMax.x + padding;
      const boxMaxY = entity.aabbMax.y + padding;
      const boxCenterX = (boxMinX + boxMaxX) / 2;
      const boxCenterY = (boxMinY + boxMaxY) / 2;
      const boxW = boxMaxX - boxMinX;
      const boxH = boxMaxY - boxMinY;
      
      const drawClippedSelectionBox = (offsetX: number, offsetY: number): void => {
        const cx = boxCenterX + offsetX;
        const cy = boxCenterY + offsetY;
        if (cx + boxW / 2 <= 0 || cx - boxW / 2 >= w || cy + boxH / 2 <= 0 || cy - boxH / 2 >= h) return;
        
        this.ctx.save();
        const topLeft = this.worldToScreen(0, 0);
        const bottomRight = this.worldToScreen(w, h);
        this.ctx.beginPath();
        this.ctx.rect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
        this.ctx.clip();
        
        const screenMin = this.worldToScreen(cx - boxW / 2, cy - boxH / 2);
        const screenMax = this.worldToScreen(cx + boxW / 2, cy + boxH / 2);
        this.ctx.strokeStyle = '#ffffff';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(screenMin.x, screenMin.y, screenMax.x - screenMin.x, screenMax.y - screenMin.y);
        
        this.ctx.restore();
      };
      
      drawClippedSelectionBox(0, 0);
      drawClippedSelectionBox(w, 0);
      drawClippedSelectionBox(-w, 0);
      drawClippedSelectionBox(0, h);
      drawClippedSelectionBox(0, -h);
    }
    
    if (this.showHealthbars) {
      this.renderBars(entity);
    }
  }

  private renderBars(entity: Entity): void {
    if (!this.config) return;

    const barWidth = RENDER_STYLE_CONSTANTS.barWidth * this.camera.zoom;
    const barHeight = RENDER_STYLE_CONSTANTS.barHeight * this.camera.zoom;
    const barGap = RENDER_STYLE_CONSTANTS.barGap * this.camera.zoom;
    const pos = this.worldToScreen(entity.position.x, entity.position.y);
    const startY = pos.y - RENDER_STYLE_CONSTANTS.barOffsetY * this.camera.zoom;
    
    const bars: { ratio: number; color: string }[] = [
      { ratio: entity.reproductiveBuffer / entity.reproductiveThreshold, color: BAR_COLORS.repro },
      { ratio: entity.foodBuffer / entity.maxFoodBuffer, color: BAR_COLORS.food },
      { ratio: entity.hp / entity.maxHp, color: BAR_COLORS.hp }
    ];

    for (let i = 0; i < bars.length; i++) {
      const y = startY - i * (barHeight + barGap);
      this.ctx.fillStyle = '#333';
      this.ctx.fillRect(pos.x - barWidth / 2, y, barWidth, barHeight);
      this.ctx.fillStyle = bars[i].color;
      this.ctx.fillRect(pos.x - barWidth / 2, y, barWidth * Math.max(0, Math.min(1, bars[i].ratio)), barHeight);
    }
  }

  private renderNeuralAndLocomotorActivity(entity: Entity, now: number, entities: Entity[]): void {
    if (!this.showNeuralAndLocomotorActivity) return;

    const exhaustDuration = VISUAL_EFFECTS_CONSTANTS.exhaustDurationMs;
    const exhaustLength = VISUAL_EFFECTS_CONSTANTS.exhaustLengthWorld;

    for (const seg of entity.segments) {
      if (seg.type !== SegmentType.Locomotor) continue;

      const elapsed = now - seg.lastPulseTimeMs;
      if (elapsed < 0 || elapsed >= exhaustDuration) continue;

      const alpha = 1 - elapsed / exhaustDuration;

      const dx = seg.worldEnd.x - seg.worldStart.x;
      const dy = seg.worldEnd.y - seg.worldStart.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) continue;

      const dirX = dx / len;
      const dirY = dy / len;
      const pulseDir = seg.lastPulseDirection;

      const startX = pulseDir === 1 ? seg.worldStart.x : seg.worldEnd.x;
      const startY = pulseDir === 1 ? seg.worldStart.y : seg.worldEnd.y;

      const exhaustDirX = -dirX * pulseDir;
      const exhaustDirY = -dirY * pulseDir;

      const endX = startX + exhaustDirX * exhaustLength;
      const endY = startY + exhaustDirY * exhaustLength;

      const startScreen = this.worldToScreen(startX, startY);
      const endScreen = this.worldToScreen(endX, endY);

      this.ctx.strokeStyle = `rgba(100, 180, 255, ${alpha * 0.6})`;
      this.ctx.lineWidth = RENDER_STYLE_CONSTANTS.segmentLineWidth * this.camera.zoom * 0.8;
      this.ctx.lineCap = 'round';
      this.ctx.beginPath();
      this.ctx.moveTo(startScreen.x, startScreen.y);
      this.ctx.lineTo(endScreen.x, endScreen.y);
      this.ctx.stroke();
    }

    if (entity.lastNeuralBehavior !== null && entity.segments.some(s => s.type === SegmentType.Locomotor)) {
      const elapsed = now - entity.lastNeuralTargetTimeMs;
      if (elapsed >= 0 && elapsed < exhaustDuration) {
        const alpha = 1 - elapsed / exhaustDuration;
        
        const startScreen = this.worldToScreen(entity.com.x, entity.com.y);
        const dirLen = Math.sqrt(entity.lastNeuralDirection.x ** 2 + entity.lastNeuralDirection.y ** 2);
        
        if (dirLen > 0 && entity.lastNeuralBehavior === 'forage') {
          const gradientEndX = entity.com.x + entity.lastNeuralDirection.x * 50;
          const gradientEndY = entity.com.y + entity.lastNeuralDirection.y * 50;
          const endScreen = this.worldToScreen(gradientEndX, gradientEndY);
          
          this.ctx.strokeStyle = `rgba(0, 200, 100, ${alpha * 0.8})`;
          this.ctx.lineWidth = RENDER_STYLE_CONSTANTS.segmentLineWidth * this.camera.zoom;
          this.ctx.lineCap = 'round';
          this.ctx.beginPath();
          this.ctx.moveTo(startScreen.x, startScreen.y);
          this.ctx.lineTo(endScreen.x, endScreen.y);
          this.ctx.stroke();
        } else if (entity.lastNeuralTargetId !== null) {
          const target = entities.find(e => e.id === entity.lastNeuralTargetId);
          if (target && !target.dead) {
            const dx = target.com.x - entity.com.x;
            const dy = target.com.y - entity.com.y;
            const w = this.config?.worldWidth ?? 1000;
            const h = this.config?.worldHeight ?? 1000;
            let wrappedDx = dx;
            let wrappedDy = dy;
            if (dx > w / 2) wrappedDx -= w;
            if (dx < -w / 2) wrappedDx += w;
            if (dy > h / 2) wrappedDy -= h;
            if (dy < -h / 2) wrappedDy += h;

            const endScreen = this.worldToScreen(entity.com.x + wrappedDx, entity.com.y + wrappedDy);
            
            const color = entity.lastNeuralBehavior === 'flee' 
              ? `rgba(255, 100, 50, ${alpha * 0.8})`
              : `rgba(255, 220, 0, ${alpha * 0.8})`;
            
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = RENDER_STYLE_CONSTANTS.segmentLineWidth * this.camera.zoom;
            this.ctx.lineCap = 'round';
            this.ctx.beginPath();
            this.ctx.moveTo(startScreen.x, startScreen.y);
            this.ctx.lineTo(endScreen.x, endScreen.y);
            this.ctx.stroke();
          }
        }
      }
    }
  }
  
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: (screenX - this.logicalWidth / 2) / this.camera.zoom + this.camera.x,
      y: (screenY - this.logicalHeight / 2) / this.camera.zoom + this.camera.y
    };
  }
  
  renderEntityPreview(entity: Entity, previewCanvas: HTMLCanvasElement): void {
    drawEntityPreview(entity, previewCanvas);
  }

  renderToWorldCanvas(
    targetCanvas: HTMLCanvasElement,
    entities: Entity[],
    config: Config
  ): void {
    const ctx = targetCanvas.getContext('2d')!;
    const w = targetCanvas.width;
    const h = targetCanvas.height;

    const zoom = Math.min(w / config.worldWidth, h / config.worldHeight);
    const cameraX = config.worldWidth / 2;
    const cameraY = config.worldHeight / 2;

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);

    const worldToScreen = (wx: number, wy: number): { x: number; y: number } => {
      return {
        x: (wx - cameraX) * zoom + w / 2,
        y: (wy - cameraY) * zoom + h / 2
      };
    };

    for (const entity of entities) {
      this.renderEntityToContext(entity, ctx, worldToScreen, zoom, config);
    }

    ctx.strokeStyle = '#4a4a6a';
    ctx.lineWidth = 2;
    const corners = [
      worldToScreen(0, 0),
      worldToScreen(config.worldWidth, 0),
      worldToScreen(config.worldWidth, config.worldHeight),
      worldToScreen(0, config.worldHeight)
    ];
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) {
      ctx.lineTo(corners[i].x, corners[i].y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  private renderEntityToContext(
    entity: Entity,
    ctx: CanvasRenderingContext2D,
    worldToScreen: (x: number, y: number) => { x: number; y: number },
    zoom: number,
    config: Config
  ): void {
    const w = config.worldWidth;
    const h = config.worldHeight;

    const drawSegment = (x1: number, y1: number, x2: number, y2: number, seg: typeof entity.segments[0]): void => {
      const start = worldToScreen(x1, y1);
      const end = worldToScreen(x2, y2);
      
      ctx.strokeStyle = SEGMENT_COLORS[seg.type];
      ctx.lineWidth = RENDER_STYLE_CONSTANTS.segmentLineWidth * zoom;
      ctx.lineCap = 'round';
      
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    };

    const clipAndDraw = createClipAndDraw(w, h, drawSegment);
    drawWrappedSegments(entity.segments, w, h, clipAndDraw);
  }
}
