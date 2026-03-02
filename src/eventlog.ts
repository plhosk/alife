const DEBUG_LOG_MESSAGES = false;

export interface LogEntry {
  timeMs: number;
  type: 'birth' | 'death' | 'kill' | 'system';
  message: string;
  entityId?: number;
}

class EventLogImpl {
  private entries: LogEntry[] = [];
  private maxEntries: number = 100;
  private startTimeMs: number = Date.now();

  log(type: LogEntry['type'], message: string, entityId?: number): void {
    const entry: LogEntry = {
      timeMs: Date.now() - this.startTimeMs,
      type,
      message,
      entityId
    };

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    if (DEBUG_LOG_MESSAGES) {
      const timeStr = this.formatTime(entry.timeMs);
      console.log(`[${timeStr}] ${type.toUpperCase()}: ${message}`);
    }
  }

  getEntries(): LogEntry[] {
    return this.entries;
  }

  formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }
}

export const EventLog = new EventLogImpl();
