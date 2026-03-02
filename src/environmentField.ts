import {
  ENVIRONMENT_CHANNELS,
  ENVIRONMENT_FIELD_CONSTANTS,
  EnvironmentChannelId,
  NutrientFieldType,
} from './types';

export interface EnvironmentFieldConfig {
  worldWidth: number;
  worldHeight: number;
  cellSize: number;
  nutrientFieldType?: NutrientFieldType;
}

export interface EnvironmentFieldStepConfig {
  nutrientRegenRate: number;
}

interface EnvironmentFieldDimensions {
  fieldWidth: number;
  fieldHeight: number;
}

interface EnvironmentFootprintKernel {
  dx: Int16Array;
  dy: Int16Array;
  weights: Float32Array;
}

const REFERENCE_ENVIRONMENT_CELL_SIZE = 16;
const REFERENCE_ENVIRONMENT_CELL_AREA = REFERENCE_ENVIRONMENT_CELL_SIZE * REFERENCE_ENVIRONMENT_CELL_SIZE;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function positiveModulo(value: number, divisor: number): number {
  if (divisor <= 0) return 0;
  return ((value % divisor) + divisor) % divisor;
}

function wrapIndexFast(value: number, size: number): number {
  if (value >= 0 && value < size) return value;
  const wrappedOnce = value < 0 ? value + size : value - size;
  if (wrappedOnce >= 0 && wrappedOnce < size) return wrappedOnce;
  return positiveModulo(value, size);
}

function computeFieldSize(worldSize: number, cellSize: number): number {
  if (worldSize <= 0 || cellSize <= 0) return 1;
  return Math.max(1, Math.ceil(worldSize / cellSize));
}

function computeDimensions(worldWidth: number, worldHeight: number, cellSize: number): EnvironmentFieldDimensions {
  return {
    fieldWidth: computeFieldSize(worldWidth, cellSize),
    fieldHeight: computeFieldSize(worldHeight, cellSize),
  };
}

function createChannelStore(size: number): Record<EnvironmentChannelId, Float32Array> {
  const channels = {} as Record<EnvironmentChannelId, Float32Array>;
  for (const channelId of ENVIRONMENT_CHANNELS) {
    channels[channelId] = new Float32Array(size);
  }
  return channels;
}

export class EnvironmentField {
  private worldWidth: number;
  private worldHeight: number;
  private cellSize: number;
  private fieldWidth: number;
  private fieldHeight: number;
  private version: number = 0;
  private channels: Record<EnvironmentChannelId, Float32Array>;
  private footprintKernelCache: Map<number, Map<number, EnvironmentFootprintKernel>> = new Map();
  private lastFootprintKernelRadius: number = -1;
  private lastFootprintKernelPowerKey: number = -1;
  private lastFootprintKernelThresholdKey: number = -1;
  private lastFootprintKernel: EnvironmentFootprintKernel | null = null;
  private nutrientFieldType: NutrientFieldType = 'uniform';
  private nutrientTargets: Float32Array | null = null;

  private storeFootprintKernel(
    radius: number,
    powerKey: number,
    thresholdKey: number,
    kernel: EnvironmentFootprintKernel
  ): EnvironmentFootprintKernel {
    const combinedKey = powerKey * 1000 + thresholdKey;
    let kernelsByRadius = this.footprintKernelCache.get(radius);
    if (!kernelsByRadius) {
      kernelsByRadius = new Map();
      this.footprintKernelCache.set(radius, kernelsByRadius);
    }
    kernelsByRadius.set(combinedKey, kernel);

    this.lastFootprintKernelRadius = radius;
    this.lastFootprintKernelPowerKey = powerKey;
    this.lastFootprintKernelThresholdKey = thresholdKey;
    this.lastFootprintKernel = kernel;

    return kernel;
  }

  private getBaselineAmountToDensityScale(): number {
    const cellArea = this.cellSize * this.cellSize;
    if (!Number.isFinite(cellArea) || cellArea <= 0) return 1;
    return REFERENCE_ENVIRONMENT_CELL_AREA / cellArea;
  }

