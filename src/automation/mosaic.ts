import { ScreenshotData, MosaicConfig, DEFAULT_MOSAIC_CONFIG } from './types';
import JSZip from 'jszip';

const MAX_DIMENSION = 16384;

export type ProgressCallback = (current: number, total: number) => void;

interface RowInfo {
  experimentId: string;
  screenshots: ScreenshotData[];
  labelHeight: number;
  rowHeight: number;
  width: number;
}

export class MosaicGenerator {
  private screenshots: ScreenshotData[] = [];
  private config: MosaicConfig;
  private targetWidth = 0;
  private targetHeight = 0;

  constructor(config: Partial<MosaicConfig> = {}) {
    this.config = { ...DEFAULT_MOSAIC_CONFIG, ...config };
  }

  addScreenshot(data: ScreenshotData): void {
    this.screenshots.push(data);
  }

  async generate(presetName: string, startTimeMs: number, onProgress?: ProgressCallback): Promise<void> {
    const byExperiment = this.groupByExperiment(this.screenshots);
    await this.generateFromScreenshots(byExperiment, presetName, startTimeMs, 'mosaic-all', onProgress);
  }

  async generateFinal(presetName: string, startTimeMs: number, onProgress?: ProgressCallback): Promise<void> {
    const finalScreenshots = this.screenshots.filter(s => s.isFinal);
    const byExperiment = this.groupByExperiment(finalScreenshots);
    await this.generateFromScreenshots(byExperiment, presetName, startTimeMs, 'mosaic-final', onProgress);
  }

  async getMosaicBlobs(presetName: string, onProgress?: ProgressCallback): Promise<{ filename: string; blob: Blob }[]> {
    const byExperiment = this.groupByExperiment(this.screenshots);
    return this.generateMosaicBlobs(byExperiment, presetName, 'mosaic-all', onProgress);
  }

  async getFinalMosaicBlobs(presetName: string, onProgress?: ProgressCallback): Promise<{ filename: string; blob: Blob }[]> {
    const finalScreenshots = this.screenshots.filter(s => s.isFinal);
    const byExperiment = this.groupByExperiment(finalScreenshots);
    return this.generateMosaicBlobs(byExperiment, presetName, 'mosaic-final', onProgress);
  }

  private async generateMosaicBlobs(
    experiments: Map<string, ScreenshotData[]>,
    presetName: string,
    filename: string,
    onProgress?: ProgressCallback
  ): Promise<{ filename: string; blob: Blob }[]> {
    if (experiments.size === 0) return [];

    const { rowInfos, targetWidth, targetHeight } = this.computeLayout(experiments);
    if (rowInfos.length === 0) return [];

    this.targetWidth = targetWidth;
    this.targetHeight = targetHeight;

    const chunks = this.chunkRowsByHeight(rowInfos);
    const results: { filename: string; blob: Blob }[] = [];

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunkRows = chunks[chunkIndex];
      const blob = await this.generateMosaicPage(chunkRows, presetName);
      
      if (blob) {
        const pageFilename = chunks.length > 1
          ? `${filename}-${chunkIndex + 1}.webp`
          : `${filename}.webp`;
        results.push({ filename: pageFilename, blob });
      }
      if (onProgress) {
        onProgress(chunkIndex + 1, chunks.length);
      }
    }

