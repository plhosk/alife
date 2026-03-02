import { Config, LimbGroupDef, SegmentDef, SegmentType } from './types';
import { encode, encodeGroups, GenomeMetadata, parse, parseGroup, parseGroups, parseMetadata } from './genome/codec';
import { getTotalLimbs } from './genome/limits';
import { mutate, mutateGroups } from './genome/mutate';
import { random, randomBiased, randomWeighted } from './genome/random';

export type { GenomeMetadata };

export class Genome {
  static parseMetadata(code: string): GenomeMetadata {
    return parseMetadata(code);
  }

  static parse(code: string): SegmentDef[] {
    return parse(code);
  }

  static encode(segments: SegmentDef[], metadata?: GenomeMetadata): string {
    return encode(segments, metadata);
  }

  static parseGroup(groupCode: string): LimbGroupDef | null {
    return parseGroup(groupCode);
  }

  static parseGroups(code: string): LimbGroupDef[] {
    return parseGroups(code);
  }

  static encodeGroups(groups: LimbGroupDef[]): string {
    return encodeGroups(groups);
  }

  static getTotalLimbCount(groups: LimbGroupDef[]): number {
    return getTotalLimbs(groups);
  }

  static mutateGroups(groups: LimbGroupDef[], config: Config, randomFn?: () => number): LimbGroupDef[] {
    return mutateGroups(groups, config, randomFn);
  }

  static mutate(code: string, config: Config, randomFn?: () => number): string {
    return mutate(code, config, randomFn);
  }

  static random(randomFn?: () => number): string {
    return random(randomFn);
  }

  static randomBiased(preferredTypes: SegmentType[], randomFn?: () => number): string {
    return randomBiased(preferredTypes, randomFn);
  }

  static randomWeighted(
    weights: Map<SegmentType, number>,
    limits?: { genomeBaseSegmentBudget: number; genomeSymmetrySegmentBonus: number },
    randomFn?: () => number,
    guaranteedType?: SegmentType,
    guaranteedRatio?: number
  ): string {
    return randomWeighted(weights, limits, randomFn, guaranteedType, guaranteedRatio);
  }
}
