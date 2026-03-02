import { Entity, Config, DEFAULT_CONFIG, PHYSICS_CONSTANTS, REPRODUCTION_CONSTANTS, SURVIVAL_CONSTANTS, SpawnConfig, FoodIncomeBreakdown, PANEL_CONSTANTS, VISUAL_EFFECTS_CONSTANTS, INITIAL_POPULATION_CONSTANTS, SegmentType, SEGMENT_TYPES, LOCOMOTION_CONSTANTS } from './types';
import { createEntity } from './entity/factory';
import { applyLocomotorImpulses, updateSegmentWorldPositions } from './entity/kinematics';
import { calculateEnvironmentPhotosynthesisMultiplier, calculateMetabolism, calculatePhotosynthesis, calculateSegmentLengthByType, canReproduce, randomPosition, transferFoodOverflowToRepro } from './entity/economy';
import { Genome } from './genome';
import { detectCollisions } from './physics/collisions';
import { applyPhysics } from './physics/integration';
import { checkEntityOverlap } from './physics/overlap';
import { SpatialHash } from './physics/spatialHash';
import { EventLog } from './eventlog';
import { sortByAgeDesc, killRandom, killByMinMetric, killMostCommonType } from './culling';
import { processCollisionsStep } from './simulation/combat';
import { getLivingRelatives } from './simulation/relatives';
import { PendingSpawn, processReproductionStep } from './simulation/reproduction';
import { EnvironmentField } from './environmentField';
import { detectTargets, computeNeuralState } from './entity/neuralSense';
import { computeWeightedBurst, applyNeuralResponse, getNeuralSegments, hasNeuralSegments } from './entity/neuralResponse';

type RandomState = [number, number, number, number];

export class Simulation {
  entities: Entity[] = [];
  config: Config;
  private spatialHash: SpatialHash;
  generation: number = 0;
  private pendingSpawns: PendingSpawn[] = [];
  private simulationTimeSec: number = 0;
  private lastGlobalReproductionSec: number = 0;
  private showFlashEffects: boolean = true;
  private speedMultiplier: number = 1;
  private environmentField: EnvironmentField;
  private trackedEntityId: number | null = null;
  private incomeHistory: FoodIncomeBreakdown[] = [];
  private incomeHistoryMaxSamples: number = PANEL_CONSTANTS.incomeHistoryMaxSamples;
  private entityRandomSeed: number | null = null;
  private entityRandomState: RandomState = [0, 0, 0, 0];
  private evolutionRandomSeed: number | null = null;
  private evolutionRandomState: RandomState = [0, 0, 0, 0];
  totalBirths: number = 0;
  totalDeaths: number = 0;
  birthsByReproduction: number = 0;
  birthsBySpawning: number = 0;
  deathsByStarvation: number = 0;
  deathsByOldAge: number = 0;
  deathsByAttack: number = 0;
  deathsByCulling: number = 0;
  private enabledSegmentTypes: SegmentType[] = [...SEGMENT_TYPES];

  setEnabledSegmentTypes(types: SegmentType[]): void {
    this.enabledSegmentTypes = types.length > 0 ? [...types] : [...SEGMENT_TYPES];
  }

  getEnabledSegmentTypes(): SegmentType[] {
    return this.enabledSegmentTypes;
  }
  
  setShowFlashEffects(show: boolean): void {
    this.showFlashEffects = show;
  }
  
  setSpeedMultiplier(speed: number): void {
    this.speedMultiplier = speed;
  }

  getSpeedMultiplier(): number {
    return this.speedMultiplier;
  }

  getFlashDuration(): number {
    return VISUAL_EFFECTS_CONSTANTS.flashDurationMs / (this.speedMultiplier * (this.config?.simulationTimeScale || 1));
  }

