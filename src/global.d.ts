declare module 'lobos' {
  export interface SobolOptions {
    params?: string;
    resolution?: number;
  }

  export class Sobol {
    constructor(dims: number, options?: SobolOptions);
    take(count: number): number[][];
    next(): number[] | null;
    skip(count: number): void;
  }
}

declare module '*.svg?raw' {
  const content: string;
  export default content;
}
