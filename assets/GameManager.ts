import { _decorator, Component, Node, Label, Color, Material, MeshRenderer, primitives, utils, Layers, Mesh, Prefab, instantiate, SkeletalAnimation, AnimationClip, Camera, Texture2D, Vec3, Button, Canvas, Graphics, UITransform, director } from 'cc';
import { BridgeScenery } from './BridgeScenery';
import { PlayerRunner } from './PlayerRunner';
import { SquadFire } from './SquadFire';
const { ccclass, property } = _decorator;

const SQUAD_COLUMNS = 10;
const SQUAD_SPACING_X = 0.56;
const SQUAD_SPACING_Z = 0.60;
const SQUAD_ROW_OFFSET = 0.18;
const SQUAD_JITTER_X = 0.06;
const SQUAD_JITTER_Z = 0.12;
// Matches the standing height authored in main.scene and Zombie.prefab (8-unit road).
const CHARACTER_HEIGHT = 0.8;
const CONTACT_DISTANCE = 0.36;
const FRAME_PADDING = 0.45;
const COURSE_LOOKAHEAD = 85;
const GATE_SPACING = 19;
const SOLDIER_SHOT_RANGE = GATE_SPACING * 1.5;
const MAX_SQUAD_SIZE = 24;
const WARMUP_DISTANCE = 10;
const TIRE_HEALTH = 241;
const TIRE_STOP_DISTANCE = 7;
const BOSS_OFFSET = 12;
const BOSS_FIGHT_DISTANCE = 8;
const BOSS_MODELS: Record<string, { title: string; scale: number; color: Color }> = {
    MushroomKing: { title: '蘑菇王', scale: 0.79, color: new Color(233, 111, 63) },
    Orc_Skull: { title: '骷髅兽人', scale: 0.87, color: new Color(173, 190, 113) },
    BlueDemon: { title: '蓝魔', scale: 0.56, color: new Color(59, 160, 238) },
};
const GATE_ROWS = [
    { z: -7, left: -1, right: 1, enemyDepth: 3 },
    { z: -16, left: 2, right: -1, enemyDepth: 4.25, leftLabelOffset: -0.28, rightLabelOffset: -0.92 },
];

/** One gate panel on the road, like "+6" or "−1". */
interface Gate {
    node: Node;
    value: number | 'double';
}

interface GateRow {
    z: number;
    left: Gate;
    right: Gate;
    wave: { health: number; depth: number; spawned: boolean } | null;
}

interface TireReward {
    node: Node;
    label: Label;
    health: number;
    display: Node;
    prefab: Prefab;
}

interface BossEncounter {
    node: Node;
    warning: Node;
    label: Label;
    animation: SkeletalAnimation | null;
    title: string;
    health: number;
    maxHealth: number;
    stopZ: number;
    attackTimer: number;
}

/**
 * Streams the bridge and encounters ahead of the squad until it runs out of soldiers.
 * Attach this to an empty node called "Game" at position (0, 0, 0).
 */
@ccclass('GameManager')
export class GameManager extends Component {
    @property(Node) player: Node | null = null;       // drag the Player capsule here
    @property(Label) countLabel: Label | null = null; // drag the CountLabel here
    @property(Prefab) zombiePrefab: Prefab | null = null; // drag the Zombie prefab here (optional)
    @property([Prefab]) bossPrefabs: Prefab[] = [];
    @property(Prefab) blaster: Prefab | null = null;
    @property(Prefab) displayRifle: Prefab | null = null;
    @property(AnimationClip) targetingPose: AnimationClip | null = null;
    @property(Texture2D) oceanTexture: Texture2D | null = null;
    @property(MeshRenderer) road: MeshRenderer | null = null;
    @property zombieSpeed = 1.5;   // how fast zombies walk toward you

    private count = 1;
    private finished = false;
    private soldierModel: Node | null = null;
    private squadFormation: Node | null = null;
    private squadMembers: Node[] = [];
    private squadCamera: Camera | null = null;
    private cameraHome = new Vec3();
    private cameraRoadX = 0;
    private cameraPullback = 0;
    private previousPlayerPosition = new Vec3();
    private squadFire: SquadFire | null = null;
    private bridge: BridgeScenery | null = null;
    private nextGateZ = 0;
    private nextWave = 0;
    private startZ = 0;

