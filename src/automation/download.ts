export function buildExportBaseName(presetName: string | null | undefined, startTimeMs: number): string {
  const timestamp = Math.floor(startTimeMs / 1000);
  const preset = presetName?.toLowerCase().replace(/\s+/g, '-') ?? 'export';
  return `alife-${preset}-${timestamp}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