    return results;
  }

  private groupByExperiment(screenshots: ScreenshotData[]): Map<string, ScreenshotData[]> {
    const groups = new Map<string, ScreenshotData[]>();
    for (const s of screenshots) {
      const existing = groups.get(s.experimentId) || [];
      existing.push(s);
      groups.set(s.experimentId, existing);
    }
    return groups;
  }

  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  private computeLayout(
    experiments: Map<string, ScreenshotData[]>
  ): { rowInfos: RowInfo[]; targetWidth: number; targetHeight: number } {
    const rowInfos: RowInfo[] = [];
    const padding = this.config.padding;
    const fontSize = this.config.fontSize;
    const labelHeight = fontSize + padding;

    let minWidth = Infinity;
    let minHeight = Infinity;
    const allScreenshots: ScreenshotData[] = [];

    for (const screenshots of experiments.values()) {
      for (const s of screenshots) {
        minWidth = Math.min(minWidth, s.width);
        minHeight = Math.min(minHeight, s.height);
        allScreenshots.push(s);
      }
    }

    if (allScreenshots.length === 0) {
      return { rowInfos: [], targetWidth: 0, targetHeight: 0 };
    }

    for (const [experimentId, screenshots] of experiments) {
      const imageCount = screenshots.length;
      const totalWidth = labelHeight + imageCount * (minWidth + labelHeight);
      
      rowInfos.push({
        experimentId,
        screenshots,
        labelHeight,
        rowHeight: labelHeight + minHeight + padding,
        width: totalWidth
      });
    }

    return { rowInfos, targetWidth: minWidth, targetHeight: minHeight };
  }

  private chunkRowsByHeight(rowInfos: RowInfo[]): RowInfo[][] {
    const chunks: RowInfo[][] = [];
    let currentChunk: RowInfo[] = [];
    let currentHeight = this.config.headerHeight;

    for (const row of rowInfos) {
      const headerHeight = this.config.headerHeight;
      const potentialHeight = currentChunk.length === 0 
        ? headerHeight + row.rowHeight 
        : currentHeight + row.rowHeight;

      if (potentialHeight > MAX_DIMENSION && currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [row];
        currentHeight = headerHeight + row.rowHeight;
      } else {
        currentChunk.push(row);
        currentHeight = potentialHeight;
      }
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  private trimRowWidth(row: RowInfo): RowInfo {
    const labelHeight = row.labelHeight;
    const imageWidth = this.targetWidth;
    const maxImages = Math.floor((MAX_DIMENSION - labelHeight) / (imageWidth + labelHeight));
    
    if (row.screenshots.length <= maxImages) return row;

    const sortedScreenshots = [...row.screenshots].sort((a, b) => b.timeSec - a.timeSec);
    const keptScreenshots = sortedScreenshots.slice(0, maxImages);
    keptScreenshots.sort((a, b) => a.timeSec - b.timeSec);
    
    return {
      ...row,
      screenshots: keptScreenshots,
      width: labelHeight + keptScreenshots.length * (imageWidth + labelHeight)
    };
  }

  private async generateFromScreenshots(
    experiments: Map<string, ScreenshotData[]>,
    presetName: string,
    startTimeMs: number,
    filename: string,
    onProgress?: ProgressCallback
  ): Promise<void> {
    if (experiments.size === 0) return;

    const zip = new JSZip();

    const { rowInfos, targetWidth, targetHeight } = this.computeLayout(experiments);
    if (rowInfos.length === 0) return;

    this.targetWidth = targetWidth;
    this.targetHeight = targetHeight;

    const chunks = this.chunkRowsByHeight(rowInfos);

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunkRows = chunks[chunkIndex];
      const blob = await this.generateMosaicPage(chunkRows, presetName);
      
      if (blob) {
        const pageFilename = chunks.length > 1
          ? `${filename}-${chunkIndex + 1}.webp`
          : `${filename}.webp`;
        zip.file(pageFilename, blob);
      }
      if (onProgress) {
        onProgress(chunkIndex + 1, chunks.length);
      }
    }

    const timestamp = Math.floor(startTimeMs / 1000);
    const preset = presetName.toLowerCase().replace(/\s+/g, '-');
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `alife-${preset}-${timestamp}-${filename}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private async generateMosaicPage(
    rows: RowInfo[],
    presetName: string
  ): Promise<Blob | null> {
    const trimmedRows = rows.map(r => this.trimRowWidth(r));
    
    const totalWidth = Math.max(...trimmedRows.map(r => r.width));
    const totalHeight = this.config.headerHeight + 
      trimmedRows.reduce((sum, r) => sum + r.rowHeight, 0);

    const canvas = document.createElement('canvas');
    canvas.width = totalWidth;
    canvas.height = totalHeight;
    const ctx = canvas.getContext('2d');

    if (!ctx) return null;

    ctx.fillStyle = this.config.backgroundColor;
    ctx.fillRect(0, 0, totalWidth, totalHeight);

    const totalScreenshots = trimmedRows.reduce((sum, r) => sum + r.screenshots.length, 0);
    this.renderHeader(ctx, canvas, presetName, totalScreenshots);

    let y = this.config.headerHeight;

    for (const row of trimmedRows) {
      await this.renderRow(ctx, row, y);
      y += row.rowHeight;
    }

    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/webp', 0.9);
    });
  }

  private renderHeader(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, presetName: string, count: number): void {
    const fontSize = this.config.fontSize + 4;
    ctx.fillStyle = this.config.labelColor;
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(
      `${presetName} - ${count} screenshots - ${new Date().toISOString().slice(0, 10)}`,
      canvas.width / 2,
      fontSize + this.config.padding
    );
  }

  private async renderRow(ctx: CanvasRenderingContext2D, row: RowInfo, startY: number): Promise<void> {
    const labelHeight = row.labelHeight;
    const fontSize = this.config.fontSize;
    
    ctx.fillStyle = this.config.labelColor;
    ctx.font = `${fontSize}px monospace`;
    ctx.textAlign = 'left';

    const imgY = startY + labelHeight;
    let x = labelHeight;

    for (const screenshot of row.screenshots) {
      const label = `${screenshot.experimentId} t=${Math.round(screenshot.timeSec)}s pop=${screenshot.population}`;
      ctx.fillText(label, x, startY + fontSize);
      
      try {
        const img = await this.loadImage(screenshot.imageData);
        ctx.drawImage(img, x, imgY, this.targetWidth, this.targetHeight);
      } catch {
        ctx.fillStyle = '#333';
        ctx.fillRect(x, imgY, this.targetWidth, this.targetHeight);
        ctx.fillStyle = this.config.labelColor;
      }
      
      x += this.targetWidth + labelHeight;
    }
  }

  clear(): void {
    this.screenshots = [];
  }

  getCount(): number {
    return this.screenshots.length;
  }

  getFinalCount(): number {
    return this.screenshots.filter(s => s.isFinal).length;
  }

  hasScreenshots(): boolean {
    return this.screenshots.length > 0;
  }

  hasFinalScreenshots(): boolean {
    return this.screenshots.some(s => s.isFinal);
  }
}
