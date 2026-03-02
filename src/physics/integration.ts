import { Config, Entity, PHYSICS_CONSTANTS, SIMULATION_TIMING_CONSTANTS } from '../types';

function clampDamping(value: number): number {
  return Math.min(0.999999, Math.max(0, value));
}

function computeDampingFactor(damping: number, simDtSec: number): number {
  if (simDtSec <= 0) return 1;
  const clampedDamping = clampDamping(damping);
  if (clampedDamping === 0) return 1;
  const referenceDt = SIMULATION_TIMING_CONSTANTS.standardStepDtSec;
  if (referenceDt <= 0) return 1;
  const normalizedSteps = simDtSec / referenceDt;
  return Math.exp(Math.log1p(-clampedDamping) * normalizedSteps);
}

export function applyPhysics(entity: Entity, simDtSec: number, config: Config): boolean {
  const previousX = entity.position.x;
  const previousY = entity.position.y;
  const previousRotation = entity.rotation;

  const motionDampingFactor = computeDampingFactor(config.motionDamping, simDtSec);
  entity.velocity.x *= motionDampingFactor;
  entity.velocity.y *= motionDampingFactor;
  entity.angularVelocity *= motionDampingFactor;

  if (Math.abs(entity.angularVelocity) > PHYSICS_CONSTANTS.maxAngularVelocity) {
    entity.angularVelocity = Math.sign(entity.angularVelocity) * PHYSICS_CONSTANTS.maxAngularVelocity;
  }

  const speed = Math.sqrt(entity.velocity.x ** 2 + entity.velocity.y ** 2);
  if (speed < PHYSICS_CONSTANTS.minVelocity) {
    entity.velocity.x = 0;
    entity.velocity.y = 0;
  } else if (speed > PHYSICS_CONSTANTS.maxVelocity) {
    const scale = PHYSICS_CONSTANTS.maxVelocity / speed;
    entity.velocity.x *= scale;
    entity.velocity.y *= scale;
  }

  entity.position.x += entity.velocity.x * simDtSec;
  entity.position.y += entity.velocity.y * simDtSec;
  entity.rotation += entity.angularVelocity * simDtSec;

  if (entity.position.x < 0) entity.position.x += config.worldWidth;
  if (entity.position.x > config.worldWidth) entity.position.x -= config.worldWidth;
  if (entity.position.y < 0) entity.position.y += config.worldHeight;
  if (entity.position.y > config.worldHeight) entity.position.y -= config.worldHeight;

  return entity.position.x !== previousX || entity.position.y !== previousY || entity.rotation !== previousRotation;
}