    private gates: GateRow[] = [];
    private zombies: Node[] = [];
    private zombieHealth = new WeakMap<Node, number>();
    private tireReward: TireReward | null = null;
    private focusingTire = false;
    private bosses: BossEncounter[] = [];
    private readonly bossMaterials = new Map<string, Material>();

    // Shapes and colors we reuse for many objects.
    private zombieMesh: Mesh | null = null;
    private zombieMat: Material | null = null;

    start() {
        this.startZ = this.player?.position.z ?? 0;
        const openingZ = this.startZ - WARMUP_DISTANCE;
        this.nextGateZ = openingZ - 33;
        const capsuleRadius = CHARACTER_HEIGHT * 0.2;
        this.zombieMesh = utils.createMesh(primitives.capsule(capsuleRadius, capsuleRadius, CHARACTER_HEIGHT));
        this.zombieMat = this.makeMaterial('builtin-standard', 0, new Color(90, 150, 70, 255));

        const sceneryRoot = new Node('Suspension Bridge');
        this.node.addChild(sceneryRoot);
        const bridge = new BridgeScenery(sceneryRoot, this.road?.sharedMaterial ?? null);
        this.bridge = bridge;
        bridge.build(this.oceanTexture);
        if (this.road) this.road.enabled = false;
        for (const { z, left, right, enemyDepth, leftLabelOffset, rightLabelOffset } of GATE_ROWS) {
            this.addGateRow(bridge, openingZ + z, left, right, { health: 2, depth: enemyDepth, spawned: false },
                leftLabelOffset, rightLabelOffset);
        }
        const tire = bridge.numberedTarget(2.83, openingZ - 15.25, TIRE_HEALTH);
        if (this.displayRifle) {
            const display = bridge.floatingRifle(this.displayRifle, 2.12, 4.35, openingZ - 28.5);
            this.tireReward = { ...tire, health: TIRE_HEALTH, display, prefab: this.displayRifle };
        }
        this.spawnNextWave();
        this.showCount();

        // Clone just the animated model, leaving the camera and controls on the player.
        const player = this.player;
        if (!player) return;
        this.previousPlayerPosition.set(player.position);
        this.extendCourse(player.position.z);
        this.showCount();
        this.squadCamera = player.getComponentInChildren(Camera);
        if (this.squadCamera) {
            this.cameraHome.set(this.squadCamera.node.position);
            this.cameraRoadX = this.squadCamera.node.worldPosition.x;
        }

        const soldierModel = player.getComponentInChildren(SkeletalAnimation)?.node;
        if (!soldierModel || soldierModel === player) return;
        if (this.blaster && this.targetingPose) {
            const weapons = new Node('Weapons and shot effects');
            this.node.addChild(weapons);
            this.squadFire = new SquadFire(weapons, this.blaster, this.targetingPose, SOLDIER_SHOT_RANGE);
            this.squadFire.equip(soldierModel);
        }
        this.enableCharacterShadows(soldierModel);
        this.playLooping(soldierModel);

        this.soldierModel = soldierModel;
        this.squadFormation = new Node('SquadFormation');
        player.addChild(this.squadFormation);
    }

    /** Finds the animation on a character and plays its default clip over and over. */
    private playLooping(character: Node) {
        const anim = character.getComponentInChildren(SkeletalAnimation);
        if (!anim || !anim.defaultClip) return;
        anim.play(anim.defaultClip.name);
        const state = anim.getState(anim.defaultClip.name);
        if (state) {
            state.wrapMode = AnimationClip.WrapMode.Loop;
            state.time = Math.random() * state.duration; // so a crowd doesn't move in perfect sync
        }
    }