  constructor(config: EnvironmentFieldConfig) {
    this.worldWidth = Math.max(1, config.worldWidth);
    this.worldHeight = Math.max(1, config.worldHeight);
    this.cellSize = Math.max(1, config.cellSize);
    this.nutrientFieldType = config.nutrientFieldType ?? 'uniform';
    const dimensions = computeDimensions(this.worldWidth, this.worldHeight, this.cellSize);
    this.fieldWidth = dimensions.fieldWidth;
    this.fieldHeight = dimensions.fieldHeight;
    this.channels = createChannelStore(this.fieldWidth * this.fieldHeight);
    this.reset();
  }

  getCellSize(): number {
    return this.cellSize;
  }

  getFieldWidth(): number {
    return this.fieldWidth;
  }

  getFieldHeight(): number {
    return this.fieldHeight;
  }

  getVersion(): number {
    return this.version;
  }

  getChannelValues(channelId: EnvironmentChannelId): Float32Array {
    return this.channels[channelId];
  }

  setNutrientFieldType(type: NutrientFieldType): void {
    this.nutrientFieldType = type;
    this.reset();
  }

  clear(): void {
    for (const channelId of ENVIRONMENT_CHANNELS) {
      this.channels[channelId].fill(0);
    }
    this.version++;
  }

  private computeNutrientTarget(x: number, y: number): number {
    const centerX = this.worldWidth / 2;
    const centerY = this.worldHeight / 2;
    const halfWidth = this.worldWidth / 2;
    const halfHeight = this.worldHeight / 2;
    const maxDist = Math.sqrt(halfWidth * halfWidth + halfHeight * halfHeight);

    switch (this.nutrientFieldType) {
      case 'uniform':
        return 1;

      case 'center': {
        const dx = x - centerX;
        const dy = y - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const fullRadius = maxDist * 0.15;
        const falloffRadius = maxDist * 0.5;
        if (dist <= fullRadius) {
          return 1;
        }
        if (dist >= falloffRadius) {
          return 0;
        }
        const t = (dist - fullRadius) / (falloffRadius - fullRadius);
        return clamp01(Math.pow(1 - t, 0.8));
      }

      case 'edges': {
        const distFromLeft = x;
        const distFromRight = this.worldWidth - x;
        const distFromTop = y;
        const distFromBottom = this.worldHeight - y;
        const minDistToEdge = Math.min(distFromLeft, distFromRight, distFromTop, distFromBottom);
        const fullRadius = maxDist * 0.1;
        const falloffRadius = maxDist * 0.35;
        if (minDistToEdge <= fullRadius) {
          return 1;
        }
        if (minDistToEdge >= falloffRadius) {
          return 0;
        }
        const t = (minDistToEdge - fullRadius) / (falloffRadius - fullRadius);
        return clamp01(Math.pow(1 - t, 0.8));
      }

      case 'ring': {
        const dx = x - centerX;
        const dy = y - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const ringRadius = maxDist * 0.45;
        const distFromRing = Math.abs(dist - ringRadius);
        const fullRadius = maxDist * 0.01;
        const falloffRadius = maxDist * 0.25;
        if (distFromRing <= fullRadius) {
          return 1;
        }
        if (distFromRing >= falloffRadius) {
          return 0;
        }
        const t = (distFromRing - fullRadius) / (falloffRadius - fullRadius);
        return clamp01(Math.pow(1 - t, 0.8));
      }

      default:
        return 1;
    }
  }

  reset(): void {
    this.computeNutrientTargets();
    const nutrient = this.channels.nutrient;
    nutrient.set(this.nutrientTargets!);
    this.version++;
  }