  resetMainSimulation(): void {
    this.entities = [];
    this.generation = 0;
    this.pendingSpawns = [];
    this.simulationTimeSec = 0;
    this.lastGlobalReproductionSec = 0;
    this.trackedEntityId = null;
    this.incomeHistory = [];
    this.totalBirths = 0;
    this.totalDeaths = 0;
    this.birthsByReproduction = 0;
    this.birthsBySpawning = 0;
    this.deathsByStarvation = 0;
    this.deathsByOldAge = 0;
    this.deathsByAttack = 0;
    this.deathsByCulling = 0;
    this.environmentField.reset();
    this.resetEntityRandomState();
    this.resetEvolutionRandomState();
  }

  private normalizeRandomSeed(seed: number | null | undefined): number | null {
    if (seed === null || seed === undefined || !Number.isFinite(seed)) {
      return null;
    }
    return Math.trunc(seed) >>> 0;
  }

  private rotateLeft(value: number, shift: number): number {
    return ((value << shift) | (value >>> (32 - shift))) >>> 0;
  }

  private splitMix32(seed: number): RandomState {
    let state = seed >>> 0;
    const next = (): number => {
      state = (state + 0x9e3779b9) >>> 0;
      let z = state;
      z = Math.imul((z ^ (z >>> 16)) >>> 0, 0x85ebca6b) >>> 0;
      z = Math.imul((z ^ (z >>> 13)) >>> 0, 0xc2b2ae35) >>> 0;
      z = (z ^ (z >>> 16)) >>> 0;
      return z >>> 0;
    };

    const seeded: RandomState = [next(), next(), next(), next()];
    if (seeded[0] === 0 && seeded[1] === 0 && seeded[2] === 0 && seeded[3] === 0) {
      seeded[0] = 1;
    }
    return seeded;
  }

  private nextXoshiro128StarStar(state: RandomState): number {
    const result = Math.imul(this.rotateLeft(Math.imul(state[1], 5) >>> 0, 7), 9) >>> 0;
    const t = (state[1] << 9) >>> 0;

    state[2] = (state[2] ^ state[0]) >>> 0;
    state[3] = (state[3] ^ state[1]) >>> 0;
    state[1] = (state[1] ^ state[2]) >>> 0;
    state[0] = (state[0] ^ state[3]) >>> 0;

    state[2] = (state[2] ^ t) >>> 0;
    state[3] = this.rotateLeft(state[3], 11);

    return result / 4294967296;
  }

  private createRandomStateFromCrypto(): RandomState {
    const values = new Uint32Array(4);

    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(values);
    } else {
      values[0] = (Math.random() * 4294967296) >>> 0;
      values[1] = (Math.random() * 4294967296) >>> 0;
      values[2] = (Math.random() * 4294967296) >>> 0;
      values[3] = (Math.random() * 4294967296) >>> 0;
    }

    const seeded: RandomState = [values[0] >>> 0, values[1] >>> 0, values[2] >>> 0, values[3] >>> 0];
    if (seeded[0] === 0 && seeded[1] === 0 && seeded[2] === 0 && seeded[3] === 0) {
      seeded[0] = 1;
    }