    private setSquadCount(count: number) {
        this.count = Math.max(0, Math.min(count, MAX_SQUAD_SIZE));
        this.showCount();

        const model = this.soldierModel;
        const formation = this.squadFormation;
        if (!model || !formation) return;

        const followerCount = Math.max(0, this.count - 1);
        while (this.squadMembers.length > followerCount) {
            const member = this.squadMembers.pop()!;
            this.squadFire?.unequip(member);
            member.active = false;
            member.destroy();
        }

        while (this.squadMembers.length < followerCount) {
            const index = this.squadMembers.length;
            const row = Math.floor(index / SQUAD_COLUMNS);
            const column = index % SQUAD_COLUMNS;
            // Stagger rows and give each recruit a fixed offset so the squad moves as a loose group.
            const side = column % 2 === 0 ? 1 : -1;
            const x = side * Math.ceil(column / 2) * SQUAD_SPACING_X
                + (row % 2) * SQUAD_ROW_OFFSET + this.rand(-SQUAD_JITTER_X, SQUAD_JITTER_X);
            const z = model.position.z + (row + 1) * SQUAD_SPACING_Z
                + this.rand(-SQUAD_JITTER_Z, SQUAD_JITTER_Z);
            const member = instantiate(model);
            member.setPosition(x, model.position.y, z);
            formation.addChild(member);
            this.squadFire?.equip(member);
            this.enableCharacterShadows(member);
            this.playLooping(member);
            this.squadMembers.push(member);
        }

        model.active = this.count > 0;
        if (!model.active) this.squadFire?.unequip(model);
    }

    private layoutSquad() {
        const player = this.player!;
        const runner = player.getComponent(PlayerRunner);
        const followers = this.squadMembers.length;

        // Keep the squad on the road even when its leader steers to the edge.
        const lastColumn = Math.max(0, Math.min(followers, SQUAD_COLUMNS) - 1);
        const rowOffset = followers > SQUAD_COLUMNS ? SQUAD_ROW_OFFSET : 0;
        const jitter = followers > 0 ? SQUAD_JITTER_X : 0;
        const leftWidth = Math.ceil(lastColumn / 2) * SQUAD_SPACING_X + jitter;
        const rightWidth = Math.floor(lastColumn / 2) * SQUAD_SPACING_X + jitter + rowOffset;
        const playerX = player.position.x;
        const center = runner ? Math.min(runner.roadHalfWidth - rightWidth,
            Math.max(-runner.roadHalfWidth + leftWidth, playerX)) : playerX;
        const shift = center - playerX;
        this.squadFormation?.setPosition(shift, 0, 0);

        return { left: Math.min(0, shift - leftWidth), right: Math.max(0, shift + rightWidth) };
    }

    private frameSquad(left: number, right: number, dt: number) {
        const camera = this.squadCamera;
        if (!camera) return;

        const home = this.cameraHome;
        const pitch = -camera.node.eulerAngles.x * Math.PI / 180;
        const sin = Math.sin(pitch);
        const cos = Math.cos(pitch);
        const verticalTangent = Math.tan(camera.fov * Math.PI / 360) * 0.9;
        const horizontalTangent = verticalTangent * (camera.camera.aspect || 1);
        const playerX = this.player!.worldPosition.x;
        // Follow part of the steering so the bridge stays centered and both lanes stay readable.
        const targetX = home.x + (playerX + (left + right) / 2) * 0.48;
        const blend = 1 - Math.exp(-dt * 8);
        this.cameraRoadX += (targetX - this.cameraRoadX) * blend;
        const localX = this.cameraRoadX - playerX;
        const halfWidth = Math.max(Math.abs(left - localX), Math.abs(right - localX)) + FRAME_PADDING;
        const rear = Math.ceil(this.squadMembers.length / SQUAD_COLUMNS) * SQUAD_SPACING_Z
            + SQUAD_JITTER_Z + FRAME_PADDING;
        const feet = this.soldierModel?.position.y ?? -1;
        let pullback = 0;

        // Fit the squad's padded bounds in the perspective frustum, including portrait screens.
        for (const y of [feet - 0.1, feet + CHARACTER_HEIGHT + 0.1]) {
            for (const z of [-FRAME_PADDING, rear]) {
                const depth = (home.y - y) * sin + (home.z - z) * cos;
                const height = (y - home.y) * cos - (z - home.z) * sin;
                const requiredDepth = Math.max(halfWidth / horizontalTangent, Math.abs(height) / verticalTangent);
                pullback = Math.max(pullback, requiredDepth - depth);
            }
        }
        this.cameraPullback = Math.max(pullback, this.cameraPullback * (1 - blend));
        camera.node.setPosition(localX,
            home.y + this.cameraPullback * sin, home.z + this.cameraPullback * cos);
    }

    // ---------- Building the level ----------

    private addGateRow(bridge: BridgeScenery, z: number, left: Gate['value'], right: Gate['value'],
        wave: GateRow['wave'], leftLabelOffset = 0, rightLabelOffset = 0) {
        this.gates.push({
            z, wave,
            left: { node: bridge.gate(z, -1, left, leftLabelOffset), value: left },
            right: { node: bridge.gate(z, 1, right, rightLabelOffset), value: right },
        });
    }

