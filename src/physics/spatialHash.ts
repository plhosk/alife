import { Entity, Vec2 } from '../types';

export class SpatialHash {
  private cellSize: number;
  private cells: Map<number, Set<Entity>>;
  private worldWidth: number;
  private worldHeight: number;
  private nearbySet: Set<Entity> = new Set();
  private radiusSeenIds: Set<number> = new Set();

  constructor(cellSize: number = 100, worldWidth: number = 1000, worldHeight: number = 1000) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
  }

  private cellKey(cx: number, cy: number): number {
    return (cx << 16) | (cy & 0xFFFF);
  }

  clear(): void {
    this.cells.clear();
  }

  private insertSegmentInCells(entity: Entity, minX: number, maxX: number, minY: number, maxY: number): void {
    const startCX = Math.floor(minX / this.cellSize);
    const endCX = Math.floor(maxX / this.cellSize);
    const startCY = Math.floor(minY / this.cellSize);
    const endCY = Math.floor(maxY / this.cellSize);

    for (let cx = startCX; cx <= endCX; cx++) {
      for (let cy = startCY; cy <= endCY; cy++) {
        const key = this.cellKey(cx, cy);
        let cell = this.cells.get(key);
        if (!cell) {
          cell = new Set();
          this.cells.set(key, cell);
        }
        cell.add(entity);
      }
    }
  }

  insert(entity: Entity): void {
    const min = entity.aabbMin;
    const max = entity.aabbMax;
    this.insertSegmentInCells(entity, min.x, max.x, min.y, max.y);

    if (min.x < 0) {
      this.insertSegmentInCells(entity, min.x + this.worldWidth, max.x + this.worldWidth, min.y, max.y);
    }
    if (max.x > this.worldWidth) {
      this.insertSegmentInCells(entity, min.x - this.worldWidth, max.x - this.worldWidth, min.y, max.y);
    }
    if (min.y < 0) {
      this.insertSegmentInCells(entity, min.x, max.x, min.y + this.worldHeight, max.y + this.worldHeight);
    }
    if (max.y > this.worldHeight) {
      this.insertSegmentInCells(entity, min.x, max.x, min.y - this.worldHeight, max.y - this.worldHeight);
    }
  }

  private queryCells(minX: number, maxX: number, minY: number, maxY: number, excludeId: number): void {
    const startCX = Math.floor(minX / this.cellSize) - 1;
    const endCX = Math.floor(maxX / this.cellSize) + 1;
    const startCY = Math.floor(minY / this.cellSize) - 1;
    const endCY = Math.floor(maxY / this.cellSize) + 1;

    for (let cx = startCX; cx <= endCX; cx++) {
      for (let cy = startCY; cy <= endCY; cy++) {
        const key = this.cellKey(cx, cy);
        const cell = this.cells.get(key);
        if (cell) {
          for (const e of cell) {
            if (e.id !== excludeId) {
              this.nearbySet.add(e);
            }
          }
        }
      }
    }
  }

  getNearby(entity: Entity): Set<Entity> {
    this.nearbySet.clear();
    const min = entity.aabbMin;
    const max = entity.aabbMax;

    this.queryCells(min.x, max.x, min.y, max.y, entity.id);

    if (min.x < this.cellSize) {
      this.queryCells(min.x + this.worldWidth, max.x + this.worldWidth, min.y, max.y, entity.id);
    }
    if (max.x > this.worldWidth - this.cellSize) {
      this.queryCells(min.x - this.worldWidth, max.x - this.worldWidth, min.y, max.y, entity.id);
    }
    if (min.y < this.cellSize) {
      this.queryCells(min.x, max.x, min.y + this.worldHeight, max.y + this.worldHeight, entity.id);
    }
    if (max.y > this.worldHeight - this.cellSize) {
      this.queryCells(min.x, max.x, min.y - this.worldHeight, max.y - this.worldHeight, entity.id);
    }

    return this.nearbySet;
  }

  forEachPair(seen: Set<number>, visitor: (a: Entity, b: Entity) => void): void {
    for (const cell of this.cells.values()) {
      for (const a of cell) {
        for (const b of cell) {
          if (a.id >= b.id) continue;
          const key = (a.id << 16) | b.id;
          if (seen.has(key)) continue;
          seen.add(key);
          visitor(a, b);
        }
      }
    }
  }

  countEntitiesInRadius(position: Vec2, radius: number, maxCount: number = Number.POSITIVE_INFINITY): number {
    const limit = Number.isFinite(maxCount)
      ? Math.max(0, Math.floor(maxCount))
      : Number.POSITIVE_INFINITY;
    if (limit === 0) return 0;

    let count = 0;
    const seen = this.radiusSeenIds;
    seen.clear();
    const radiusSq = radius * radius;

    const startCX = Math.floor((position.x - radius) / this.cellSize);
    const endCX = Math.floor((position.x + radius) / this.cellSize);
    const startCY = Math.floor((position.y - radius) / this.cellSize);
    const endCY = Math.floor((position.y + radius) / this.cellSize);

    for (let cx = startCX; cx <= endCX; cx++) {
      for (let cy = startCY; cy <= endCY; cy++) {
        const key = this.cellKey(cx, cy);
        const cell = this.cells.get(key);
        if (!cell) continue;

        for (const entity of cell) {
          if (seen.has(entity.id)) continue;
          seen.add(entity.id);

          const dx = position.x - entity.position.x;
          const dy = position.y - entity.position.y;
          if (dx * dx + dy * dy > radiusSq) continue;

          count++;
          if (count >= limit) {
            return count;
          }
        }
      }
    }

    return count;
  }

  getEntitiesInRadius(position: Vec2, radius: number): Entity[] {
    const result: Entity[] = [];
    const seen = new Set<number>();
    const radiusSq = radius * radius;

    const startCX = Math.floor((position.x - radius) / this.cellSize);
    const endCX = Math.floor((position.x + radius) / this.cellSize);
    const startCY = Math.floor((position.y - radius) / this.cellSize);
    const endCY = Math.floor((position.y + radius) / this.cellSize);

    for (let cx = startCX; cx <= endCX; cx++) {
      for (let cy = startCY; cy <= endCY; cy++) {
        const key = this.cellKey(cx, cy);
        const cell = this.cells.get(key);
        if (cell) {
          for (const entity of cell) {
            if (!seen.has(entity.id)) {
              seen.add(entity.id);
              const dx = position.x - entity.position.x;
              const dy = position.y - entity.position.y;
              if (dx * dx + dy * dy <= radiusSq) {
                result.push(entity);
              }
            }
          }
        }
      }
    }

    return result;
  }
}