  private computeNutrientTargets(): void {
    const size = this.fieldWidth * this.fieldHeight;
    if (!this.nutrientTargets || this.nutrientTargets.length !== size) {
      this.nutrientTargets = new Float32Array(size);
    }

    for (let y = 0; y < this.fieldHeight; y++) {
      const worldY = (y + 0.5) * this.cellSize;
      for (let x = 0; x < this.fieldWidth; x++) {
        const worldX = (x + 0.5) * this.cellSize;
        const idx = y * this.fieldWidth + x;
        this.nutrientTargets[idx] = this.computeNutrientTarget(worldX, worldY);
      }
    }
  }

  resize(worldWidth: number, worldHeight: number, cellSize: number = this.cellSize): void {
    const nextWorldWidth = Math.max(1, worldWidth);
    const nextWorldHeight = Math.max(1, worldHeight);
    const nextCellSize = Math.max(1, cellSize);
    const nextDimensions = computeDimensions(nextWorldWidth, nextWorldHeight, nextCellSize);

    const sameShape =
      this.worldWidth === nextWorldWidth
      && this.worldHeight === nextWorldHeight
      && this.cellSize === nextCellSize
      && this.fieldWidth === nextDimensions.fieldWidth
      && this.fieldHeight === nextDimensions.fieldHeight;
    if (sameShape) return;

    const previousChannels = this.channels;
    const previousWorldWidth = this.worldWidth;
    const previousWorldHeight = this.worldHeight;
    const previousCellSize = this.cellSize;
    const previousFieldWidth = this.fieldWidth;
    const previousFieldHeight = this.fieldHeight;
    const cropOffsetX = (previousWorldWidth - nextWorldWidth) / 2;
    const cropOffsetY = (previousWorldHeight - nextWorldHeight) / 2;
    const shouldCrop = nextWorldWidth < previousWorldWidth || nextWorldHeight < previousWorldHeight;
    const shouldReinitialize =
      nextWorldWidth > previousWorldWidth
      || nextWorldHeight > previousWorldHeight
      || nextCellSize < previousCellSize;

    this.worldWidth = nextWorldWidth;
    this.worldHeight = nextWorldHeight;
    this.cellSize = nextCellSize;
    this.fieldWidth = nextDimensions.fieldWidth;
    this.fieldHeight = nextDimensions.fieldHeight;

    this.channels = createChannelStore(this.fieldWidth * this.fieldHeight);

    if (shouldReinitialize) {
      this.reset();
      return;
    }

    for (const channelId of ENVIRONMENT_CHANNELS) {
      const previousValues = previousChannels[channelId];
      const nextValues = this.channels[channelId];
      for (let y = 0; y < this.fieldHeight; y++) {
        const sourceWorldY = shouldCrop
          ? cropOffsetY + (y + 0.5) * this.cellSize
          : (y + 0.5) / this.fieldHeight * previousWorldHeight;
        for (let x = 0; x < this.fieldWidth; x++) {
          const sourceWorldX = shouldCrop
            ? cropOffsetX + (x + 0.5) * this.cellSize
            : (x + 0.5) / this.fieldWidth * previousWorldWidth;
          const previousX = positiveModulo(Math.floor(sourceWorldX / previousCellSize), previousFieldWidth);
          const previousY = positiveModulo(Math.floor(sourceWorldY / previousCellSize), previousFieldHeight);
          const previousIndex = previousY * previousFieldWidth + previousX;
          nextValues[y * this.fieldWidth + x] = previousValues[previousIndex];
        }
      }
    }

    this.computeNutrientTargets();

    this.version++;
  }

  step(simDtSec: number, config: EnvironmentFieldStepConfig): void {
    if (simDtSec <= 0) return;
    const nutrientRegenRate = Math.max(0, config.nutrientRegenRate);
    if (nutrientRegenRate <= 0) return;

    const nutrient = this.channels.nutrient;
    const targets = this.nutrientTargets;
    const nutrientKeep = Math.exp(-nutrientRegenRate * simDtSec);

    if (targets) {
      for (let i = 0; i < nutrient.length; i++) {
        nutrient[i] = targets[i] - (targets[i] - nutrient[i]) * nutrientKeep;
      }
    } else {
      for (let i = 0; i < nutrient.length; i++) {
        nutrient[i] = 1 - (1 - nutrient[i]) * nutrientKeep;
      }
    }

    this.version++;
  }

