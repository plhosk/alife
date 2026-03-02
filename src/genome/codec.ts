import {
  GENOME_LIMITS_CONSTANTS,
  LimbGroupDef,
  LocomotorDirection,
  NEURAL_BEHAVIORS,
  NeuralBehavior,
  PHASE_MODES,
  PhaseMode,
  SEGMENT_TYPES,
  SegmentDef,
  SegmentType,
  SYMMETRY_MODES,
  SymmetryMode,
} from '../types';

export interface GenomeMetadata {
  symmetry: number;
  mode: SymmetryMode;
  angles: number[];
  phaseMode: PhaseMode;
  phaseSpread: number;
  neuralPulseIntervalMs: number;
}

export function generateSymmetryAngles(symmetry: number): number[] {
  const angles: number[] = [];
  for (let i = 0; i < symmetry; i++) {
    angles.push((360 / symmetry) * i);
  }
  return angles;
}

export function parseMetadata(code: string): GenomeMetadata {
  const match = code.match(/^\[([^\]]+)\]/);
  if (!match) {
    return { symmetry: 1, mode: 'radial', angles: [0], phaseMode: 'rand', phaseSpread: 0.5, neuralPulseIntervalMs: GENOME_LIMITS_CONSTANTS.defaultNeuralPulseIntervalMs };
  }

  const content = match[1];
  const parts = content.split(',');

  let symmetry = 1;
  let mode: SymmetryMode = 'radial';
  let angles: number[] | null = null;
  let phaseMode: PhaseMode = 'rand';
  let phaseSpread = 0.5;
  let neuralPulseIntervalMs: number = GENOME_LIMITS_CONSTANTS.defaultNeuralPulseIntervalMs;

  for (const part of parts) {
    const [key, value] = part.split(':');
    if (key === 'sym') {
      symmetry = Math.max(1, Math.min(GENOME_LIMITS_CONSTANTS.maxTotalLimbs, parseInt(value) || 1));
    } else if (key === 'mode') {
      mode = SYMMETRY_MODES.includes(value as SymmetryMode) ? value as SymmetryMode : 'radial';
    } else if (key === 'angles') {
      angles = value.split('|').map(a => parseFloat(a)).filter(a => !isNaN(a));
    } else if (key === 'phase') {
      phaseMode = PHASE_MODES.includes(value as PhaseMode) ? value as PhaseMode : 'rand';
    } else if (key === 'spread') {
      phaseSpread = Math.max(0, Math.min(1, parseFloat(value) || 0.5));
    } else if (key === 'neural') {
      neuralPulseIntervalMs = Math.max(GENOME_LIMITS_CONSTANTS.minPulseIntervalMs, Math.min(GENOME_LIMITS_CONSTANTS.maxPulseIntervalMs, parseFloat(value) || GENOME_LIMITS_CONSTANTS.defaultNeuralPulseIntervalMs));
    }
  }

  if (!angles || angles.length === 0) {
    angles = generateSymmetryAngles(symmetry);
  }

  return { symmetry, mode, angles, phaseMode, phaseSpread, neuralPulseIntervalMs };
}