    private extendCourse(playerZ: number) {
        const bridge = this.bridge;
        if (!bridge) return;
        bridge.extendTo(playerZ);
        while (this.nextGateZ >= playerZ - COURSE_LOOKAHEAD) {
            const z = this.nextGateZ;
            const wave = this.nextWave++;
            this.nextGateZ -= GATE_SPACING;
            // Switch the positive lane every row to keep steering meaningful.
            const positiveOnLeft = wave % 2 === 0;
            if ((wave + 1) % 5 === 0) {
                this.addGateRow(bridge, z, positiveOnLeft ? 'double' : 2, positiveOnLeft ? 2 : 'double', null);
                this.spawnBoss(bridge, z - BOSS_OFFSET, Math.floor(wave / 5));
                continue;
            }
            const recruit = wave < 4 ? 1 + Math.floor(wave / 2) : 1 + wave % 3;
            const penalty = -recruit;
            const health = 3 + Math.min(5, Math.floor(wave / 4));
            this.addGateRow(bridge, z, positiveOnLeft ? recruit : penalty, positiveOnLeft ? penalty : recruit,
                { health, depth: 8.3, spawned: false });
        }
    }

    private spawnNextWave() {
        const gate = this.gates[0];
        const wave = gate?.wave;
        if (!wave || wave.spawned || this.count <= 0) return;
        wave.spawned = true;

        const enemies = this.count * 3;
        const columns = Math.min(8, enemies);
        const spacing = Math.min(2.25, 6.1 / (columns - 1));
        for (let i = 0; i < enemies; i++) {
            const lane = i % columns;
            const row = Math.floor(i / columns);
            const x = (lane - (columns - 1) / 2) * spacing + this.rand(-0.18, 0.18);
            const z = gate.z - wave.depth - row * 1.05 - this.rand(0, 0.65);
            this.spawnZombie(x, z, wave.health);
        }
    }

    private spawnBoss(bridge: BridgeScenery, z: number, index: number) {
        if (!this.bossPrefabs.length) return;
        const prefab = this.bossPrefabs[index % this.bossPrefabs.length];
        if (!prefab) return;

        const model = instantiate(prefab);
        const style = BOSS_MODELS[model.name];
        const title = style?.title ?? '首领';
        const scale = style?.scale ?? 0.8;
        const node = new Node(`Boss ${model.name}`);
        this.node.addChild(node);
        node.setPosition(0, 0, z);
        node.addChild(model);
        model.setScale(scale, scale, scale);
        let material = this.bossMaterials.get(model.name);
        if (style && !material) {
            material = this.makeMaterial('builtin-standard', 0, style.color);
            this.bossMaterials.set(model.name, material);
        }
        for (const renderer of model.getComponentsInChildren(MeshRenderer)) {
            renderer.shadowCastingMode = MeshRenderer.ShadowCastingMode.ON;
            if (material) renderer.setMaterial(material, 0);
        }

        const maxHealth = Math.min(320, 125 + index * 35);
        const stopZ = z + BOSS_FIGHT_DISTANCE;
        const animation = node.getComponentInChildren(SkeletalAnimation);
        this.playBossIdle(animation);
        this.bosses.push({
            node, title, maxHealth, health: maxHealth, stopZ, animation,
            warning: bridge.bossWarning(stopZ),
            label: bridge.bossLabel(node, `${title}  ${maxHealth}/${maxHealth}`),
            attackTimer: 1.1,
        });
    }

    private playBossIdle(animation: SkeletalAnimation | null) {
        const clip = animation?.clips.find(candidate => candidate.name.endsWith('|Idle'));
        if (!clip || !animation) return;
        animation.play(clip.name);
        animation.getState(clip.name).wrapMode = AnimationClip.WrapMode.Loop;
    }

