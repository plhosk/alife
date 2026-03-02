import { Collision, Config, Entity, PHYSICS_CONSTANTS, Segment, Vec2 } from '../types';
import { pointToSegmentDist, vecCross2D, vecDot, vecLength, vecNegate, vecNormalize, vecScale, vecSub } from '../vec2';

function estimatePenetration(point: Vec2, segA: Segment, segB: Segment): number {
  const distToA = Math.min(
    vecLength(vecSub(point, segA.worldStart)),
    vecLength(vecSub(point, segA.worldEnd)),
    pointToSegmentDist(point, segA.worldStart, segA.worldEnd) * 0.5
  );
  const distToB = Math.min(
    vecLength(vecSub(point, segB.worldStart)),
    vecLength(vecSub(point, segB.worldEnd)),
    pointToSegmentDist(point, segB.worldStart, segB.worldEnd) * 0.5
  );

  return Math.max(PHYSICS_CONSTANTS.minPenetrationDepth, Math.min(distToA, distToB) * 0.25);
}

function getSegmentNormal(seg: Segment): Vec2 {
  const dx = seg.worldEnd.x - seg.worldStart.x;
  const dy = seg.worldEnd.y - seg.worldStart.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return { x: 1, y: 0 };
  return { x: -dy / len, y: dx / len };
}

function calculateMass(entity: Entity): number {
  return entity.mass;
}

function calculateMomentOfInertia(entity: Entity): number {
  return entity.inertia;
}

export function applyCollisionImpulse(collision: Collision, config: Config): void {
  const { entityA, entityB, segmentA, segmentB, point } = collision;

  const normalA = getSegmentNormal(segmentA);
  const normalB = getSegmentNormal(segmentB);

  let toBX = entityB.com.x - entityA.com.x;
  let toBY = entityB.com.y - entityA.com.y;

  if (toBX > config.worldWidth / 2) toBX -= config.worldWidth;
  if (toBX < -config.worldWidth / 2) toBX += config.worldWidth;
  if (toBY > config.worldHeight / 2) toBY -= config.worldHeight;
  if (toBY < -config.worldHeight / 2) toBY += config.worldHeight;

  let combinedNormal = vecNormalize({
    x: normalA.x + normalB.x,
    y: normalA.y + normalB.y
  });

  const toB = { x: toBX, y: toBY };
  if (vecDot(combinedNormal, toB) > 0) {
    combinedNormal = vecNegate(combinedNormal);
  }

  if (vecLength(combinedNormal) < 0.001) {
    combinedNormal = vecNormalize(toB);
    if (vecLength(combinedNormal) < 0.001) {
      combinedNormal = { x: 1, y: 0 };
    }
  }

  const rA = vecSub(point, entityA.com);

  let rBX = point.x - entityB.com.x;
  let rBY = point.y - entityB.com.y;
  if (rBX > config.worldWidth / 2) rBX -= config.worldWidth;
  if (rBX < -config.worldWidth / 2) rBX += config.worldWidth;
  if (rBY > config.worldHeight / 2) rBY -= config.worldHeight;
  if (rBY < -config.worldHeight / 2) rBY += config.worldHeight;
  const rB = { x: rBX, y: rBY };

  const massA = calculateMass(entityA);
  const massB = calculateMass(entityB);
  const invMassA = 1 / massA;
  const invMassB = 1 / massB;

  const inertiaA = calculateMomentOfInertia(entityA);
  const inertiaB = calculateMomentOfInertia(entityB);
  const invInertiaA = 1 / inertiaA;
  const invInertiaB = 1 / inertiaB;

  const rAxN = vecCross2D(rA, combinedNormal);
  const rBxN = vecCross2D(rB, combinedNormal);
  const denom = invMassA + invMassB + rAxN * rAxN * invInertiaA + rBxN * rBxN * invInertiaB;

  const penetration = estimatePenetration(point, segmentA, segmentB);
  const totalInvMass = invMassA + invMassB;
  const correctionA = penetration * (invMassA / totalInvMass) * PHYSICS_CONSTANTS.positionCorrectionFactor;
  const correctionB = penetration * (invMassB / totalInvMass) * PHYSICS_CONSTANTS.positionCorrectionFactor;

  entityA.position.x += combinedNormal.x * correctionA;
  entityA.position.y += combinedNormal.y * correctionA;
  entityB.position.x -= combinedNormal.x * correctionB;
  entityB.position.y -= combinedNormal.y * correctionB;

  if (entityA.position.x < 0) entityA.position.x += config.worldWidth;
  if (entityA.position.x > config.worldWidth) entityA.position.x -= config.worldWidth;
  if (entityA.position.y < 0) entityA.position.y += config.worldHeight;
  if (entityA.position.y > config.worldHeight) entityA.position.y -= config.worldHeight;
  if (entityB.position.x < 0) entityB.position.x += config.worldWidth;
  if (entityB.position.x > config.worldWidth) entityB.position.x -= config.worldWidth;
  if (entityB.position.y < 0) entityB.position.y += config.worldHeight;
  if (entityB.position.y > config.worldHeight) entityB.position.y -= config.worldHeight;

  function getVelAtPointA(): Vec2 {
    return {
      x: entityA.velocity.x - entityA.angularVelocity * rA.y,
      y: entityA.velocity.y + entityA.angularVelocity * rA.x
    };
  }
  function getVelAtPointB(): Vec2 {
    return {
      x: entityB.velocity.x - entityB.angularVelocity * rB.y,
      y: entityB.velocity.y + entityB.angularVelocity * rB.x
    };
  }

  const relativeVel = vecSub(getVelAtPointA(), getVelAtPointB());
  const velAlongNormal = vecDot(relativeVel, combinedNormal);

  if (velAlongNormal >= 0) return;

  const j = -(1 + config.collisionRestitution) * velAlongNormal / denom;
  const impulse = vecScale(combinedNormal, j);

  entityA.velocity.x += impulse.x * invMassA;
  entityA.velocity.y += impulse.y * invMassA;
  entityB.velocity.x -= impulse.x * invMassB;
  entityB.velocity.y -= impulse.y * invMassB;

  entityA.angularVelocity += rAxN * j * invInertiaA;
  entityB.angularVelocity -= rBxN * j * invInertiaB;

  const tangent: Vec2 = {
    x: -combinedNormal.y,
    y: combinedNormal.x
  };
  const velAlongTangent = vecDot(relativeVel, tangent);
  const rAxT = vecCross2D(rA, tangent);
  const rBxT = vecCross2D(rB, tangent);
  const denomT = invMassA + invMassB + rAxT * rAxT * invInertiaA + rBxT * rBxT * invInertiaB;

  const tangentialFriction = Math.min(1, Math.max(0, config.collisionFriction));
  const jt = -velAlongTangent / denomT * tangentialFriction;
  const tangentImpulse = vecScale(tangent, jt);

  entityA.velocity.x += tangentImpulse.x * invMassA;
  entityA.velocity.y += tangentImpulse.y * invMassA;
  entityB.velocity.x -= tangentImpulse.x * invMassB;
  entityB.velocity.y -= tangentImpulse.y * invMassB;

  entityA.angularVelocity += rAxT * jt * invInertiaA;
  entityB.angularVelocity -= rBxT * jt * invInertiaB;
}
