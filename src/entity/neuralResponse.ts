import {
  Config,
  Entity,
  LOCOMOTION_CONSTANTS,
  NEURAL_CONSTANTS,
  Segment,
  SegmentType,
  Vec2,
} from '../types';
import { NeuralState } from './neuralSense';

export interface LocomotorImpulse {
  segmentIndex: number;
  impulse: Vec2;
  torque: number;
  foodCost: number;
  pulseDirection: number;
}

interface LocomotorCandidate {
  segmentIndex: number;
  linearUnitX: number;
  linearUnitY: number;
  angularUnit: number;
  baseImpulseEnergy: number;
  reverseLimit: number;
  preferredDirection: number;
}

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

function length(v: Vec2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

function normalize(v: Vec2): Vec2 {
  const len = length(v);
  if (len === 0) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function solveActivations(
  candidates: LocomotorCandidate[],
  desiredLinear: Vec2,
  desiredAngular: number,
  linearWeight: number,
  angularWeight: number,
  iterations: number
): number[] {
  const activations = new Array<number>(candidates.length).fill(0);
  let totalX = 0;
  let totalY = 0;
  let totalAngular = 0;

  const passCount = Math.max(1, Math.floor(iterations));
  for (let pass = 0; pass < passCount; pass++) {
    let maxDelta = 0;

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const current = activations[i];

      const baseX = totalX - current * candidate.linearUnitX;
      const baseY = totalY - current * candidate.linearUnitY;
      const baseAngular = totalAngular - current * candidate.angularUnit;

      const denom = linearWeight
        * (candidate.linearUnitX * candidate.linearUnitX + candidate.linearUnitY * candidate.linearUnitY)
        + angularWeight * candidate.angularUnit * candidate.angularUnit;

      let next = 0;
      if (denom > 0) {
        const numer = linearWeight
          * (candidate.linearUnitX * (desiredLinear.x - baseX) + candidate.linearUnitY * (desiredLinear.y - baseY))
          + angularWeight * candidate.angularUnit * (desiredAngular - baseAngular);
        next = numer / denom;
      }

      next = clamp(next, -candidate.reverseLimit, 1);
      activations[i] = next;

      totalX = baseX + next * candidate.linearUnitX;
      totalY = baseY + next * candidate.linearUnitY;
      totalAngular = baseAngular + next * candidate.angularUnit;

      const delta = Math.abs(next - current);
      if (delta > maxDelta) maxDelta = delta;
    }

    if (maxDelta < 0.0001) break;
  }

  return activations;
}

export function computeWeightedBurst(
  entity: Entity,
  neuralState: NeuralState,
  currentTimeMs: number,
  config: Config
): LocomotorImpulse[] {
  const impulses: LocomotorImpulse[] = [];
  const inverseMass = entity.mass > 0 ? 1 / entity.mass : 0;
  const inverseInertia = entity.inertia > 0 ? 1 / entity.inertia : 0;

  const directionalTarget = neuralState.behavior === 'flee'
    ? { x: -neuralState.combinedDirection.x, y: -neuralState.combinedDirection.y }
    : neuralState.combinedDirection;
  const targetHeading = normalize(directionalTarget);
  const hasTargetHeading = length(targetHeading) > 0;

  const speed = length(entity.velocity);
  const hasSpeed = speed > NEURAL_CONSTANTS.coordinationZeroSpeedThreshold;
  const velocityHeading = hasSpeed ? normalize(entity.velocity) : { x: 0, y: 0 };

  let desiredHeading = { x: 0, y: 0 };
  let turnMix = 0;
  let desiredAngularSign = 0;
  let desiredAngularScale = 0;

  if (hasTargetHeading && hasSpeed) {
    const headingDot = clamp(dot(velocityHeading, targetHeading), -1, 1);
    const headingCross = cross(velocityHeading, targetHeading);
    const signedAngle = Math.atan2(headingCross, headingDot);
    const turnMagnitude = Math.abs(signedAngle) / Math.PI;

    turnMix = Math.pow(turnMagnitude, NEURAL_CONSTANTS.coordinationTurnBlendExponent);
    desiredHeading = normalize({
      x: velocityHeading.x * (1 - turnMix) + targetHeading.x * turnMix,
      y: velocityHeading.y * (1 - turnMix) + targetHeading.y * turnMix,
    });
    if (length(desiredHeading) === 0) {
      desiredHeading = targetHeading;
    }

    desiredAngularSign = signedAngle === 0 ? (headingCross >= 0 ? 1 : -1) : Math.sign(signedAngle);
    desiredAngularScale = turnMagnitude * NEURAL_CONSTANTS.coordinationTurnDemandScale;
  } else if (hasTargetHeading) {
    desiredHeading = targetHeading;
  } else if (hasSpeed) {
    desiredHeading = velocityHeading;
  }

  if (length(desiredHeading) === 0) {
    return impulses;
  }

  const reverseLimit = clamp(NEURAL_CONSTANTS.reverseDirectionEfficiency, 0, 1);
  const candidates: LocomotorCandidate[] = [];
  let maxLinearCapacity = 0;
  let maxAngularCapacity = 0;

  for (let i = 0; i < entity.segments.length; i++) {
    const seg = entity.segments[i];
    if (seg.type !== SegmentType.Locomotor) continue;

    const dx = seg.worldEnd.x - seg.worldStart.x;
    const dy = seg.worldEnd.y - seg.worldStart.y;
    const segLen = Math.sqrt(dx * dx + dy * dy);
    if (segLen === 0) continue;

    const thrustDir: Vec2 = { x: dx / segLen, y: dy / segLen };
    const pulseIntervalMs = Math.max(1, seg.pulseIntervalMs);
    const timeSinceLastPulse = currentTimeMs - seg.lastPulseTimeMs;
    const readiness = clamp(timeSinceLastPulse / pulseIntervalMs, 0, 1);
    if (readiness <= 0) continue;

    const baseImpulseEnergy = seg.length * config.locomotorImpulsePerLength * readiness;
    if (baseImpulseEnergy <= 0) continue;

    const linearImpulseUnit = baseImpulseEnergy * inverseMass;
    const impulseXUnit = thrustDir.x * linearImpulseUnit;
    const impulseYUnit = thrustDir.y * linearImpulseUnit;

    const midX = (seg.worldStart.x + seg.worldEnd.x) / 2;
    const midY = (seg.worldStart.y + seg.worldEnd.y) / 2;
    const armX = midX - entity.com.x;
    const armY = midY - entity.com.y;
    const angularImpulseUnit = (armX * thrustDir.y - armY * thrustDir.x)
      * baseImpulseEnergy
      * LOCOMOTION_CONSTANTS.torqueMultiplier
      * inverseInertia;

    candidates.push({
      segmentIndex: i,
      linearUnitX: impulseXUnit,
      linearUnitY: impulseYUnit,
      angularUnit: angularImpulseUnit,
      baseImpulseEnergy,
      reverseLimit,
      preferredDirection: dot(thrustDir, desiredHeading) >= 0 ? 1 : -1,
    });

    maxLinearCapacity += linearImpulseUnit;
    maxAngularCapacity += Math.abs(angularImpulseUnit);
  }

  if (candidates.length === 0) {
    return impulses;
  }

  const canTurn = hasTargetHeading && hasSpeed && maxAngularCapacity > 0;

  const linearScale = canTurn
    ? clamp(1 - turnMix * NEURAL_CONSTANTS.coordinationTurnLinearTradeoff, 0, 1)
    : 1;
  const desiredLinearMagnitude = maxLinearCapacity * linearScale;
  const desiredLinear: Vec2 = {
    x: desiredHeading.x * desiredLinearMagnitude,
    y: desiredHeading.y * desiredLinearMagnitude,
  };

  const desiredAngular = canTurn
    ? desiredAngularSign * maxAngularCapacity * desiredAngularScale
    : 0;

  const activations = solveActivations(
    candidates,
    desiredLinear,
    desiredAngular,
    NEURAL_CONSTANTS.coordinationLinearWeight,
    NEURAL_CONSTANTS.coordinationAngularWeight,
    NEURAL_CONSTANTS.coordinationSolverIterations
  );

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const activation = activations[i];
    const impulseEnergy = candidate.baseImpulseEnergy * Math.abs(activation);

    impulses.push({
      segmentIndex: candidate.segmentIndex,
      impulse: {
        x: candidate.linearUnitX * activation,
        y: candidate.linearUnitY * activation,
      },
      torque: candidate.angularUnit * activation,
      foodCost: impulseEnergy * config.locomotorFoodCost,
      pulseDirection: activation === 0 ? candidate.preferredDirection : (activation > 0 ? 1 : -1),
    });
  }

  return impulses;
}

export function applyNeuralResponse(
  entity: Entity,
  impulses: LocomotorImpulse[],
  currentTimeMs: number
): number {
  let totalFoodCost = 0;

  for (const { segmentIndex, impulse, torque, foodCost, pulseDirection } of impulses) {
    const seg = entity.segments[segmentIndex];

    entity.velocity.x += impulse.x;
    entity.velocity.y += impulse.y;
    entity.angularVelocity += torque;

    entity.foodBuffer = Math.max(0, entity.foodBuffer - foodCost);
    totalFoodCost += foodCost;

    seg.lastPulseTimeMs = currentTimeMs;
    seg.nextPulseTimeMs = seg.pulseIntervalMs;
    seg.lastPulseDirection = pulseDirection;
  }

  return totalFoodCost;
}

export function getNeuralSegments(entity: Entity): Segment[] {
  return entity.segments.filter(seg => seg.type === SegmentType.Neural);
}

export function hasNeuralSegments(entity: Entity): boolean {
  return entity.segments.some(seg => seg.type === SegmentType.Neural);
}