    private spawnZombie(x: number, z: number, health = 3) {
        const node = new Node('Zombie');
        node.layer = Layers.Enum.DEFAULT;
        this.node.addChild(node);
        // The capsule is centered on its origin. The prefab's origin is at its feet.
        const originHeight = this.zombiePrefab ? 0 : CHARACTER_HEIGHT / 2;
        node.setPosition(x, originHeight, z);
        if (this.zombiePrefab) {
            const model = instantiate(this.zombiePrefab);
            node.addChild(model);
            model.setPosition(0, 0, 0);
            this.playLooping(model);
        } else {
            const renderer = node.addComponent(MeshRenderer);
            renderer.mesh = this.zombieMesh;
            renderer.setMaterial(this.zombieMat, 0);
        }

        this.enableCharacterShadows(node);
        this.zombieHealth.set(node, health);
        this.zombies.push(node);
    }

    // ---------- Every frame ----------

    lateUpdate(dt: number) {
        const player = this.player;
        if (!player || this.finished) return;

        this.extendCourse(player.position.z);
        const previousShift = this.squadFormation?.position.x ?? 0;
        const previousCount = this.count;
        let bounds = this.layoutSquad();
        const warmingUp = this.distance() < WARMUP_DISTANCE;
        if (this.tireReward && !this.tireReward.node.isValid) this.tireReward = null;
        const tire = warmingUp ? null : this.tireReward?.node ?? null;
        const boss = this.bosses[0];
        const fightingBoss = !!boss && player.position.z <= boss.stopZ;
        const runner = player.getComponent(PlayerRunner);
        const stopZ = tire ? tire.position.z + TIRE_STOP_DISTANCE : 0;
        const inTireLane = !!tire?.activeInHierarchy && player.position.x >= tire.position.x - 1.45 &&
            player.position.z > tire.position.z + 1;
        this.focusingTire = inTireLane && player.position.z <= stopZ;
        const forwardLimitZ = inTireLane ? stopZ : boss?.stopZ;
        if (runner) runner.forwardLimitZ = forwardLimitZ === undefined ? null : Math.min(player.position.z, forwardLimitZ);
        if (!warmingUp) {
            if (!this.focusingTire && !fightingBoss) this.moveZombies(dt, previousShift);
            if (this.count > 0) this.checkGates();
        }
        if (this.count !== previousCount) bounds = this.layoutSquad();
        this.squadFire?.update(dt, warmingUp ? [] : this.zombies, tire, this.focusingTire,
            (target, damage) => this.hitTarget(target, damage), fightingBoss ? boss.node : null);
        if (fightingBoss && this.bosses[0] === boss && this.count > 0) {
            const countBeforeAttack = this.count;
            this.updateBossAttack(boss, dt);
            if (this.count !== countBeforeAttack) bounds = this.layoutSquad();
        }
        this.frameSquad(bounds.left, bounds.right, dt);
        this.previousPlayerPosition.set(player.position);

        if (this.count <= 0) this.endGame();
        else this.showCount();
    }

    private hitTarget(target: Node, damage: number) {
        if (this.finished || !target.activeInHierarchy) return;
        const boss = this.bosses[0];
        if (boss?.node === target) {
            boss.health = Math.max(0, boss.health - damage);
            boss.label.string = `${boss.title}  ${boss.health}/${boss.maxHealth}`;
            if (boss.health === 0) {
                this.bosses.shift();
                boss.warning.destroy();
                boss.label.node.active = false;
                const death = boss.animation?.clips.find(clip => clip.name.endsWith('|Death'));
                if (death && boss.animation) {
                    boss.animation.play(death.name);
                    this.scheduleOnce(() => boss.node.destroy(), death.duration);
                } else boss.node.destroy();
            }
            return;
        }
        const reward = this.tireReward;
        if (reward?.node === target) {
            reward.health = Math.max(0, reward.health - damage);
            reward.label.string = String(reward.health);
            if (reward.health > 0) return;

            this.tireReward = null;
            target.active = false;
            target.destroy();
            reward.display.active = false;
            reward.display.destroy();
            this.squadFire?.upgrade(reward.prefab);
            return;
        }

        const previousHealth = this.zombieHealth.get(target);
        if (previousHealth === undefined) return;
        const health = previousHealth - damage;
        this.zombieHealth.set(target, health);
        if (health > 0) return;
        const index = this.zombies.indexOf(target);
        if (index >= 0) this.removeZombie(index);
    }