    return seeded;
  }

  resetEntityRandomState(): void {
    if (this.entityRandomSeed === null) {
      this.entityRandomState = this.createRandomStateFromCrypto();
      return;
    }
    this.entityRandomState = this.splitMix32(this.entityRandomSeed);
  }

  resetEvolutionRandomState(): void {
    if (this.evolutionRandomSeed === null) {
      this.evolutionRandomState = this.createRandomStateFromCrypto();
      return;
    }
    this.evolutionRandomState = this.splitMix32(this.evolutionRandomSeed);
  }

  private nextEntityRandom = (): number => {
    return this.nextXoshiro128StarStar(this.entityRandomState);
  };

  private nextEvolutionRandom = (): number => {
    return this.nextXoshiro128StarStar(this.evolutionRandomState);
  };

  setRandomSeed(seed: number | null): void {
    const normalizedSeed = this.normalizeRandomSeed(seed);
    this.entityRandomSeed = normalizedSeed;
    this.config.initialRandomSeed = normalizedSeed;
    this.resetEntityRandomState();
  }

  getRandomSeed(): number | null {
    return this.entityRandomSeed;
  }

  setInitialRandomSeed(seed: number | null): void {
    this.setRandomSeed(seed);
  }

  getInitialRandomSeed(): number | null {
    return this.getRandomSeed();
  }

  setEvolutionRandomSeed(seed: number | null): void {
    const normalizedSeed = this.normalizeRandomSeed(seed);
    this.evolutionRandomSeed = normalizedSeed;
    this.config.evolutionRandomSeed = normalizedSeed;
    this.resetEvolutionRandomState();
  }

  getEvolutionRandomSeed(): number | null {
    return this.evolutionRandomSeed;
  }
  
  startTracking(entityId: number): void {
    this.trackedEntityId = entityId;
    this.incomeHistory = [];
  }
  
  stopTracking(): void {
    this.trackedEntityId = null;
    this.incomeHistory = [];
  }
  
  getIncomeStats(): FoodIncomeBreakdown | null {
    if (this.incomeHistory.length === 0) return null;
    const totals = {
      photosynthesis: 0,
      locomotion: 0,
      attack: 0,
      metabolismDemand: 0,
      locomotionDemand: 0,
      photosynthNutrientConsumed: 0,
      locomotionNutrientConsumed: 0,
    };
    for (const entry of this.incomeHistory) {
      totals.photosynthesis += entry.photosynthesis;
      totals.locomotion += entry.locomotion;
      totals.attack += entry.attack;
      totals.metabolismDemand += entry.metabolismDemand;
      totals.locomotionDemand += entry.locomotionDemand;
      totals.photosynthNutrientConsumed += entry.photosynthNutrientConsumed;
      totals.locomotionNutrientConsumed += entry.locomotionNutrientConsumed;
    }
    const count = this.incomeHistory.length;
    return {
      photosynthesis: totals.photosynthesis / count,
      locomotion: totals.locomotion / count,
      attack: totals.attack / count,
      metabolismDemand: totals.metabolismDemand / count,
      locomotionDemand: totals.locomotionDemand / count,
      photosynthNutrientConsumed: totals.photosynthNutrientConsumed / count,
      locomotionNutrientConsumed: totals.locomotionNutrientConsumed / count,
    };
  }
  
  constructor(config: Partial<Config> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.spatialHash = new SpatialHash(PHYSICS_CONSTANTS.spatialHashCellSize, this.config.worldWidth, this.config.worldHeight);
    this.environmentField = new EnvironmentField({
      worldWidth: this.config.worldWidth,
      worldHeight: this.config.worldHeight,
      cellSize: this.config.environmentCellSize,
    });
    this.setRandomSeed(this.config.initialRandomSeed);
    this.setEvolutionRandomSeed(this.config.evolutionRandomSeed);
  }
  
  initialize(): void {
    this.entities = [];
    this.generation = 0;
    this.totalBirths = 0;
    this.totalDeaths = 0;
    this.birthsByReproduction = 0;
    this.birthsBySpawning = 0;
    this.deathsByStarvation = 0;
    this.deathsByOldAge = 0;
    this.deathsByAttack = 0;
    this.deathsByCulling = 0;
    this.environmentField.reset();
    this.resetEntityRandomState();
    this.resetEvolutionRandomState();
    EventLog.log('system', 'Simulation initialized');
    
    const enabledTypes = this.enabledSegmentTypes;
    const weights = new Map<SegmentType, number>();
    for (const type of enabledTypes) {
      weights.set(type, 1);
    }
    
    let spawned = 0;
    let attempts = 0;
    const maxAttempts = INITIAL_POPULATION_CONSTANTS.count * 10;
    
    while (spawned < INITIAL_POPULATION_CONSTANTS.count && attempts < maxAttempts) {
      attempts++;
      const genome = Genome.randomWeighted(
        weights,
        {
          genomeBaseSegmentBudget: this.config.genomeBaseSegmentBudget,
          genomeSymmetrySegmentBonus: this.config.genomeSymmetrySegmentBonus
        },
        this.nextEntityRandom
      );
      const position = randomPosition(this.config, this.nextEntityRandom);
      const rotation = this.nextEntityRandom() * Math.PI * 2;
      
      if (!checkEntityOverlap(position, rotation, genome, this.entities, REPRODUCTION_CONSTANTS.overlapCheckDistance)) {
        const entity = createEntity(genome, position, this.config, [], null, this.nextEntityRandom);
        if (entity) {
          entity.rotation = rotation;
          updateSegmentWorldPositions(entity, this.nextEntityRandom);
          this.entities.push(entity);
          spawned++;
          this.totalBirths++;
          this.birthsBySpawning++;
        }
      }
    }
    EventLog.log('system', `Spawned ${this.entities.length} initial entities`);
  }
  
  step(simDtSec: number): void {
    this.simulationTimeSec += simDtSec;

    this.environmentField.step(simDtSec, {
      nutrientRegenRate: this.config.environmentNutrientRegenRate,
    });
    
    const stepIncome: FoodIncomeBreakdown = {
      photosynthesis: 0,
      locomotion: 0,
      attack: 0,
      metabolismDemand: 0,
      locomotionDemand: 0,
      photosynthNutrientConsumed: 0,
      locomotionNutrientConsumed: 0,
    };
    
    for (const entity of this.entities) {
      if (entity.dead) continue;
      
      const isTracked = entity.id === this.trackedEntityId;
      const previousComX = entity.com.x;
      const previousComY = entity.com.y;
      
      const currentSimTimeMs = this.simulationTimeSec * 1000;
      let neuralFoodCost = 0;
      
      if (hasNeuralSegments(entity) && currentSimTimeMs >= entity.nextNeuralPulseTimeMs) {
        const neuralSegs = getNeuralSegments(entity);
        const detection = detectTargets(entity, neuralSegs, this.spatialHash, this.config);
        const neuralState = computeNeuralState(entity, neuralSegs, detection, this.environmentField);
        const impulses = computeWeightedBurst(entity, neuralState, currentSimTimeMs, this.config);
        neuralFoodCost = applyNeuralResponse(entity, impulses, currentSimTimeMs);
        
        entity.lastNeuralBehavior = neuralState.behavior;
        entity.lastNeuralDirection = { ...neuralState.combinedDirection };
        entity.lastNeuralTargetTimeMs = currentSimTimeMs;
        entity.lastNeuralTargetId = detection ? detection.target.id : null;
        
        entity.nextNeuralPulseTimeMs = currentSimTimeMs + entity.neuralPulseIntervalMs;
      }
      
      const locomotorFoodCost = applyLocomotorImpulses(entity, simDtSec, this.config, currentSimTimeMs);
      const totalLocomotorCost = locomotorFoodCost + neuralFoodCost;
      const moved = applyPhysics(entity, simDtSec, this.config);
      if (moved) {
        updateSegmentWorldPositions(entity);
      }

      const environmentFootprintRadius = Math.max(
        this.config.environmentCellSize * 0.75,
        entity.boundingRadius * this.config.environmentFootprintScale
      );

      const nutrientLevel = this.environmentField.sampleFootprint(
        'nutrient',
        entity.com.x,
        entity.com.y,
        environmentFootprintRadius,
        this.config.environmentFootprintFalloffPower,
      );
      const recoverySec = Math.max(0.001, this.config.aggressionHeatRecoverySec);
      entity.aggressionHeat *= Math.exp(-simDtSec / recoverySec);
      if (entity.aggressionHeat < 0.0001) entity.aggressionHeat = 0;
      
      const metabolism = calculateMetabolism(entity, this.config);
      entity.foodBuffer = Math.max(0, entity.foodBuffer - metabolism * simDtSec);
      if (isTracked) {
        stepIncome.metabolismDemand += metabolism;
      }
      if (isTracked && simDtSec > 0) {
        stepIncome.locomotionDemand += totalLocomotorCost / simDtSec;
      }
      
      const foodRatio = entity.maxFoodBuffer > 0 ? entity.foodBuffer / entity.maxFoodBuffer : 0;
      const foodHpPercentRate = this.config.foodDrivenHpRate / 100;
      if (foodRatio < SURVIVAL_CONSTANTS.starvationThreshold) {
        const starvationPressure = 1 - foodRatio / SURVIVAL_CONSTANTS.starvationThreshold;
        entity.hp -= entity.maxHp * foodHpPercentRate * starvationPressure * simDtSec;
      } else {
        const healingPressure = (foodRatio - SURVIVAL_CONSTANTS.starvationThreshold) / SURVIVAL_CONSTANTS.healingThreshold;
        entity.hp += entity.maxHp * foodHpPercentRate * healingPressure * simDtSec;
        entity.hp = Math.min(entity.maxHp, entity.hp);
      }

      const environmentPhotosynthMultiplier = calculateEnvironmentPhotosynthesisMultiplier(nutrientLevel, this.config);
      const photosynthesis = calculatePhotosynthesis(entity, this.config, environmentPhotosynthMultiplier);
      entity.foodBuffer += photosynthesis * simDtSec;
      if (isTracked) stepIncome.photosynthesis += photosynthesis;
      
      const environmentLocomotionReward = this.calculateEnvironmentLocomotionReward(entity, previousComX, previousComY, simDtSec);
      const locomotionReward = environmentLocomotionReward.foodPerSec;
      entity.foodBuffer += locomotionReward * simDtSec;
      if (isTracked) {
        stepIncome.locomotion += locomotionReward;
        stepIncome.locomotionNutrientConsumed += simDtSec > 0
          ? environmentLocomotionReward.consumedNutrient / simDtSec
          : 0;
      }

      const nutrientConsumption = photosynthesis * this.config.environmentNutrientConsumptionRate * simDtSec;
      if (nutrientConsumption > 0) {
        this.environmentField.addFootprint(
          'nutrient',
          entity.com.x,
          entity.com.y,
          environmentFootprintRadius,
          -nutrientConsumption,
          this.config.environmentFootprintFalloffPower,
        );
        if (isTracked) {
          stepIncome.photosynthNutrientConsumed += simDtSec > 0 ? nutrientConsumption / simDtSec : 0;
        }
      }
      
      transferFoodOverflowToRepro(entity);
      
      entity.ageMs += simDtSec * 1000;
      
      const exceedsMaxAge = this.config.maxAgeMs < SURVIVAL_CONSTANTS.maxAgeUnlimitedMs
        && entity.ageMs >= this.config.maxAgeMs;
      if (entity.hp <= 0 || exceedsMaxAge) {
        entity.dead = true;
        entity.deathTimeMs = performance.now();
        this.totalDeaths++;
        if (entity.hp <= 0) {
          this.deathsByStarvation++;
          EventLog.log('death', `Entity #${entity.id} died from starvation`, entity.id);
        } else {
          this.deathsByOldAge++;
          EventLog.log('death', `Entity #${entity.id} died from old age`, entity.id);
        }
      }
    }
    
    const collisions = detectCollisions(this.entities, this.spatialHash, this.config.worldWidth, this.config.worldHeight);
    const combatResult = processCollisionsStep(
      this.config,
      simDtSec,
      collisions,
      stepIncome,
      this.trackedEntityId,
      this.totalDeaths,
      this.deathsByAttack,
    );
    this.totalDeaths = combatResult.totalDeaths;
    this.deathsByAttack = combatResult.deathsByAttack;
    
    if (this.trackedEntityId !== null) {
      this.incomeHistory.push({ ...stepIncome });
      if (this.incomeHistory.length > this.incomeHistoryMaxSamples) {
        this.incomeHistory.shift();
      }
    }
    
    const reproductionResult = processReproductionStep(
      this.entities,
      this.config,
      this.spatialHash,
      this.pendingSpawns,
      this.simulationTimeSec,
      this.lastGlobalReproductionSec,
      this.generation,
      this.nextEvolutionRandom,
    );
    this.lastGlobalReproductionSec = reproductionResult.lastGlobalReproductionSec;
    this.generation = reproductionResult.generation;
    
    const now = performance.now();
    const flashDuration = VISUAL_EFFECTS_CONSTANTS.flashDurationMs / this.speedMultiplier;
    let writeIndex = 0;
    if (this.showFlashEffects) {
      for (let readIndex = 0; readIndex < this.entities.length; readIndex++) {
        const entity = this.entities[readIndex];
        if (!entity.dead || (now - entity.deathTimeMs < flashDuration)) {
          this.entities[writeIndex] = entity;
          writeIndex++;
        }
      }
    } else {
      for (let readIndex = 0; readIndex < this.entities.length; readIndex++) {
        const entity = this.entities[readIndex];
        if (!entity.dead) {
          this.entities[writeIndex] = entity;
          writeIndex++;
        }
      }
    }
    this.entities.length = writeIndex;
    
    for (const spawn of this.pendingSpawns) {
      if (this.entities.length >= this.config.maxPopulation) {
        if (this.config.cullingStrategy === 'none') {
          continue;
        }
        let culled = 0;
        switch (this.config.cullingStrategy) {
          case 'oldest':
            culled = this.killOldest(1);
            break;
          case 'random':
            culled = killRandom(this.entities, this.nextEvolutionRandom);
            break;
          case 'youngest':
            culled = killByMinMetric(this.entities, e => -e.ageMs);
            break;
          case 'lowest-hp':
            culled = killByMinMetric(this.entities, e => e.hp);
            break;
          case 'lowest-food':
            culled = killByMinMetric(this.entities, e => e.foodBuffer);
            break;
          case 'most-common':
            culled = killMostCommonType(this.entities, this.config, this.nextEvolutionRandom);
            break;
        }
        if (culled > 0) {
          this.totalDeaths += culled;
          this.deathsByCulling += culled;
        }
      }
      
      const entity = createEntity(
        spawn.genome,
        spawn.position,
        this.config,
        spawn.parentAncestors,
        spawn.parentId ?? null,
        this.nextEvolutionRandom
      );
      if (entity) {
        entity.rotation = spawn.rotation;
        if (spawn.parentGeneration !== undefined) {
          entity.generation = spawn.parentGeneration + 1;
        }
        updateSegmentWorldPositions(entity, this.nextEvolutionRandom);
        entity.velocity.x = spawn.impulseDir.x * spawn.impulseMagnitude;
        entity.velocity.y = spawn.impulseDir.y * spawn.impulseMagnitude;
        entity.angularVelocity = (this.nextEvolutionRandom() - 0.5) * 2;
        this.entities.push(entity);
        this.totalBirths++;
        this.birthsByReproduction++;
        if (spawn.parentId !== undefined) {
          EventLog.log('birth', `Entity #${entity.id} born from #${spawn.parentId}`, entity.id);
        }
      }
    }
    this.pendingSpawns = [];
    
  }
  
  private trySpawnEntity(genomeFn: () => string): boolean {
    for (let attempt = 0; attempt < REPRODUCTION_CONSTANTS.spawnAttempts; attempt++) {
      const genome = genomeFn();
      const position = randomPosition(this.config, this.nextEntityRandom);
      const rotation = this.nextEntityRandom() * Math.PI * 2;
      
      if (!checkEntityOverlap(position, rotation, genome, this.entities, REPRODUCTION_CONSTANTS.overlapCheckDistance)) {
        const entity = createEntity(genome, position, this.config, [], null, this.nextEntityRandom);
        if (entity) {
          entity.rotation = rotation;
          updateSegmentWorldPositions(entity, this.nextEntityRandom);
          this.entities.push(entity);
          this.totalBirths++;
          this.birthsBySpawning++;
          EventLog.log('system', `Entity #${entity.id} spawned manually`, entity.id);
          return true;
        }
      }
    }
    return false;
  }
  
  spawnRandom(): void {
    const toKill = this.entities.length + 1 - this.config.maxPopulation;
    if (toKill > 0) {
      const killed = this.killOldest(toKill);
      this.totalDeaths += killed;
      this.deathsByCulling += killed;
    }
    const enabledTypes = this.enabledSegmentTypes;
    const weights = new Map<SegmentType, number>();
    for (const type of enabledTypes) {
      weights.set(type, 1);
    }
    this.trySpawnEntity(() => Genome.randomWeighted(
      weights,
      {
        genomeBaseSegmentBudget: this.config.genomeBaseSegmentBudget,
        genomeSymmetrySegmentBonus: this.config.genomeSymmetrySegmentBonus
      },
      this.nextEntityRandom
    ));
  }

  spawnBiased(config: SpawnConfig, count: number): void {
    const enabledTypes = this.enabledSegmentTypes;
    const enabledSet = new Set(enabledTypes);
    
    const filteredWeights = new Map<SegmentType, number>();
    for (const [type, weight] of config.weights) {
      if (enabledSet.has(type)) {
        filteredWeights.set(type, weight);
      }
    }
    
    if (filteredWeights.size === 0) {
      return;
    }
    
    const guaranteedType = config.guaranteedType && enabledSet.has(config.guaranteedType) 
      ? config.guaranteedType 
      : undefined;
    
    const toKill = this.entities.length + count - this.config.maxPopulation;
    if (toKill > 0) {
      const killed = this.killOldest(toKill);
      this.totalDeaths += killed;
      this.deathsByCulling += killed;
    }
    
    for (let i = 0; i < count; i++) {
      this.trySpawnEntity(() => Genome.randomWeighted(
        filteredWeights,
        {
          genomeBaseSegmentBudget: this.config.genomeBaseSegmentBudget,
          genomeSymmetrySegmentBonus: this.config.genomeSymmetrySegmentBonus
        },
        this.nextEntityRandom,
        guaranteedType,
        config.guaranteedRatio
      ));
    }
  }
  
  killOldest(count: number): number {
    const sorted = [...this.entities].sort(sortByAgeDesc);
    const toKill = sorted.slice(0, count);
    for (const entity of toKill) {
      entity.dead = true;
      if (VISUAL_EFFECTS_CONSTANTS.showCullingDeathFlash) {
        entity.deathTimeMs = performance.now();
      }
    }
    this.entities = this.entities.filter(e => !e.dead);
    return toKill.length;
  }
  
  getPopulation(): number {
    return this.entities.length;
  }

  getQueuedCount(): number {
    return this.entities.filter(e => canReproduce(e)).length;
  }

  getMedianAgeMs(): number {
    const living = this.entities.filter(e => !e.dead);
    if (living.length === 0) return 0;
    const ages = living.map(e => e.ageMs).sort((a, b) => a - b);
    const mid = Math.floor(ages.length / 2);
    return ages.length % 2 !== 0 ? ages[mid] : (ages[mid - 1] + ages[mid]) / 2;
  }

  getSimulationTimeSec(): number {
    return this.simulationTimeSec;
  }

  private calculateEnvironmentLocomotionReward(
    entity: Entity,
    previousComX: number,
    previousComY: number,
    simDtSec: number
  ): { foodPerSec: number; consumedNutrient: number } {
    if (simDtSec <= 0) return { foodPerSec: 0, consumedNutrient: 0 };

    const locomotorLength = calculateSegmentLengthByType(entity, SegmentType.Locomotor);
    if (locomotorLength <= 0) return { foodPerSec: 0, consumedNutrient: 0 };

    let dx = entity.com.x - previousComX;
    let dy = entity.com.y - previousComY;
    if (dx > this.config.worldWidth / 2) dx -= this.config.worldWidth;
    if (dx < -this.config.worldWidth / 2) dx += this.config.worldWidth;
    if (dy > this.config.worldHeight / 2) dy -= this.config.worldHeight;
    if (dy < -this.config.worldHeight / 2) dy += this.config.worldHeight;

    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance <= 0) return { foodPerSec: 0, consumedNutrient: 0 };

    const nutrientDemandRate = Math.max(0, this.config.impulseNutrientDemandRate);
    const nutrientToFoodScale = Math.max(0, this.config.environmentLocomotorNutrientToFoodScale);
    const impulseDemandScale = Math.max(0, this.config.locomotorImpulsePerLength)
      / Math.max(0.0001, LOCOMOTION_CONSTANTS.nutrientDemandImpulseReference);
    const requestedNutrient = distance * locomotorLength * nutrientDemandRate * impulseDemandScale;
    if (requestedNutrient <= 0) return { foodPerSec: 0, consumedNutrient: 0 };

    const footprintRadius = Math.max(
      this.config.environmentCellSize * 0.75,
      entity.boundingRadius * this.config.environmentFootprintScale
    );
    const probeSpacing = Math.max(1, this.config.environmentCellSize * 0.75);
    const probeCount = Math.max(1, Math.min(6, Math.ceil(distance / probeSpacing)));
    const requestedPerProbe = requestedNutrient / probeCount;

    let consumedNutrient = 0;
    for (let probe = 0; probe < probeCount; probe++) {
      const t = (probe + 0.5) / probeCount;
      const sampleX = previousComX + dx * t;
      const sampleY = previousComY + dy * t;
      consumedNutrient += this.environmentField.consumeFootprint(
        'nutrient',
        sampleX,
        sampleY,
        footprintRadius,
        requestedPerProbe,
        this.config.environmentFootprintFalloffPower,
      );
    }

    return {
      foodPerSec: consumedNutrient * nutrientToFoodScale / simDtSec,
      consumedNutrient,
    };
  }

  resizeWorld(newSize: number): void {
    const oldSize = this.config.worldWidth;
    const oldCenter = oldSize / 2;
    const newCenter = newSize / 2;
    const shift = newCenter - oldCenter;
    const halfNew = newSize / 2;
    
    if (newSize > oldSize) {
      for (const e of this.entities) {
        e.position.x += shift;
        e.position.y += shift;
      }
    } else if (newSize < oldSize) {
      this.entities = this.entities.filter(e => {
        if (e.dead) return false;
        return e.position.x >= oldCenter - halfNew && e.position.x <= oldCenter + halfNew &&
               e.position.y >= oldCenter - halfNew && e.position.y <= oldCenter + halfNew;
      });
      for (const e of this.entities) {
        e.position.x += shift;
        e.position.y += shift;
      }
    }
    
    this.config.worldWidth = newSize;
    this.config.worldHeight = newSize;
    this.spatialHash = new SpatialHash(PHYSICS_CONSTANTS.spatialHashCellSize, newSize, newSize);
    this.environmentField.resize(newSize, newSize, this.config.environmentCellSize);
    
    EventLog.log('system', `World resized to ${newSize}×${newSize}`);
  }

  getLivingRelatives(entityId: number): Array<{ entity: Entity; relationship: string }> {
    return getLivingRelatives(this.entities, entityId);
  }

  setEnvironmentCellSize(cellSize: number): void {
    const nextCellSize = Math.max(1, Math.floor(cellSize));
    this.config.environmentCellSize = nextCellSize;
    this.environmentField.resize(this.config.worldWidth, this.config.worldHeight, nextCellSize);
  }

  setNutrientFieldType(type: import('./types').NutrientFieldType): void {
    this.config.nutrientFieldType = type;
    this.environmentField.setNutrientFieldType(type);
  }

  getEnvironmentField(): EnvironmentField {
    return this.environmentField;
  }
}
