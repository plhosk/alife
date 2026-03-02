import { SegmentType, SEGMENT_TYPES } from './types';

class SegmentTypeState {
  private enabledTypes: Set<SegmentType> = new Set(SEGMENT_TYPES);
  private listeners: Set<() => void> = new Set();

  isEnabled(type: SegmentType): boolean {
    return this.enabledTypes.has(type);
  }

  toggle(type: SegmentType): void {
    if (this.enabledTypes.has(type)) {
      if (this.enabledTypes.size > 1) {
        this.enabledTypes.delete(type);
      }
    } else {
      this.enabledTypes.add(type);
    }
    this.notifyListeners();
  }

  getEnabledTypes(): SegmentType[] {
    return Array.from(this.enabledTypes);
  }

  setEnabledTypes(types: SegmentType[]): void {
    this.enabledTypes = new Set(types.length > 0 ? types : SEGMENT_TYPES);
    this.notifyListeners();
  }

  addListener(listener: () => void): void {
    this.listeners.add(listener);
  }

  removeListener(listener: () => void): void {
    this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const segmentTypeState = new SegmentTypeState();