  sample(channelId: EnvironmentChannelId, worldX: number, worldY: number): number {
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return 0;
    const values = this.channels[channelId];

    const wrappedX = positiveModulo(worldX, this.worldWidth);
    const wrappedY = positiveModulo(worldY, this.worldHeight);
    const xCell = wrappedX / this.cellSize;
    const yCell = wrappedY / this.cellSize;

    const x0 = Math.floor(xCell);
    const y0 = Math.floor(yCell);
    const x1 = x0 + 1;
    const y1 = y0 + 1;

    const sx = xCell - x0;
    const sy = yCell - y0;

    const x0Wrapped = positiveModulo(x0, this.fieldWidth);
    const y0Wrapped = positiveModulo(y0, this.fieldHeight);
    const x1Wrapped = positiveModulo(x1, this.fieldWidth);
    const y1Wrapped = positiveModulo(y1, this.fieldHeight);

    const i00 = y0Wrapped * this.fieldWidth + x0Wrapped;
    const i10 = y0Wrapped * this.fieldWidth + x1Wrapped;
    const i01 = y1Wrapped * this.fieldWidth + x0Wrapped;
    const i11 = y1Wrapped * this.fieldWidth + x1Wrapped;

    const v00 = values[i00];
    const v10 = values[i10];
    const v01 = values[i01];
    const v11 = values[i11];

    const top = v00 + (v10 - v00) * sx;
    const bottom = v01 + (v11 - v01) * sx;
    return top + (bottom - top) * sy;
  }