    private updateBossAttack(boss: BossEncounter, dt: number) {
        boss.attackTimer -= dt;
        if (boss.attackTimer > 0) return;
        const playerSide = this.player!.position.x < 0 ? -1 : 1;
        if (!boss.warning.active) {
            boss.warning.setPosition(playerSide * 2, 0, boss.stopZ);
            boss.warning.active = true;
            boss.attackTimer = 1;
            return;
        }

        const attackSide = Math.sign(boss.warning.position.x);
        boss.warning.active = false;
        boss.attackTimer = 1.7;
        const punch = boss.animation?.clips.find(clip => clip.name.endsWith('|Punch'));
        if (punch && boss.animation) {
            boss.animation.play(punch.name);
            this.scheduleOnce(() => {
                if (boss.health > 0) this.playBossIdle(boss.animation);
            }, punch.duration);
        }
        if (playerSide === attackSide) this.setSquadCount(this.count - 2);
    }

    private removeZombie(index: number) {
        const zombie = this.zombies[index];
        zombie.active = false;
        zombie.destroy();
        this.zombies.splice(index, 1);
    }

    private enableCharacterShadows(node: Node) {
        for (const renderer of node.getComponentsInChildren(MeshRenderer)) {
            renderer.shadowCastingMode = MeshRenderer.ShadowCastingMode.ON;
        }
    }

    /** Did we just run through a row of gates? */
    private checkGates() {
        const p = this.player!.position;
        const previous = this.previousPlayerPosition;
        while (this.count > 0 && this.gates.length && p.z <= this.gates[0].z) {
            const row = this.gates.shift()!;
            const travel = previous.z - p.z;
            const fraction = travel > 0 ? Math.min(1, Math.max(0, (previous.z - row.z) / travel)) : 1;
            const crossingX = previous.x + (p.x - previous.x) * fraction;
            const gate = crossingX < 0 ? row.left : row.right;
            this.setSquadCount(gate.value === 'double' ? this.count * 2 : this.count + gate.value);
            row.left.node.destroy();
            row.right.node.destroy();
        }
        this.spawnNextWave();
    }

    private moveZombies(dt: number, previousShift: number) {
        const p = this.player!.position;
        const previous = this.previousPlayerPosition;
        const shift = this.squadFormation?.position.x ?? 0;
        const leader = this.soldierModel?.position;
        const rear = Math.ceil(this.squadMembers.length / SQUAD_COLUMNS) * SQUAD_SPACING_Z;
        const behindCamera = previous.z + Math.max(rear + 1, this.squadCamera?.node.position.z ?? 10);
        const casualties = new Set<number>(); // -1 is the leader; other indices are follower slots.
        const firstGateZ = this.startZ - WARMUP_DISTANCE + GATE_ROWS[0].z;
        // Let the player reach the first recruit gate while aiming at the tire.
        const advanceLimit = this.gates[0]?.z === firstGateZ ? firstGateZ - 2.4 : Infinity;

        for (let i = this.zombies.length - 1; i >= 0; i--) {
            const zombie = this.zombies[i];
            const { x, y, z } = zombie.position;
            if (z > behindCamera) {
                this.removeZombie(i);
                continue;
            }
            if (p.z - z >= 30) continue;

            const dx = p.x - x;
            const nextX = x + Math.sign(dx) * Math.min(Math.abs(dx), 0.8 * dt);
            const nextZ = Math.min(z + this.zombieSpeed * dt, advanceLimit);
            zombie.setPosition(nextX, y, nextZ);

            const startX = x - previous.x;
            const startZ = z - previous.z;
            const endX = nextX - p.x;
            const endZ = nextZ - p.z;
            const leadX = leader?.x ?? 0;
            const leadZ = leader?.z ?? 0;
            let first = casualties.has(-1) ? Infinity : this.contactTime(
                startX - leadX, startZ - leadZ, endX - leadX, endZ - leadZ);
            let hit = -1;
            for (let j = 0; j < this.squadMembers.length && first > 0; j++) {
                if (casualties.has(j)) continue;
                const slot = this.squadMembers[j].position;
                const time = this.contactTime(startX - previousShift - slot.x, startZ - slot.z,
                    endX - shift - slot.x, endZ - slot.z);
                if (time < first) {
                    first = time;
                    hit = j;
                }
            }
            if (first <= 1) {
                casualties.add(hit);
                this.removeZombie(i);
            }
        }

        if (!casualties.size) return;
        // Keep slots fixed while testing contacts, then fill holes with soldiers from the rear.
        for (const index of [...casualties].sort((a, b) => b - a)) this.removeSoldier(index);
        this.setSquadCount(this.count - casualties.size);
    }

