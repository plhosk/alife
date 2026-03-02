import {
  AGGRESSION_HEAT_CONSTANTS,
  ATTACK_CONSTANTS,
  Collision,
  Config,
  Entity,
  FoodIncomeBreakdown,
  LINEAGE_CONSTANTS,
  Segment,
  SegmentType,
  Vec2,
} from '../types';
import { calculateFoodStealMultiplier, transferFoodOverflowToRepro } from '../entity/economy';
import { applyCollisionImpulse } from '../physics/impulse';
import { EventLog } from '../eventlog';
import { vecDistance, vecDot, vecNormalize, vecSub } from '../vec2';

export function areCloseRelatives(a: Entity, b: Entity): boolean {
  const depth = LINEAGE_CONSTANTS.maxLineageDepth;
  const recentA = a.ancestorIds.slice(0, depth);
  const recentB = b.ancestorIds.slice(0, depth);
  return recentA.some(id => recentB.includes(id));
}

function calculateAngleDamageMultiplier(
  attackSegment: { worldStart: Vec2; worldEnd: Vec2 },
  collisionPoint: Vec2,
  defenderCenter: Vec2
): number {
  const segmentDir = vecNormalize(vecSub(attackSegment.worldEnd, attackSegment.worldStart));
  const toDefender = vecNormalize(vecSub(defenderCenter, collisionPoint));
  return Math.abs(vecDot(segmentDir, toDefender));
}

function findWorstAngleMultiplier(
  attacker: Entity,
  defender: Entity,
  collisionPoint: Vec2
): number {
  let minMultiplier = 1.0;
  for (const seg of attacker.segments) {
    if (seg.type !== SegmentType.Attack) continue;
    const distToStart = vecDistance(collisionPoint, seg.worldStart);
    const distToEnd = vecDistance(collisionPoint, seg.worldEnd);
    if (distToStart < ATTACK_CONSTANTS.cornerThreshold || distToEnd < ATTACK_CONSTANTS.cornerThreshold) {
      const mult = calculateAngleDamageMultiplier(seg, collisionPoint, defender.position);
      if (mult < minMultiplier) minMultiplier = mult;
    }
  }
  return minMultiplier;
}

interface ProcessAttackContext {
  config: Config;
  trackedEntityId: number | null;
  simDtSec: number;
  totalDeaths: number;
  deathsByAttack: number;
}

function processAttack(
  context: ProcessAttackContext,
  attacker: Entity,
  attackSegment: Segment,
  defender: Entity,
  defenseSegment: Segment,
  collisionPoint: Vec2,
  closeRelatives: boolean,
  stepIncome: FoodIncomeBreakdown
): ProcessAttackContext {
  if (attackSegment.type !== SegmentType.Attack || defender.dead || closeRelatives) return context;

  const distToStart = vecDistance(collisionPoint, attackSegment.worldStart);
  const distToEnd = vecDistance(collisionPoint, attackSegment.worldEnd);
  const isAtCorner = distToStart < ATTACK_CONSTANTS.cornerThreshold || distToEnd < ATTACK_CONSTANTS.cornerThreshold;

  if (!isAtCorner) return context;

  let damage = context.config.attackDamagePerLength * attackSegment.length;

  const angleMultiplier = findWorstAngleMultiplier(attacker, defender, collisionPoint);
  damage *= angleMultiplier;

  if (defenseSegment.type === SegmentType.Armor) {
    damage *= (1 - ATTACK_CONSTANTS.armorDamageReduction);
  } else if (defenseSegment.type === SegmentType.Attack) {
    damage *= (1 - ATTACK_CONSTANTS.attackDamageReduction);
  }

  defender.hp -= damage;
  defenseSegment.lastAttackedTimeMs = performance.now();

  const stealMultiplier = calculateFoodStealMultiplier(attacker);
  const foodStolen = Math.min(defender.foodBuffer, damage * context.config.foodStealPerDamage * stealMultiplier);
  attacker.foodBuffer += foodStolen;
  defender.foodBuffer -= foodStolen;

  const normalizedDamage = damage / AGGRESSION_HEAT_CONSTANTS.damageNormalization;
  const normalizedFoodStolen = foodStolen / AGGRESSION_HEAT_CONSTANTS.foodStealNormalization;
  const weightedImpact = normalizedDamage * AGGRESSION_HEAT_CONSTANTS.damageWeight
    + normalizedFoodStolen * AGGRESSION_HEAT_CONSTANTS.foodStealWeight;
  const heatGain = context.config.aggressionHeatStrength * (AGGRESSION_HEAT_CONSTANTS.baseGainOnAttack + weightedImpact);
  attacker.aggressionHeat = Math.min(1, attacker.aggressionHeat + heatGain);

  if (attacker.id === context.trackedEntityId && context.simDtSec > 0) {
    stepIncome.attack += foodStolen / context.simDtSec;
  }

  if (defender.hp <= 0) {
    defender.dead = true;
    defender.deathTimeMs = performance.now();
    context.totalDeaths++;
    context.deathsByAttack++;
    const inheritedFood = defender.foodBuffer * context.config.killFoodTransferFraction;
    attacker.foodBuffer += inheritedFood;
    if (attacker.id === context.trackedEntityId && context.simDtSec > 0) {
      stepIncome.attack += inheritedFood / context.simDtSec;
    }
    transferFoodOverflowToRepro(attacker);
    EventLog.log('kill', `Entity #${attacker.id} killed #${defender.id}`, defender.id);
  }

  return context;
}

export interface CombatStepResult {
  totalDeaths: number;
  deathsByAttack: number;
}

export function processCollisionsStep(
  config: Config,
  simDtSec: number,
  collisions: Collision[],
  stepIncome: FoodIncomeBreakdown,
  trackedEntityId: number | null,
  totalDeaths: number,
  deathsByAttack: number
): CombatStepResult {
  let context: ProcessAttackContext = {
    config,
    trackedEntityId,
    simDtSec,
    totalDeaths,
    deathsByAttack,
  };

  for (const collision of collisions) {
    applyCollisionImpulse(collision, config);

    const { entityA, entityB, segmentA, segmentB } = collision;
    const closeRelatives = config.familyNonAggression && areCloseRelatives(entityA, entityB);

    context = processAttack(context, entityA, segmentA, entityB, segmentB, collision.point, closeRelatives, stepIncome);
    context = processAttack(context, entityB, segmentB, entityA, segmentA, collision.point, closeRelatives, stepIncome);
  }

  return {
    totalDeaths: context.totalDeaths,
    deathsByAttack: context.deathsByAttack,
  };
}