export function parse(code: string): SegmentDef[] {
  const segments: SegmentDef[] = [];
  let segmentCode = code;
  const headerMatch = code.match(/^\[[^\]]+\]/);
  if (headerMatch) {
    segmentCode = code.slice(headerMatch[0].length);
  }

  const parts = segmentCode.split(';').filter(p => p.trim());

  for (const part of parts) {
    const tokens = part.trim().split(/\s+/);
    if (tokens.length < 5 || tokens.length > 7) continue;

    const length = parseFloat(tokens[0]);
    const angle = parseFloat(tokens[1]);
    const type = tokens[2] as SegmentType;
    const parentIndex = parseInt(tokens[3]);
    const pulseIntervalMs = parseFloat(tokens[4]);

    if (isNaN(length) || isNaN(angle) || !SEGMENT_TYPES.includes(type) || isNaN(parentIndex) || isNaN(pulseIntervalMs)) continue;
    if (length <= 0 || length > GENOME_LIMITS_CONSTANTS.maxSegmentLength) continue;
    if (pulseIntervalMs < GENOME_LIMITS_CONSTANTS.minPulseIntervalMs || pulseIntervalMs > GENOME_LIMITS_CONSTANTS.maxPulseIntervalMs) continue;
    if (parentIndex >= segments.length) continue;

    let locomotorDirection: LocomotorDirection = 1;
    let neuralBehavior: NeuralBehavior = 'approach';
    
    if (type === SegmentType.Locomotor || type === SegmentType.Neural) {
      const directionToken = tokens[5];
      if (directionToken !== undefined) {
        const direction = parseInt(directionToken);
        if (direction !== -1 && direction !== 1) continue;
        locomotorDirection = direction;
      }
      
      if (type === SegmentType.Neural && tokens[6] !== undefined) {
        const behavior = tokens[6] as NeuralBehavior;
        if (NEURAL_BEHAVIORS.includes(behavior)) {
          neuralBehavior = behavior;
        }
      }
    }

    segments.push({ length, angle, type, parentIndex, pulseIntervalMs, locomotorDirection, neuralBehavior });
  }

  return segments;
}

export function encode(segments: SegmentDef[], metadata?: GenomeMetadata): string {
  const meta = metadata || { symmetry: 1, mode: 'radial' as SymmetryMode, angles: [0], phaseMode: 'rand' as PhaseMode, phaseSpread: 0.5, neuralPulseIntervalMs: GENOME_LIMITS_CONSTANTS.defaultNeuralPulseIntervalMs };
  const angleStr = meta.angles.map(a => a.toFixed(1)).join('|');
  const header = `[sym:${meta.symmetry},mode:${meta.mode},angles:${angleStr},phase:${meta.phaseMode},spread:${meta.phaseSpread.toFixed(2)},neural:${meta.neuralPulseIntervalMs.toFixed(0)}]`;
  const segmentStr = segments.map(s => {
    if (s.type === SegmentType.Neural) {
      return `${s.length.toFixed(1)} ${s.angle.toFixed(1)} ${s.type} ${s.parentIndex} ${s.pulseIntervalMs.toFixed(1)} ${s.locomotorDirection} ${s.neuralBehavior}`;
    } else if (s.type === SegmentType.Locomotor) {
      return `${s.length.toFixed(1)} ${s.angle.toFixed(1)} ${s.type} ${s.parentIndex} ${s.pulseIntervalMs.toFixed(1)} ${s.locomotorDirection}`;
    }
    return `${s.length.toFixed(1)} ${s.angle.toFixed(1)} ${s.type} ${s.parentIndex} ${s.pulseIntervalMs.toFixed(1)}`;
  }).join(';');
  return header + segmentStr;
}

export function parseGroup(groupCode: string): LimbGroupDef | null {
  const metadata = parseMetadata(groupCode);
  const segments = parse(groupCode);
  if (segments.length === 0) return null;
  return {
    segments,
    symmetry: metadata.symmetry,
    mode: metadata.mode,
    angles: metadata.angles,
    phaseMode: metadata.phaseMode,
    phaseSpread: metadata.phaseSpread,
    neuralPulseIntervalMs: metadata.neuralPulseIntervalMs
  };
}

export function parseGroups(code: string): LimbGroupDef[] {
  const groups: LimbGroupDef[] = [];
  const groupCodes = code.split('~');

  for (const groupCode of groupCodes) {
    const group = parseGroup(groupCode.trim());
    if (group) groups.push(group);
  }

  return groups;
}

export function encodeGroups(groups: LimbGroupDef[]): string {
  return groups.map(g => encode(g.segments, {
    symmetry: g.symmetry,
    mode: g.mode,
    angles: g.angles,
    phaseMode: g.phaseMode,
    phaseSpread: g.phaseSpread,
    neuralPulseIntervalMs: g.neuralPulseIntervalMs
  })).join('~');
}