    /** Earliest overlap during the frame, using the zombie's motion relative to a soldier. */
    private contactTime(startX: number, startZ: number, endX: number, endZ: number) {
        const separation = startX * startX + startZ * startZ - CONTACT_DISTANCE * CONTACT_DISTANCE;
        if (separation <= 0) return 0;
        const dx = endX - startX;
        const dz = endZ - startZ;
        const approach = startX * dx + startZ * dz;
        if (approach >= 0) return Infinity;
        const speedSquared = dx * dx + dz * dz;
        const discriminant = approach * approach - speedSquared * separation;
        if (discriminant < 0) return Infinity;
        return (-approach - Math.sqrt(discriminant)) / speedSquared;
    }

    private removeSoldier(index: number) {
        const member = index < 0 ? this.soldierModel : this.squadMembers[index];
        if (!member) return;
        this.squadFire?.unequip(member);
        const tail = this.squadMembers.pop();
        if (index < 0) {
            this.soldierModel = tail ?? null;
            if (tail) {
                tail.setParent(this.player);
                tail.setPosition(member.position);
            }
        } else if (tail && tail !== member) {
            tail.setPosition(member.position);
            this.squadMembers[index] = tail;
        }
        member.active = false;
        member.destroy();
    }

    // ---------- Helpers ----------

    private showCount() {
        const label = this.countLabel;
        if (!label) return;
        const boss = this.bosses[0];
        if (boss && this.player && this.player.position.z <= boss.stopZ) {
            const hint = boss.warning.active ? (boss.warning.position.x < 0 ? '向右闪避' : '向左闪避') : '首领战';
            label.string = `${hint}   ·   队伍 ${this.count}/${MAX_SQUAD_SIZE}`;
            return;
        }
        const text = this.focusingTire && this.tireReward
            ? `轮胎 ${this.tireReward.health}   ·   左移继续`
            : `无尽   ·   队伍 ${this.count}/${MAX_SQUAD_SIZE}   ·   ${this.distance()} m`;
        if (label.string !== text) label.string = text;
    }

    private distance() {
        return Math.max(0, Math.floor(this.startZ - (this.player?.position.z ?? this.startZ)));
    }

    private endGame() {
        this.finished = true;
        const runner = this.player?.getComponent(PlayerRunner);
        if (runner) runner.enabled = false; // stop running
        const leaderAnimation = this.soldierModel?.getComponent(SkeletalAnimation)
            ?? this.player?.getComponent(SkeletalAnimation);
        leaderAnimation?.stop();
        for (const member of this.squadMembers) member.getComponent(SkeletalAnimation)?.stop();
        if (this.countLabel) this.countLabel.string = `挑战结束   ·   跑了 ${this.distance()} m`;
        this.showRestartButton();
    }

    private showRestartButton() {
        const scene = this.node.scene;
        const canvas = scene?.getComponentInChildren(Canvas);
        if (!canvas || !scene) return;

        const node = new Node('Restart Button');
        node.layer = Layers.Enum.UI_2D;
        canvas.node.addChild(node);
        node.setPosition(0, -100, 0);
        node.addComponent(UITransform).setContentSize(296, 90);

        const background = node.addComponent(Graphics);
        background.fillColor = new Color(19, 43, 33);
        background.roundRect(-148, -45, 296, 90, 19);
        background.fill();
        background.fillColor = new Color(38, 151, 78);
        background.roundRect(-144, -39, 288, 80, 15);
        background.fill();

        const text = new Node('Restart Text');
        text.layer = node.layer;
        node.addChild(text);
        const label = text.addComponent(Label);
        label.string = '复活重来';
        label.fontSize = 36;
        label.lineHeight = 44;
        label.isBold = true;

        const button = node.addComponent(Button);
        node.on(Button.EventType.CLICK, () => {
            button.interactable = false;
            const loading = director.loadScene(scene.name, (error) => {
                if (error) button.interactable = true;
            });
            if (!loading) button.interactable = true;
        });
    }

    private makeMaterial(effectName: string, technique: number, color: Color) {
        const mat = new Material();
        mat.initialize({ effectName, technique });
        mat.setProperty('mainColor', color);
        return mat;
    }

    private rand(min: number, max: number) {
        return min + Math.random() * (max - min);
    }
}