  sampleGradient(worldX: number, worldY: number, sampleRadius: number): { x: number; y: number } {
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY) || !Number.isFinite(sampleRadius) || sampleRadius <= 0) {
      return { x: 0, y: 0 };
    }

    const left = this.sample('nutrient', worldX - sampleRadius, worldY);
    const right = this.sample('nutrient', worldX + sampleRadius, worldY);
    const up = this.sample('nutrient', worldX, worldY - sampleRadius);
    const down = this.sample('nutrient', worldX, worldY + sampleRadius);

    const dx = right - left;
    const dy = down - up;

    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return { x: 0, y: 0 };

    return { x: dx / len, y: dy / len };
  }

  sampleFootprint(
    channelId: EnvironmentChannelId,
    worldX: number,
    worldY: number,
    radiusWorld: number,
    falloffPower: number
  ): number {
    if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return 0;
    const radiusCells = this.resolveRadiusCells(radiusWorld);
    if (radiusCells <= 0) {
      return this.sample(channelId, worldX, worldY);
    }

    const values = this.channels[channelId];
    const wrappedX = positiveModulo(worldX, this.worldWidth);
    const wrappedY = positiveModulo(worldY, this.worldHeight);
    const centerX = positiveModulo(Math.floor(wrappedX / this.cellSize), this.fieldWidth);
    const centerY = positiveModulo(Math.floor(wrappedY / this.cellSize), this.fieldHeight);
    const kernel = this.getFootprintKernel(radiusCells, falloffPower);
    const fieldWidth = this.fieldWidth;
    const fieldHeight = this.fieldHeight;
    const skipWrap =
      centerX - radiusCells >= 0
      && centerX + radiusCells < fieldWidth
      && centerY - radiusCells >= 0
      && centerY + radiusCells < fieldHeight;

    let total = 0;
    if (skipWrap) {
      for (let i = 0; i < kernel.weights.length; i++) {
        const x = centerX + kernel.dx[i];
        const y = centerY + kernel.dy[i];
        total += values[y * fieldWidth + x] * kernel.weights[i];
      }
      return total;
    }

    for (let i = 0; i < kernel.weights.length; i++) {
      const x = wrapIndexFast(centerX + kernel.dx[i], fieldWidth);
      const y = wrapIndexFast(centerY + kernel.dy[i], fieldHeight);
      total += values[y * fieldWidth + x] * kernel.weights[i];
    }

    return total;
  }

  set(channelId: EnvironmentChannelId, worldX: number, worldY: number, value: number): void {
    if (!Number.isFinite(value)) return;
    const values = this.channels[channelId];
    const wrappedX = positiveModulo(worldX, this.worldWidth);
    const wrappedY = positiveModulo(worldY, this.worldHeight);
    const xCell = positiveModulo(Math.floor(wrappedX / this.cellSize), this.fieldWidth);
    const yCell = positiveModulo(Math.floor(wrappedY / this.cellSize), this.fieldHeight);
    values[yCell * this.fieldWidth + xCell] = clamp01(value);
    this.version++;
  }

  add(channelId: EnvironmentChannelId, worldX: number, worldY: number, amount: number): void {
    if (!Number.isFinite(amount) || amount === 0) return;
    const amountToDensityScale = this.getBaselineAmountToDensityScale();
    const densityAmount = amount * amountToDensityScale;
    if (!Number.isFinite(densityAmount) || densityAmount === 0) return;

    const values = this.channels[channelId];

    const wrappedX = positiveModulo(worldX, this.worldWidth);
    const wrappedY = positiveModulo(worldY, this.worldHeight);
    const xCell = wrappedX / this.cellSize;
    const yCell = wrappedY / this.cellSize;

    const x0 = Math.floor(xCell);
    const y0 = Math.floor(yCell);
    const x1 = x0 + 1;
    const y1 = y0 + 1;

    const sx = xCell - x0;
    const sy = yCell - y0;

    const w00 = (1 - sx) * (1 - sy);
    const w10 = sx * (1 - sy);
    const w01 = (1 - sx) * sy;
    const w11 = sx * sy;

    const fieldWidth = this.fieldWidth;
    const fieldHeight = this.fieldHeight;
    const x0Wrapped = wrapIndexFast(x0, fieldWidth);
    const x1Wrapped = wrapIndexFast(x1, fieldWidth);
    const y0Wrapped = wrapIndexFast(y0, fieldHeight);
    const y1Wrapped = wrapIndexFast(y1, fieldHeight);

    const i00 = y0Wrapped * fieldWidth + x0Wrapped;
    const i10 = y0Wrapped * fieldWidth + x1Wrapped;
    const i01 = y1Wrapped * fieldWidth + x0Wrapped;
    const i11 = y1Wrapped * fieldWidth + x1Wrapped;

    values[i00] = clamp01(values[i00] + densityAmount * w00);
    values[i10] = clamp01(values[i10] + densityAmount * w10);
    values[i01] = clamp01(values[i01] + densityAmount * w01);
    values[i11] = clamp01(values[i11] + densityAmount * w11);

    this.version++;
  }

  addFootprint(
    channelId: EnvironmentChannelId,
    worldX: number,
    worldY: number,
    radiusWorld: number,
    totalAmount: number,
    falloffPower: number
  ): void {
    if (!Number.isFinite(totalAmount) || totalAmount === 0) return;
    const amountToDensityScale = this.getBaselineAmountToDensityScale();
    const densityTotalAmount = totalAmount * amountToDensityScale;
    if (!Number.isFinite(densityTotalAmount) || densityTotalAmount === 0) return;

    const radiusCells = this.resolveRadiusCells(radiusWorld);
    if (radiusCells <= 0) {
      this.add(channelId, worldX, worldY, totalAmount);
      return;
    }

    const values = this.channels[channelId];
    const wrappedX = positiveModulo(worldX, this.worldWidth);
    const wrappedY = positiveModulo(worldY, this.worldHeight);
    const centerX = positiveModulo(Math.floor(wrappedX / this.cellSize), this.fieldWidth);
    const centerY = positiveModulo(Math.floor(wrappedY / this.cellSize), this.fieldHeight);
    const kernel = this.getFootprintKernel(radiusCells, falloffPower);
    const fieldWidth = this.fieldWidth;
    const fieldHeight = this.fieldHeight;
    const skipWrap =
      centerX - radiusCells >= 0
      && centerX + radiusCells < fieldWidth
      && centerY - radiusCells >= 0
      && centerY + radiusCells < fieldHeight;

    if (skipWrap) {
      for (let i = 0; i < kernel.weights.length; i++) {
        const x = centerX + kernel.dx[i];
        const y = centerY + kernel.dy[i];
        const idx = y * fieldWidth + x;
        values[idx] = clamp01(values[idx] + densityTotalAmount * kernel.weights[i]);
      }
      this.version++;
      return;
    }

    for (let i = 0; i < kernel.weights.length; i++) {
      const x = wrapIndexFast(centerX + kernel.dx[i], fieldWidth);
      const y = wrapIndexFast(centerY + kernel.dy[i], fieldHeight);
      const idx = y * fieldWidth + x;
      values[idx] = clamp01(values[idx] + densityTotalAmount * kernel.weights[i]);
    }

    this.version++;
  }

  consumeFootprint(
    channelId: EnvironmentChannelId,
    worldX: number,
    worldY: number,
    radiusWorld: number,
    requestedAmount: number,
    falloffPower: number
  ): number {
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) return 0;
    const amountToDensityScale = this.getBaselineAmountToDensityScale();
    const requestedDensityAmount = requestedAmount * amountToDensityScale;
    if (!Number.isFinite(requestedDensityAmount) || requestedDensityAmount <= 0) return 0;

    const values = this.channels[channelId];
    const radiusCells = this.resolveRadiusCells(radiusWorld);
    const wrappedX = positiveModulo(worldX, this.worldWidth);
    const wrappedY = positiveModulo(worldY, this.worldHeight);
    const centerX = positiveModulo(Math.floor(wrappedX / this.cellSize), this.fieldWidth);
    const centerY = positiveModulo(Math.floor(wrappedY / this.cellSize), this.fieldHeight);
    const fieldWidth = this.fieldWidth;
    const fieldHeight = this.fieldHeight;

    if (radiusCells <= 0) {
      const idx = centerY * fieldWidth + centerX;
      const removedDensity = Math.min(values[idx], requestedDensityAmount);
      if (removedDensity > 0) {
        values[idx] -= removedDensity;
        this.version++;
      }
      return removedDensity / amountToDensityScale;
    }

    const kernel = this.getFootprintKernel(radiusCells, falloffPower);
    const skipWrap =
      centerX - radiusCells >= 0
      && centerX + radiusCells < fieldWidth
      && centerY - radiusCells >= 0
      && centerY + radiusCells < fieldHeight;
    let removedTotalDensity = 0;

    if (skipWrap) {
      for (let i = 0; i < kernel.weights.length; i++) {
        const x = centerX + kernel.dx[i];
        const y = centerY + kernel.dy[i];
        const idx = y * fieldWidth + x;
        const requestedCellDensity = requestedDensityAmount * kernel.weights[i];
        const removedDensity = Math.min(values[idx], requestedCellDensity);
        if (removedDensity <= 0) continue;
        values[idx] -= removedDensity;
        removedTotalDensity += removedDensity;
      }
    } else {
      for (let i = 0; i < kernel.weights.length; i++) {
        const x = wrapIndexFast(centerX + kernel.dx[i], fieldWidth);
        const y = wrapIndexFast(centerY + kernel.dy[i], fieldHeight);
        const idx = y * fieldWidth + x;
        const requestedCellDensity = requestedDensityAmount * kernel.weights[i];
        const removedDensity = Math.min(values[idx], requestedCellDensity);
        if (removedDensity <= 0) continue;
        values[idx] -= removedDensity;
        removedTotalDensity += removedDensity;
      }
    }

    if (removedTotalDensity > 0) {
      this.version++;
    }

    return removedTotalDensity / amountToDensityScale;
  }

  private resolveRadiusCells(radiusWorld: number): number {
    if (!Number.isFinite(radiusWorld) || radiusWorld <= 0) return 0;
    return Math.max(0, Math.ceil(radiusWorld / this.cellSize));
  }

  private getFootprintKernel(radiusCells: number, falloffPower: number): EnvironmentFootprintKernel {
    const safeRadius = Math.max(0, Math.floor(radiusCells));
    const safePower = Math.max(0.25, falloffPower);
    const safePowerKey = Math.round(safePower * 1000);
    const minWeightThreshold = ENVIRONMENT_FIELD_CONSTANTS.footprintWeightMinThreshold;
    const minWeightThresholdKey = Math.round(minWeightThreshold * 100);

    if (
      this.lastFootprintKernel
      && this.lastFootprintKernelRadius === safeRadius
      && this.lastFootprintKernelPowerKey === safePowerKey
      && this.lastFootprintKernelThresholdKey === minWeightThresholdKey
    ) {
      return this.lastFootprintKernel;
    }

    const combinedKey = safePowerKey * 1000 + minWeightThresholdKey;
    const kernelsByRadius = this.footprintKernelCache.get(safeRadius);
    const cached = kernelsByRadius?.get(combinedKey);
    if (cached) {
      this.lastFootprintKernelRadius = safeRadius;
      this.lastFootprintKernelPowerKey = safePowerKey;
      this.lastFootprintKernelThresholdKey = minWeightThresholdKey;
      this.lastFootprintKernel = cached;
      return cached;
    }

    if (safeRadius === 0) {
      const singleCellKernel: EnvironmentFootprintKernel = {
        dx: new Int16Array([0]),
        dy: new Int16Array([0]),
        weights: new Float32Array([1]),
      };
      return this.storeFootprintKernel(safeRadius, safePowerKey, minWeightThresholdKey, singleCellKernel);
    }

    const radiusSq = safeRadius * safeRadius;
    const thresholdRadiusFactorSq = 1 - Math.pow(minWeightThreshold, 1 / safePower);
    const effectiveRadiusSq = radiusSq * Math.max(0, Math.min(1, thresholdRadiusFactorSq));
    const effectiveRadius = Math.max(0, Math.ceil(Math.sqrt(effectiveRadiusSq)));
    const dx: number[] = [];
    const dy: number[] = [];
    const weights: number[] = [];
    let totalWeight = 0;

    for (let y = -effectiveRadius; y <= effectiveRadius; y++) {
      for (let x = -effectiveRadius; x <= effectiveRadius; x++) {
        const distSq = x * x + y * y;
        if (distSq > effectiveRadiusSq) continue;
        const t2 = distSq / radiusSq;
        const weight = Math.pow(Math.max(0, 1 - t2), safePower);
        if (weight < minWeightThreshold) continue;
        dx.push(x);
        dy.push(y);
        weights.push(weight);
        totalWeight += weight;
      }
    }

    if (totalWeight <= 0 || weights.length === 0) {
      const fallbackKernel: EnvironmentFootprintKernel = {
        dx: new Int16Array([0]),
        dy: new Int16Array([0]),
        weights: new Float32Array([1]),
      };
      return this.storeFootprintKernel(safeRadius, safePowerKey, minWeightThresholdKey, fallbackKernel);
    }

    const normalized = new Float32Array(weights.length);
    for (let i = 0; i < weights.length; i++) {
      normalized[i] = weights[i] / totalWeight;
    }

    const kernel: EnvironmentFootprintKernel = {
      dx: Int16Array.from(dx),
      dy: Int16Array.from(dy),
      weights: normalized,
    };

    return this.storeFootprintKernel(safeRadius, safePowerKey, minWeightThresholdKey, kernel);
  }
}
