import { _decorator, Component, Node, Label, Color, Material, MeshRenderer, primitives, utils, Layers, Mesh, Prefab, instantiate, SkeletalAnimation, AnimationClip, Camera, Texture2D, Vec3, Button, Canvas, Graphics, UITransform, Widget, director, assetManager } from 'cc';
import { BridgeScenery } from './BridgeScenery';
import { PlayerRunner } from './PlayerRunner';
import { SquadFire } from './SquadFire';
import { GameAudio } from './GameAudio';
const { ccclass, property } = _decorator;

const SQUAD_COLUMNS = 3;
const SQUAD_SPACING_X = 0.56;
const SQUAD_SPACING_Z = 0.60;
// Matches the standing height authored in main.scene and Zombie.prefab (8-unit road).
const CHARACTER_HEIGHT = 0.8;
const CONTACT_DISTANCE = 0.36;
const FRAME_PADDING = 0.45;
const COURSE_LOOKAHEAD = 85;
const SOLDIER_SHOT_RANGE = 28.5; // Keep combat range independent of randomized gate spacing.
const MAX_SQUAD_SIZE = 9;
const WARMUP_DISTANCE = 10;
const ZOMBIE_BASE_HP = 1; // One base-gun bullet is one HP, regardless of weapon upgrades.
const ZOMBIE_METERS_PER_HP = 100;
const MAX_LIVING_ZOMBIES = 960;
const ZOMBIE_COLUMNS = 8;
const ZOMBIE_ROW_SPACING = 2;
const ZOMBIE_INITIAL_DISTANCE = 48;
const ZOMBIE_LOOKAHEAD = 212;
const ZOMBIE_REVEAL_DISTANCE = 196; // New rows are invisible until they cross this local horde boundary.
const ZOMBIE_MODEL_DISTANCE = 36;
const MAX_ZOMBIE_ROWS_PER_FRAME = 2;
const EARLY_TIRE_ROUNDS = [1, 3, 5, 8, 11, 15];
const DUAL_PENALTY_DISTANCE = 300;
const TIRE_COLLISION_RADIUS = 1.05; // Tire radius plus a soldier's collision radius.
const BOSS_ACTIVATION_DISTANCE = 24;
const BOSS_MELEE_DEPTH = 2.2;
const BOSS_MELEE_WIDTH = 1.4;
const BOSS_RETREAT_DISTANCE = 6;
const BOSS_APPROACH_SPEED = 6;
const BOSS_RETREAT_SPEED = 7;
const BOSS_WINDUP = 0.8;
const BOSS_MODELS: Record<string, { title: string; scale: number; color: Color }> = {
    MushroomKing: { title: '蘑菇王', scale: 0.79, color: new Color(233, 111, 63) },
    Orc_Skull: { title: '骷髅兽人', scale: 0.87, color: new Color(173, 190, 113) },
    BlueDemon: { title: '蓝魔', scale: 0.56, color: new Color(59, 160, 238) },
};
const GATE_ROWS = [
    { z: -7 },
    { z: -16, leftLabelOffset: -0.28, rightLabelOffset: -0.92 },
];

/** One gate panel on the road, like "+6" or "−1". */
interface Gate {
    node: Node;
    value: number | 'double' | 'halve';
}

interface GateRow {
    z: number;
    left: Gate;
    right: Gate;
}

interface TireReward {
    node: Node;
    label: Label;
    health: number | null; // Snapshotted only when the first aimed bullet is launched.
    challengeSeconds: number;
    aimRange: number;
    collided: boolean;
    display: Node | null;
    previewDamage: number;
}

interface BossEncounter {
    node: Node;
    warning: Node;
    label: Label;
    animation: SkeletalAnimation | null;
    title: string;
    health: number;
    maxHealth: number;
    phase: 'waiting' | 'approach' | 'windup' | 'retreat';
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
    @property({ min: 1, step: 1 }) tireCollisionLoss = 3;
    @property({ min: 1, step: 1, tooltip: 'Initial ordinary zombie kill goal; doubles after each boss defeat.' }) bossKillsRequired = 150;

    private count = 1;
    private finished = false;
    private restarting = false;
    private restartButtons: Button[] = [];
    private audio: GameAudio | null = null;
    private soundButton: Button | null = null;
    private soundIcon: Graphics | null = null;
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
    private nextCourseRow = 0;
    private nextZombieRowZ: number | null = null;
    private initialHordeReady = false;
    private zombieRow = 0;
    private zombieKills = 0;
    private startZ = 0;

    private gates: GateRow[] = [];
    private zombies: Node[] = [];
    private zombieHealth = new WeakMap<Node, number>();
    private tireRewards: TireReward[] = [];
    private gateRound = 0;
    private rewardIndex = 0;
    private bosses: BossEncounter[] = [];
    private bossCharge = 0;
    private bossGoal: number | null = null;
    private bossChargeBlockedThisFrame = false;
    private bossMeter: Node | null = null;
    private bossMeterCanvas: UITransform | null = null;
    private bossMeterFill: Graphics | null = null;
    private bossMeterLabel: Label | null = null;
    private bossMeterWidth = 0;
    private bossMeterHeight = 0;
    private bossMeterShown = 0;
    private bossMeterDrawn = -1;
    private bossEncounterIndex = 0;
    private nextSurvivorDistance = 0;
    private survivor: Node | null = null;
    private survivorMaterial: Material | null = null;
    private survivorRescueTime = Infinity;
    private damageBuffTime = 0;
    private hasteBuffTime = 0;
    private shieldCharges = 0;
    private buffFXRoot: Node | null = null;
    private hasteFX: Node | null = null;
    private shieldFX: Node | null = null;
    private shieldBurstFX: Node | null = null;
    private upgradeFX: Node | null = null;
    // At most five categories, merged within the same two-second presentation.
    private upgradeTitles = new Map<number, string>();
    private upgradeRecruits = 0;
    private buffStars: Node[] = [];
    private buffFXMaterials: Material[] = [];
    private buffFXMeshes: Mesh[] = [];
    private buffFXPhase = 0;
    private buffStarTime = 0;
    private shieldBurstTime = 0;
    private buffToast: Node | null = null;
    private buffToastLabel: Label | null = null;
    private buffToastIcon: Graphics | null = null;
    private buffToastTime = 0;
    private readonly bossMaterials = new Map<string, Material>();

    // Shapes and colors we reuse for many objects.
    private zombieMesh: Mesh | null = null;
    private zombieMat: Material | null = null;
    private readonly zombieProxies = new Map<Node, MeshRenderer>();
    private readonly zombieFadeBuckets = new WeakMap<Node, number>();
    private readonly zombieFadeMaterials: Material[] = [];

    start() {
        // Override Creator's default tab title in both preview and exported web games.
        if (typeof document !== 'undefined') document.title = "David's Game";
        this.audio = this.node.addComponent(GameAudio);
        this.bossGoal = this.initialBossGoal;
        this.createRestartIcon();
        this.createSoundButton();
        this.createBossMeter();
        const runner = this.player?.getComponent(PlayerRunner);
        if (runner) runner.isUIInput = event => {
            const soundButton = this.soundButton;
            return (!!soundButton?.isValid && soundButton.node.activeInHierarchy
                && soundButton.node.getComponent(UITransform)!.hitTest(event.getLocation(), event.windowId))
                || this.restartButtons.some(button => button.isValid && button.node.activeInHierarchy
                    && button.node.getComponent(UITransform)!.hitTest(event.getLocation(), event.windowId));
        };
        this.startZ = this.player?.position.z ?? 0;
        this.nextSurvivorDistance = this.rand(50, 100);
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
        for (const { z, leftLabelOffset, rightLabelOffset } of GATE_ROWS) {
            const [left, right] = this.randomGateValues(openingZ + z, false, true);
            this.addGateRow(bridge, openingZ + z, left, right, leftLabelOffset, rightLabelOffset);
        }
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
            this.squadFire = new SquadFire(weapons, this.blaster, this.targetingPose, SOLDIER_SHOT_RANGE,
                () => this.audio?.play('shot'));
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

    private setSquadCount(count: number, penalizeFirepower = true) {
        const previous = this.count;
        this.count = Math.max(0, Math.min(count, MAX_SQUAD_SIZE));
        if (this.count !== previous) this.audio?.play(this.count > previous ? 'recruit' : 'loss');
        if (this.count < previous && penalizeFirepower) {
            this.squadFire?.decreaseDamage(); // Combat losses penalize firepower; gate costs do not.
            this.refreshRewardPreviews();
        }
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
            const member = instantiate(model);
            formation.addChild(member);
            this.squadFire?.equip(member);
            this.enableCharacterShadows(member);
            this.playLooping(member);
            this.squadMembers.push(member);
        }

        // Slot zero is the leader: center/left/right, then the next row. Repack after
        // losses too, so replacing a fallen leader or filling a hole never leaves gaps.
        for (let i = 0; i < this.squadMembers.length; i++) {
            const slot = i + 1;
            const column = slot % SQUAD_COLUMNS;
            const x = column === 0 ? 0 : column === 1 ? -SQUAD_SPACING_X : SQUAD_SPACING_X;
            this.squadMembers[i].setPosition(model.position.x + x, model.position.y,
                model.position.z + Math.floor(slot / SQUAD_COLUMNS) * SQUAD_SPACING_Z);
        }

        model.active = this.count > 0;
        if (!model.active) this.squadFire?.unequip(model);
        if (this.count > previous && !this.finished) {
            this.upgradeRecruits = (this.buffToastTime > 0 && this.upgradeTitles.has(-2) ? this.upgradeRecruits : 0) + this.count - previous;
            this.showUpgrade(-2, `队伍壮大 +${this.upgradeRecruits}`);
        }
    }

    private layoutSquad() {
        const player = this.player!;
        const runner = player.getComponent(PlayerRunner);
        const leaderX = this.soldierModel?.position.x ?? 0;
        const left = leaderX - (this.squadMembers.length >= 1 ? SQUAD_SPACING_X : 0);
        const right = leaderX + (this.squadMembers.length >= 2 ? SQUAD_SPACING_X : 0);

        // Clamp the whole squad, leader included. A follower-only shift collapses
        // front-row slots at the road edge and disagrees with collision positions.
        const center = runner ? Math.min(runner.roadHalfWidth - right,
            Math.max(-runner.roadHalfWidth - left, player.position.x)) : player.position.x;
        player.setPosition(center, player.position.y, player.position.z);
        this.squadFormation?.setPosition(0, 0, 0);
        return { left, right };
    }

    private squadRearExtent() {
        return (this.soldierModel?.position.z ?? 0)
            + Math.floor(this.squadMembers.length / SQUAD_COLUMNS) * SQUAD_SPACING_Z;
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
        const rear = this.squadRearExtent() + FRAME_PADDING;
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
        leftLabelOffset = 0, rightLabelOffset = 0) {
        const round = ++this.gateRound;
        if (EARLY_TIRE_ROUNDS.indexOf(round) >= 0 || (round >= 20 && round % 5 === 0)) {
            const index = this.rewardIndex++;
            const challengeSeconds = index < 3 ? Math.round(this.rand(1, 2) * 10) / 10
                : [3.5, 4, 5, 6, 7, 8][Math.min(index - 3, 5)];
            // Budget a second for cooldown/projectile arrival plus front/rear formation clearance.
            // Only this reward's aiming range grows; enemy/boss ranges and running speed stay unchanged.
            const speed = this.player?.getComponent(PlayerRunner)?.speed ?? 4.5;
            const aimRange = Math.min(COURSE_LOOKAHEAD, Math.max(16, (challengeSeconds + 1) * speed + 2.25));
            // Sample once; keep center clear and the halo inside the curb.
            const x = (this.rand(0, 1) < 0.5 ? -1 : 1) * this.rand(1.9, 2.6);
            // Fits even the 9-unit opening gap, with at least 3 units to the next gate.
            const tireZ = z - this.rand(4, 6);
            // Without shooting assets there is no earnable reward; don't leave an inert obstacle.
            if (this.blaster && this.targetingPose) {
                const tire = bridge.numberedTarget(x, tireZ, '');
                const previewDamage = this.squadFire?.rewardDamage() ?? 2;
                const display = bridge.floatingRifle(this.displayRifle ?? this.blaster,
                    x, 2.2, tireZ - 0.6, previewDamage);
                this.tireRewards.push({ ...tire, health: null, challengeSeconds, aimRange, collided: false, display, previewDamage });
            }
        }
        this.gates.push({
            z,
            left: { node: bridge.gate(z, -1, left, leftLabelOffset), value: left },
            right: { node: bridge.gate(z, 1, right, rightLabelOffset), value: right },
        });
    }

    private randomGateValues(z: number, bonus = false, tutorial = false): [Gate['value'], Gate['value']] {
        const recruit = 1 + Math.floor(this.rand(0, tutorial ? 2 : 3));
        const penalty = () => -(1 + Math.floor(this.rand(0, 3)));
        let first: Gate['value'] = bonus ? 'double' : recruit;
        let second: Gate['value'] = bonus ? recruit : tutorial ? -1 : penalty();
        // Use the gate's road distance, not the player's distance when lookahead generates it.
        if (!tutorial && !bonus && this.startZ - z >= DUAL_PENALTY_DISTANCE && this.rand(0, 1) < 0.4) {
            first = penalty();
            second = this.rand(0, 1) < 0.5 ? 'halve' : penalty();
        }
        return this.rand(0, 1) < 0.5 ? [first, second] : [second, first];
    }

    private extendCourse(playerZ: number) {
        const bridge = this.bridge;
        if (!bridge) return;
        bridge.extendTo(playerZ);
        while (this.nextGateZ >= playerZ - COURSE_LOOKAHEAD) {
            const z = this.nextGateZ;
            const row = this.nextCourseRow++;
            this.nextGateZ -= this.rand(17, 22);
            const [left, right] = this.randomGateValues(z, (row + 1) % 5 === 0);
            this.addGateRow(bridge, z, left, right);
        }
    }

    private get currentZombieHP() {
        return ZOMBIE_BASE_HP + Math.floor(this.distance() / ZOMBIE_METERS_PER_HP);
    }

    /** Populate road coordinates, not a timed emission rate. Only two whole rows may be built per frame. */
    private updateZombieHorde(fightingBoss: boolean) {
        if (!this.player || this.finished || this.count <= 0 || fightingBoss) return;
        const pz = this.player.position.z;
        if (this.nextZombieRowZ === null) this.nextZombieRowZ = this.startZ - ZOMBIE_INITIAL_DISTANCE;
        // Initial coverage is laid out at load, safely beyond the opening gates. Later backfill is hidden.
        const minimumDistance = this.initialHordeReady ? ZOMBIE_REVEAL_DISTANCE + 1 : ZOMBIE_INITIAL_DISTANCE;
        this.nextZombieRowZ = Math.min(this.nextZombieRowZ, pz - minimumDistance);
        for (let row = 0; row < MAX_ZOMBIE_ROWS_PER_FRAME
            && this.nextZombieRowZ >= pz - ZOMBIE_LOOKAHEAD
            && this.zombies.length + ZOMBIE_COLUMNS <= MAX_LIVING_ZOMBIES; row++) {
            const stagger = (this.zombieRow++ % 2 ? 1 : -1) * 0.14;
            for (let column = 0; column < ZOMBIE_COLUMNS; column++) {
                const x = (column - (ZOMBIE_COLUMNS - 1) / 2) * 0.88 + stagger + this.rand(-0.05, 0.05);
                this.spawnZombie(x, this.nextZombieRowZ - this.rand(0, 0.35));
            }
            this.nextZombieRowZ -= ZOMBIE_ROW_SPACING;
        }
        if (this.nextZombieRowZ < pz - ZOMBIE_LOOKAHEAD) this.initialHordeReady = true;
        this.updateZombieAppearance();
    }

    /** Retain the far crowd during a running boss fight, with a clear approach corridor on resume. */
    private carryDistantHorde() {
        const travel = this.previousPlayerPosition.z - this.player!.position.z;
        for (let i = this.zombies.length - 1; i >= 0; i--) {
            const zombie = this.zombies[i];
            if (this.previousPlayerPosition.z - zombie.position.z < ZOMBIE_INITIAL_DISTANCE) {
                this.removeZombie(i); // Encounter clearance is not a kill.
                continue;
            }
            zombie.setPosition(zombie.position.x, zombie.position.y, zombie.position.z - travel);
        }
        if (this.nextZombieRowZ !== null) this.nextZombieRowZ -= travel;
    }

    /** Shared distant proxies fade across 24 units; only nearby zombies pay for animated models. */
    private updateZombieAppearance() {
        let promotions = 0;
        for (const [node, renderer] of this.zombieProxies) {
            const depth = this.player!.position.z - node.position.z;
            if (this.zombiePrefab && depth <= ZOMBIE_MODEL_DISTANCE && promotions < 4) {
                renderer.destroy();
                this.zombieProxies.delete(node);
                const model = instantiate(this.zombiePrefab);
                node.addChild(model);
                model.setPosition(0, 0, 0);
                node.setPosition(node.position.x, 0, node.position.z);
                this.playLooping(model);
                this.enableCharacterShadows(model);
                promotions++;
                continue;
            }
            const bucket = Math.max(0, Math.min(8, Math.ceil((ZOMBIE_REVEAL_DISTANCE - depth) / 3)));
            if (this.zombieFadeBuckets.get(node) === bucket) continue;
            this.zombieFadeBuckets.set(node, bucket);
            renderer.enabled = bucket > 0;
            if (bucket === 8) renderer.setMaterial(this.zombieMat, 0);
            else if (bucket > 0) {
                if (!this.zombieFadeMaterials[bucket]) {
                    this.zombieFadeMaterials[bucket] = this.makeMaterial('builtin-standard', 1,
                        new Color(90, 150, 70, Math.round(255 * bucket / 8)));
                }
                renderer.setMaterial(this.zombieFadeMaterials[bucket], 0);
            }
        }
    }

    private spawnBoss(bridge: BridgeScenery, z: number) {
        // A full charge is consumed only by an actual boss kill; never queue a backlog.
        if (this.finished || this.count <= 0 || !this.bossPrefabs.length || this.bosses.length
            || this.bossCharge < this.bossKillTarget) return;
        const index = this.bossEncounterIndex;
        const prefab = this.bossPrefabs[index % this.bossPrefabs.length];
        if (!prefab) return;
        this.bossEncounterIndex++;

        const model = instantiate(prefab);
        const style = BOSS_MODELS[model.name];
        const title = style?.title ?? '首领';
        const scale = style?.scale ?? 0.8;
        const node = new Node(`Boss ${model.name}`);
        this.node.addChild(node);
        node.setPosition(0, 0, z);
        // Queue encounters invisibly: a long running fight must not overlap a later boss.
        node.active = false;
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

        const maxHealth = Math.min(3200, 1250 + index * 350);
        const animation = node.getComponentInChildren(SkeletalAnimation);
        const warning = bridge.bossWarning(z);
        warning.setScale(BOSS_MELEE_WIDTH / 1.975, 1, BOSS_MELEE_DEPTH * 2 / 5);
        this.bosses.push({
            node, title, maxHealth, health: maxHealth, animation, phase: 'waiting',
            warning,
            label: bridge.bossLabel(node, `${title}  ${maxHealth}/${maxHealth}`),
            attackTimer: 0,
        });
    }

    private playBossIdle(animation: SkeletalAnimation | null) {
        const clip = animation?.clips.find(candidate => candidate.name.endsWith('|Idle'));
        if (!clip || !animation) return;
        animation.play(clip.name);
        const state = animation.getState(clip.name);
        if (state) state.wrapMode = AnimationClip.WrapMode.Loop;
    }

    private spawnZombie(x: number, z: number, health = this.currentZombieHP) {
        const node = new Node('Zombie');
        node.layer = Layers.Enum.DEFAULT;
        this.node.addChild(node);
        // The capsule is centered on its origin. The prefab's origin is at its feet.
        const detailed = !!this.zombiePrefab && !!this.player
            && this.player.position.z - z <= ZOMBIE_MODEL_DISTANCE;
        const originHeight = detailed ? 0 : CHARACTER_HEIGHT / 2;
        node.setPosition(x, originHeight, z);
        if (detailed) {
            const model = instantiate(this.zombiePrefab!);
            node.addChild(model);
            model.setPosition(0, 0, 0);
            this.playLooping(model);
            this.enableCharacterShadows(node);
        } else {
            const renderer = node.addComponent(MeshRenderer);
            renderer.mesh = this.zombieMesh;
            renderer.setMaterial(this.zombieMat, 0);
            // Far-frontier rows are never rendered on the frame they are created.
            renderer.enabled = !!this.player && this.player.position.z - z < ZOMBIE_REVEAL_DISTANCE;
            this.zombieProxies.set(node, renderer);
        }

        this.zombieHealth.set(node, health);
        this.zombies.push(node);
    }

    // ---------- Every frame ----------

    lateUpdate(dt: number) {
        const player = this.player;
        if (!player || this.finished) return;

        // Materialize only at the next frame boundary, never inside a projectile callback.
        this.bossChargeBlockedThisFrame = this.bosses.length > 0;
        if (this.bridge && this.bossCharge >= this.bossKillTarget && !this.bosses.length) {
            this.spawnBoss(this.bridge, player.position.z - BOSS_ACTIVATION_DISTANCE);
        }
        this.extendCourse(player.position.z);
        const previousShift = this.squadFormation?.position.x ?? 0;
        const previousCount = this.count;
        let bounds = this.layoutSquad();
        const warmingUp = this.distance() < WARMUP_DISTANCE;

        const boss = this.bosses[0];
        if (boss?.phase === 'waiting'
            && player.position.z - boss.node.position.z <= BOSS_ACTIVATION_DISTANCE) {
            boss.phase = 'approach';
            boss.node.active = true;
            this.audio?.play('boss-intro');
            this.playBossIdle(boss.animation);
            // A queued encounter may have been passed during a long fight. Start it safely ahead.
            if (player.position.z - boss.node.position.z < BOSS_ACTIVATION_DISTANCE) {
                boss.node.setPosition(boss.node.position.x, 0, player.position.z - BOSS_ACTIVATION_DISTANCE);
            }
        }
        const fightingBoss = !!boss && boss.phase !== 'waiting';
        this.updateRescueBuffs(dt);
        this.updateSurvivorSchedule(fightingBoss);
        this.survivorRescueTime = this.survivor ? this.survivorContactTime(this.survivor) : Infinity;
        const runner = player.getComponent(PlayerRunner);
        if (runner) runner.forwardLimitZ = null; // A running fight never changes the authored speed.
        if (!warmingUp) {
            if (fightingBoss) this.carryDistantHorde();
            else this.moveZombies(dt, previousShift);
            this.checkPathEvents(previousShift);
            if (this.survivor && this.survivorRescueTime <= 1 && this.count > 0) this.rescueSurvivor();
        }
        // Spawn after swept movement: new arrivals were not present at the frame's old position.
        this.updateZombieHorde(fightingBoss);
        if (this.count !== previousCount) bounds = this.layoutSquad();
        this.cleanupTireRewards();
        if (this.count > 0) this.squadFire?.update(dt, warmingUp ? [] : this.zombies,
            warmingUp ? [] : this.tireRewards.map(reward => reward.node),
            (target, damage) => this.hitTarget(target, damage), fightingBoss ? boss.node : null,
            target => this.tireRewards.find(reward => reward.node === target)?.aimRange ?? 16,
            target => this.lockRewardHealth(target, dt));
        if (fightingBoss && this.bosses[0] === boss && this.count > 0) {
            const countBeforeAttack = this.count;
            this.updateBossAttack(boss, dt);
            if (this.count !== countBeforeAttack) bounds = this.layoutSquad();
        }
        this.updateBuffEffects(dt);
        this.frameSquad(bounds.left, bounds.right, dt);
        this.previousPlayerPosition.set(player.position);

        if (this.count <= 0) this.endGame();
        else this.showCount();
    }

    private lockRewardHealth(target: Node, dt: number) {
        const reward = this.tireRewards.find(candidate => candidate.node === target);
        if (!reward || reward.health !== null || !this.squadFire || this.count <= 0) return;
        // Whole current squad, including temporary damage/haste. At most one bullet per
        // soldier per frame: account for that ceiling on slow frames (e.g. haste at 30Hz).
        const interval = Math.max(this.squadFire.shotInterval(true), dt);
        const dps = this.count * this.squadFire.shotDamage / interval;
        reward.health = Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, Math.ceil(dps * reward.challengeSeconds)));
        reward.label.string = String(reward.health);
    }

    private hitTarget(target: Node, damage: number) {
        if (this.finished || !target.isValid || !target.activeInHierarchy) return;
        this.audio?.play('hit');
        const boss = this.bosses[0];
        if (boss?.node === target) {
            boss.health = Math.max(0, boss.health - damage);
            boss.label.string = `${boss.title}  ${boss.health}/${boss.maxHealth}`;
            if (boss.health === 0) {
                this.audio?.play('boss-win');
                this.bosses.shift();
                this.bossGoal = Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(this.bossKillTarget * 2));
                this.bossCharge = 0;
                this.bossChargeBlockedThisFrame = true;
                this.bossMeterShown = 0;
                boss.warning.active = false;
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
        const reward = this.tireRewards.find(candidate => candidate.node === target);
        if (reward) {
            if (reward.health === null) return; // No stray/delayed impact can initialize a future reward.
            reward.health = Math.max(0, reward.health - damage);
            reward.label.string = String(reward.health);
            if (reward.health > 0) return;

            this.removeTireReward(reward);
            const previousDamage = this.squadFire?.currentDamage ?? 1;
            this.squadFire?.upgrade(this.displayRifle);
            const upgradedDamage = this.squadFire?.currentDamage ?? 1;
            if (upgradedDamage > previousDamage) {
                this.audio?.play('upgrade');
                this.showUpgrade(-1, `武器升级 · 火力 ${upgradedDamage}`);
            }
            this.refreshRewardPreviews();
            this.showCount();
            return;
        }

        const previousHealth = this.zombieHealth.get(target);
        if (previousHealth === undefined) return;
        const health = previousHealth - damage;
        this.zombieHealth.set(target, health);
        if (health > 0) return;
        const index = this.zombies.indexOf(target);
        if (index >= 0) {
            this.zombieKills++;
            if (!this.bosses.length && !this.bossChargeBlockedThisFrame) {
                this.bossCharge = Math.min(this.bossKillTarget, this.bossCharge + 1);
            }
            this.removeZombie(index);
        }
    }

    private refreshRewardPreviews() {
        for (const reward of this.tireRewards) {
            const damage = this.squadFire?.rewardDamage() ?? 2;
            if (reward.previewDamage === damage) continue;
            reward.previewDamage = damage;
            if (reward.display?.isValid) this.bridge?.updateRewardDisplay(reward.display, damage);
        }
    }

    private removeTireReward(reward: TireReward) {
        this.tireRewards.splice(this.tireRewards.indexOf(reward), 1);
        for (const node of [reward.node, reward.display]) {
            if (!node?.isValid) continue;
            node.active = false;
            node.destroy();
        }
    }

    private cleanupTireRewards() {
        const rear = this.squadRearExtent();
        for (const reward of [...this.tireRewards]) {
            if (!reward.node.isValid) {
                this.removeTireReward(reward);
                continue;
            }
            const position = this.player!.parent!.inverseTransformPoint(new Vec3(), reward.node.worldPosition);
            if (position.z > this.player!.position.z + rear + 4) this.removeTireReward(reward);
        }
    }

    private tireContactTime(reward: TireReward, previousShift: number, from: number) {
        if (reward.collided || !reward.node.activeInHierarchy) return Infinity;
        // Player positions and formation offsets are local to the player's parent, not world.
        const tire = this.player!.parent!.inverseTransformPoint(new Vec3(), reward.node.worldPosition);
        const player = this.player!.position;
        const previous = this.previousPlayerPosition;
        const shift = this.squadFormation?.position.x ?? 0;
        let earliest = Infinity;
        for (let index = -1; index < this.squadMembers.length; index++) {
            const slot = index < 0 ? this.soldierModel?.position : this.squadMembers[index].position;
            const x = slot?.x ?? 0;
            const z = slot?.z ?? 0;
            const startX = previous.x + (index < 0 ? 0 : previousShift) + x - tire.x;
            const startZ = previous.z + z - tire.z;
            const endX = player.x + (index < 0 ? 0 : shift) + x - tire.x;
            const endZ = player.z + z - tire.z;
            const contact = this.contactTime(startX + (endX - startX) * from,
                startZ + (endZ - startZ) * from, endX, endZ, TIRE_COLLISION_RADIUS);
            if (contact <= 1) earliest = Math.min(earliest, from + contact * (1 - from));
        }
        return earliest;
    }

    /** Merge swept gate crossings and tire contacts, recomputing after formation changes. */
    private checkPathEvents(previousShift: number) {
        const p = this.player!.position;
        const previous = this.previousPlayerPosition;
        let from = 0;
        while (this.count > 0) {
            const row = this.gates[0];
            const travel = previous.z - p.z;
            const gateTime = row && p.z <= row.z
                ? Math.max(from, travel > 0 ? Math.min(1, Math.max(0, (previous.z - row.z) / travel)) : 1)
                : Infinity;
            let contact = Infinity;
            let hit: TireReward | null = null;
            for (const reward of this.tireRewards) {
                const time = this.tireContactTime(reward, previousShift, from);
                if (time < contact) { contact = time; hit = reward; }
            }
            if (gateTime === Infinity && contact === Infinity) break;
            if (gateTime <= contact) {
                from = gateTime;
                this.gates.shift();
                const crossingX = previous.x + (p.x - previous.x) * from;
                const gate = crossingX < 0 ? row.left : row.right;
                if (this.count === MAX_SQUAD_SIZE && typeof gate.value === 'number' && gate.value > 0) {
                    // A full squad converts one additive gate into one existing rescue-style buff.
                    this.grantRescueBuff(Math.floor(this.rand(0, 3)));
                } else {
                    this.setSquadCount(gate.value === 'double' ? this.count * 2
                        : gate.value === 'halve' ? Math.floor(this.count / 2) : this.count + gate.value, false);
                }
                row.left.node.destroy();
                row.right.node.destroy();
            } else {
                from = contact;
                hit!.collided = true;
                this.applyAttackLoss(Math.max(1, Math.floor(this.tireCollisionLoss)));
            }
            this.layoutSquad();
        }
    }

    private updateBossAttack(boss: BossEncounter, dt: number) {
        if (boss.health <= 0 || this.count <= 0 || boss.phase === 'waiting') return;
        const p = this.player!.position;
        const travel = this.previousPlayerPosition.z - p.z;
        const step = Math.max(0, Math.min(dt, 0.25));
        // Carry with actual runner progress, then approach/retreat relative to the running squad.
        let { x, y, z } = boss.node.position;
        z -= travel;
        if (boss.phase === 'approach') {
            x += Math.sign(p.x - x) * Math.min(Math.abs(p.x - x), 1.6 * step);
            z = Math.min(p.z - 1.8, z + BOSS_APPROACH_SPEED * step);
            if (p.z - z <= BOSS_MELEE_DEPTH && Math.abs(p.x - x) <= BOSS_MELEE_WIDTH) {
                boss.phase = 'windup';
                this.audio?.play('boss-attack');
                boss.attackTimer = BOSS_WINDUP;
                boss.warning.active = true;
            }
        } else if (boss.phase === 'windup') {
            // Lock lateral aim for a readable dodge window, but keep moving forward with the runner.
            boss.attackTimer -= step;
            if (boss.attackTimer <= 0) {
                if (Math.abs(p.z - z) <= BOSS_MELEE_DEPTH && Math.abs(p.x - x) <= BOSS_MELEE_WIDTH) {
                    this.applyAttackLoss(2);
                }
                boss.phase = 'retreat';
                boss.warning.active = false;
                const punch = boss.animation?.clips.find(clip => clip.name.endsWith('|Punch'));
                if (punch && boss.animation) {
                    boss.animation.play(punch.name);
                    this.scheduleOnce(() => {
                        if (boss.health > 0 && boss.node.isValid) this.playBossIdle(boss.animation);
                    }, punch.duration);
                }
            }
        } else {
            z = Math.max(p.z - BOSS_RETREAT_DISTANCE, z - BOSS_RETREAT_SPEED * step);
            if (p.z - z >= BOSS_RETREAT_DISTANCE - 1e-6) boss.phase = 'approach';
        }
        boss.node.setPosition(x, y, z);
        // The warning marks the actual moving melee footprint, not a stale world-space gate.
        boss.warning.setPosition(x, 0, z);
    }

    private removeZombie(index: number) {
        const zombie = this.zombies[index];
        this.zombieHealth.delete(zombie);
        this.zombieProxies.delete(zombie);
        zombie.active = false;
        zombie.destroy();
        this.zombies.splice(index, 1);
    }

    private enableCharacterShadows(node: Node) {
        for (const renderer of node.getComponentsInChildren(MeshRenderer)) {
            renderer.shadowCastingMode = MeshRenderer.ShadowCastingMode.ON;
        }
    }

    private moveZombies(dt: number, previousShift: number) {
        const p = this.player!.position;
        const previous = this.previousPlayerPosition;
        const shift = this.squadFormation?.position.x ?? 0;
        const leader = this.soldierModel?.position;
        const rear = this.squadRearExtent();
        const behindCamera = previous.z + Math.max(rear + 1, this.squadCamera?.node.position.z ?? 10);
        const casualties = new Set<number>(); // -1 is the leader; other indices are follower slots.
        const firstGateZ = this.startZ - WARMUP_DISTANCE + GATE_ROWS[0].z;
        // Let the player reach the first recruit gate while aiming at the tire.
        const advanceLimit = this.gates[0]?.z === firstGateZ ? firstGateZ - 2.4 : Infinity;
        const step = Math.max(0, Math.min(dt, 0.25));
        if (this.nextZombieRowZ !== null) this.nextZombieRowZ += this.zombieSpeed * step;

        for (let i = this.zombies.length - 1; i >= 0; i--) {
            const zombie = this.zombies[i];
            const { x, y, z } = zombie.position;
            if (z > behindCamera) {
                this.removeZombie(i);
                continue;
            }
            // Far rows march too, but keep their full-road formation until the combat band.
            const dx = p.x - x;
            const nextX = p.z - z > ZOMBIE_MODEL_DISTANCE ? x
                : x + Math.sign(dx) * Math.min(Math.abs(dx), 0.8 * step);
            const nextZ = Math.min(z + this.zombieSpeed * step, advanceLimit);
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
            // A rescue wins only before the bite; a zombie removed by earlier squad contact cannot bite later.
            if (this.survivor) {
                const s = this.survivor.position;
                const bite = this.contactTime(x - s.x, z - s.z, nextX - s.x, nextZ - s.z);
                if (bite <= 1 && bite <= first && bite <= this.survivorRescueTime) this.removeSurvivor();
            }
            if (first <= 1) {
                if (!this.consumeShield()) casualties.add(hit);
                this.removeZombie(i);
            }
        }

        if (!casualties.size) return;
        // Keep slots fixed while testing contacts, then fill holes with soldiers from the rear.
        for (const index of [...casualties].sort((a, b) => b - a)) this.removeSoldier(index);
        this.setSquadCount(this.count - casualties.size);
    }

    /** Earliest overlap during a frame, using relative motion and the combined collision radius. */
    private contactTime(startX: number, startZ: number, endX: number, endZ: number, radius = CONTACT_DISTANCE) {
        const separation = startX * startX + startZ * startZ - radius * radius;
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

    // ---------- Survivors and rescue bonuses ----------

    private updateSurvivorSchedule(fightingBoss: boolean) {
        const distance = this.distance();
        if (this.survivor && this.survivor.position.z > this.player!.position.z + this.squadRearExtent() + 4) {
            this.removeSurvivor();
        }
        if (fightingBoss) {
            this.removeSurvivor(); // Encounter clearance never grants a rescue or a kill.
            if (distance >= this.nextSurvivorDistance) this.nextSurvivorDistance = distance + this.rand(50, 100);
            return;
        }
        if (distance < this.nextSurvivorDistance || this.survivor) return;
        if (!this.soldierModel || !this.bridge) return;
        this.spawnSurvivor();
        // Keep one pending rescue if the shoulder is obstructed; never silently skip it.
        if (this.survivor) this.nextSurvivorDistance = distance + this.rand(50, 100);
    }

    private spawnSurvivor() {
        if (this.survivor || !this.player || !this.soldierModel || !this.bridge) return;
        // Find a real gap rather than giving a fragile civilian hidden invulnerability.
        const side = Math.random() < 0.5 ? -1 : 1;
        let position: { x: number; z: number } | null = null;
        // Road shoulders stay outside the horde's outer columns, but within squad rescue reach.
        for (const x of [side * 3.65, -side * 3.65]) {
            for (let depth = 18; depth <= 24; depth += 0.5) {
                const z = this.player.position.z - depth;
                if (this.zombies.every(n => Math.hypot(n.position.x - x, n.position.z - z) >= 0.65)
                    && this.tireRewards.every(r => Math.hypot(r.node.position.x - x, r.node.position.z - z) >= 2)) {
                    position = { x, z }; break;
                }
            }
            if (position) break;
        }
        if (!position) return; // No safe placement this interval; never delete enemies to make room.
        const node = new Node('Survivor · 1 HP');
        this.node.addChild(node);
        node.setPosition(position.x, this.player.position.y, position.z);
        // Clone only the human model, never the Player root (camera/input/formation).
        const model = instantiate(this.soldierModel);
        node.addChild(model);
        model.setPosition(0, this.soldierModel.position.y, 0);
        this.survivorMaterial ??= this.makeMaterial('builtin-standard', 0, new Color(132, 241, 221));
        for (const renderer of model.getComponentsInChildren(MeshRenderer)) renderer.setMaterial(this.survivorMaterial, 0);
        this.playLooping(model);
        const label = this.bridge.bossLabel(node, '救援 +\n1 HP');
        label.node.parent!.setPosition(0, 1.35, 0);
        label.fontSize = 65;
        label.lineHeight = 75;
        label.outlineColor = new Color(20, 75, 69);
        label.color = new Color(222, 255, 243);
        this.survivor = node;
    }

    private survivorContactTime(node: Node) {
        const s = node.position;
        const p = this.player!.position;
        const previous = this.previousPlayerPosition;
        let first = Infinity;
        for (const member of [this.soldierModel, ...this.squadMembers]) {
            if (!member?.activeInHierarchy) continue;
            const slot = member.position;
            first = Math.min(first, this.contactTime(previous.x + slot.x - s.x, previous.z + slot.z - s.z,
                p.x + slot.x - s.x, p.z + slot.z - s.z, 0.6));
        }
        return first;
    }

    private removeSurvivor() {
        if (!this.survivor) return;
        if (this.survivor.isValid) {
            this.survivor.active = false;
            this.survivor.destroy();
        }
        this.survivor = null;
    }

    private rescueSurvivor() {
        if (!this.survivor || this.finished || this.count <= 0) return;
        this.audio?.play('rescue');
        this.removeSurvivor(); // Clear before awarding: repeated contacts cannot reroll a reward.
        this.grantRescueBuff(Math.floor(Math.random() * 3));
    }

    private grantRescueBuff(kind: number) {
        const refreshed = kind === 0 ? this.damageBuffTime > 0 : kind === 1 ? this.hasteBuffTime > 0 : this.shieldCharges > 0;
        if (kind === 0) this.damageBuffTime = 10;
        else if (kind === 1) this.hasteBuffTime = 10;
        else this.shieldCharges = 1;
        this.updateRescueBuffs(0);
        this.showBuffPickup(kind, refreshed);
    }

    private updateRescueBuffs(dt: number) {
        const elapsed = Math.max(0, dt);
        this.damageBuffTime = Math.max(0, this.damageBuffTime - elapsed);
        this.hasteBuffTime = Math.max(0, this.hasteBuffTime - elapsed);
        if (this.squadFire) {
            this.squadFire.bonusDamage = this.damageBuffTime > 0 ? 1 : 0;
            this.squadFire.fireRateMultiplier = this.hasteBuffTime > 0 ? 1.5 : 1;
        }
    }

    private consumeShield() {
        if (this.shieldCharges <= 0) return false;
        this.audio?.play('shield');
        this.shieldCharges = 0;
        this.shieldBurstTime = 0.45;
        this.updateBuffEffects(0);
        return true;
    }

    private applyAttackLoss(loss: number) {
        if (!this.consumeShield()) this.setSquadCount(this.count - loss);
    }

    private clearRescueBuffs() {
        this.damageBuffTime = this.hasteBuffTime = this.shieldCharges = 0;
        this.buffStarTime = this.shieldBurstTime = this.buffToastTime = 0;
        this.updateRescueBuffs(0);
        this.updateBuffEffects(0);
    }

    private ensureBuffEffects() {
        if (this.buffFXRoot || !this.player) return;
        const root = new Node('Rescue Buff Effects');
        this.node.addChild(root);
        this.buffFXRoot = root;
        const cyan = this.makeMaterial('builtin-unlit', 0, new Color(58, 236, 244));
        const ice = this.makeMaterial('builtin-unlit', 1, new Color(165, 226, 255, 155));
        const gold = this.makeMaterial('builtin-unlit', 0, new Color(255, 220, 103));
        this.buffFXMaterials.push(cyan, ice, gold);
        const ring = utils.createMesh(primitives.torus(1, 0.025, { radialSegments: 4, tubularSegments: 40 }));
        const arc = utils.createMesh(primitives.torus(1, 0.045, { radialSegments: 4, tubularSegments: 28, arc: Math.PI * 1.5 }));
        const positions = [0, 0, 0], indices: number[] = [];
        for (let i = 0; i < 10; i++) {
            const angle = Math.PI / 2 + i * Math.PI / 5;
            const radius = i % 2 === 0 ? 0.12 : 0.05;
            positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
            const a = i + 1, b = (i + 1) % 10 + 1;
            indices.push(0, a, b, 0, b, a); // Visible from either side of the squad.
        }
        const star = utils.createMesh({ positions, indices });
        this.buffFXMeshes.push(ring, arc, star);
        const part = (name: string, mesh: Mesh, material: Material, parent = root) => {
            const node = new Node(name);
            parent.addChild(node);
            const renderer = node.addComponent(MeshRenderer);
            renderer.mesh = mesh;
            renderer.setMaterial(material, 0);
            return node;
        };
        this.hasteFX = part('Haste orbit', arc, cyan);
        const shield = new Node('Shield perimeter');
        root.addChild(shield);
        this.shieldFX = shield;
        part('Shield rim', ring, ice, shield);
        const dome = part('Shield arch', ring, ice, shield);
        dome.setRotationFromEuler(90, 0, 0);
        dome.setScale(1, 1, 0.65);
        dome.setPosition(0, 0.12, 0);
        this.shieldBurstFX = part('Shield block burst', ring, cyan);
        this.upgradeFX = part('Upgrade gold ring', ring, gold);
        for (let i = 0; i < 6; i++) this.buffStars.push(part('Pickup sparkle', star, gold));
        // A fixed pool of eleven renderers; none are targets or input regions.
        this.updateBuffEffects(0);
    }

    private showBuffPickup(kind: number, refreshed: boolean) {
        const name = kind === 0 ? '火力强化 +1' : kind === 1 ? '急速射击 ×1.5' : '护盾就绪';
        this.showUpgrade(kind, `${name}${refreshed ? ' · 刷新' : ' · 获得'}`);
    }

    private showUpgrade(kind: number, title: string) {
        if (this.finished || !this.player?.isValid) return;
        if (this.buffToastTime <= 0) this.upgradeTitles.clear();
        this.upgradeTitles.set(kind, title);
        this.ensureBuffEffects();
        this.buffStarTime = 0.7;
        this.buffToastTime = 2;
        if (!this.buffToast) {
            const canvas = this.node.scene?.getComponentInChildren(Canvas);
            if (canvas) {
                const node = new Node('Rescue Buff Toast');
                node.layer = Layers.Enum.UI_2D;
                canvas.node.addChild(node);
                node.addComponent(UITransform).setContentSize(300, 42);
                const g = node.addComponent(Graphics);
                g.fillColor = new Color(43, 38, 52);
                g.roundRect(-150, -23, 300, 46, 18); g.fill();
                g.fillColor = new Color(255, 246, 224);
                g.roundRect(-147, -19, 294, 38, 15); g.fill();
                this.buffToast = node;
                const icon = new Node('Buff Icon'); icon.layer = node.layer; node.addChild(icon);
                icon.setPosition(-125, 0, 0); icon.addComponent(UITransform);
                this.buffToastIcon = icon.addComponent(Graphics);
                const text = new Node('Buff Title'); text.layer = node.layer; node.addChild(text);
                text.addComponent(UITransform).setContentSize(246, 32); text.setPosition(15, 0, 0);
                const label = text.addComponent(Label);
                label.fontSize = 22; label.lineHeight = 28; label.isBold = true;
                label.overflow = Label.Overflow.SHRINK; label.color = new Color(43, 38, 52);
                this.buffToastLabel = label;
            }
        }
        if (this.buffToastLabel && this.buffToast) {
            const rows = this.upgradeTitles.size;
            const height = rows * 28 + 18;
            this.buffToastLabel.string = Array.from(this.upgradeTitles.values()).join('\n');
            this.buffToastLabel.node.getComponent(UITransform)!.setContentSize(246, rows * 28);
            this.buffToast.getComponent(UITransform)!.setContentSize(300, height);
            const background = this.buffToast.getComponent(Graphics)!;
            background.clear();
            background.fillColor = new Color(43, 38, 52);
            background.roundRect(-150, -height / 2, 300, height, 18); background.fill();
            background.fillColor = new Color(255, 246, 224);
            background.roundRect(-147, -height / 2 + 3, 294, height - 6, 15); background.fill();
        }
        const icon = this.buffToastIcon;
        if (icon) {
            icon.clear();
            icon.fillColor = new Color(43, 38, 52);
            if (kind < 0) {
                icon.fillColor = new Color(250, 178, 25);
                for (let i = 0; i < 10; i++) {
                    const angle = Math.PI / 2 + i * Math.PI / 5;
                    const radius = i % 2 === 0 ? 14 : 6;
                    if (i === 0) icon.moveTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
                    else icon.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
                }
                icon.close(); icon.fill();
            } else if (kind === 2) {
                icon.moveTo(-11, 10); icon.lineTo(11, 10); icon.lineTo(9, -4);
                icon.lineTo(0, -13); icon.lineTo(-9, -4); icon.close(); icon.fill();
                icon.fillColor = new Color(165, 226, 255);
                icon.moveTo(-7, 7); icon.lineTo(7, 7); icon.lineTo(5, -3);
                icon.lineTo(0, -8); icon.lineTo(-5, -3); icon.close(); icon.fill();
            } else {
                icon.moveTo(2, 14); icon.lineTo(-11, -2); icon.lineTo(-2, -2);
                icon.lineTo(-3, -14); icon.lineTo(11, 3); icon.lineTo(3, 3); icon.close(); icon.fill();
            }
        }
        this.updateBuffEffects(0);
    }

    private updateBuffEffects(dt: number) {
        const elapsed = Math.max(0, dt);
        this.buffStarTime = Math.max(0, this.buffStarTime - elapsed);
        this.shieldBurstTime = Math.max(0, this.shieldBurstTime - elapsed);
        this.buffToastTime = Math.max(0, this.buffToastTime - elapsed);
        const root = this.buffFXRoot;
        if (root && this.player) {
            this.buffFXPhase = (this.buffFXPhase + elapsed * 180) % 360;
            const p = this.player.worldPosition;
            const rear = this.squadRearExtent();
            root.setWorldPosition(new Vec3(p.x, p.y + (this.soldierModel?.position.y ?? -1) + 0.07, p.z + rear / 2));
            const wide = this.squadMembers.length > 0 ? 1.05 : 0.65;
            const deep = rear / 2 + 0.7;
            if (this.hasteFX) {
                this.hasteFX.active = this.hasteBuffTime > 0;
                this.hasteFX.setScale(wide, 1, deep);
                this.hasteFX.setRotationFromEuler(0, this.buffFXPhase, 0);
            }
            if (this.shieldFX) {
                this.shieldFX.active = this.shieldCharges > 0;
                this.shieldFX.setScale(wide + 0.18, 1, deep + 0.18);
            }
            if (this.shieldBurstFX) {
                this.shieldBurstFX.active = this.shieldBurstTime > 0;
                const expansion = 1 + (1 - this.shieldBurstTime / 0.45) * 0.9;
                this.shieldBurstFX.setScale((wide + 0.18) * expansion, Math.max(0.05, this.shieldBurstTime / 0.45), (deep + 0.18) * expansion);
            }
            if (this.upgradeFX) {
                this.upgradeFX.active = this.buffStarTime > 0;
                const age = 1 - this.buffStarTime / 0.7;
                this.upgradeFX.setScale(wide * (1 + age * 0.8), Math.max(0.05, 1 - age), deep * (1 + age * 0.8));
            }
            for (let i = 0; i < this.buffStars.length; i++) {
                const star = this.buffStars[i];
                star.active = this.buffStarTime > 0;
                if (!star.active) continue;
                const age = 1 - this.buffStarTime / 0.7;
                const angle = i * Math.PI / 3 + this.buffFXPhase * Math.PI / 180;
                star.setPosition(Math.cos(angle) * (wide + age * 0.4), 0.3 + age * 0.8,
                    Math.sin(angle) * (deep + age * 0.4));
                const size = (1 - age) * 1.3;
                star.setScale(size, size * 1.5, size);
            }
            root.active = this.hasteBuffTime > 0 || this.shieldCharges > 0 || this.buffStarTime > 0 || this.shieldBurstTime > 0;
        }
        if (this.buffToast) {
            this.buffToast.active = this.buffToastTime > 0;
            const canvas = this.buffToast.parent?.getComponent(UITransform);
            if (canvas) {
                const { width, height } = canvas.contentSize;
                const compact = width < 600;
                const toastHeight = this.buffToast.getComponent(UITransform)!.contentSize.height;
                this.buffToast.setPosition(0, height / 2 - (compact ? 302 : 226) - (toastHeight - 46) / 2, 0);
                const pop = Math.min(1, (2 - this.buffToastTime) * 8);
                const scale = Math.min(1, (width - 32) / 300) * (0.92 + pop * 0.08);
                this.buffToast.setScale(scale, scale, 1);
            }
        }
    }

    private disposeBuffEffects() {
        if (this.buffFXRoot?.isValid) this.buffFXRoot.destroy();
        if (this.buffToast?.isValid) this.buffToast.destroy();
        this.buffFXRoot = this.hasteFX = this.shieldFX = this.shieldBurstFX = this.upgradeFX = this.buffToast = null;
        this.upgradeTitles.clear();
        this.upgradeRecruits = 0;
        this.buffToastLabel = null;
        this.buffToastIcon = null;
        this.buffStars.length = 0;
        for (const material of this.buffFXMaterials) material.destroy();
        for (const mesh of this.buffFXMeshes) mesh.destroy();
        this.buffFXMaterials.length = this.buffFXMeshes.length = 0;
    }

    private rescueBuffLabel() {
        const buffs: string[] = [];
        if (this.damageBuffTime > 0) buffs.push(`伤害+1 ${Math.ceil(this.damageBuffTime)}s`);
        if (this.hasteBuffTime > 0) buffs.push(`射速×1.5 ${Math.ceil(this.hasteBuffTime)}s`);
        if (this.shieldCharges > 0) buffs.push('护盾 1次');
        return buffs.length ? `\n救援奖励 · ${buffs.join(' · ')}` : '';
    }

    // ---------- Helpers ----------

    private showCount() {
        const label = this.countLabel;
        if (!label) return;
        const firepower = this.squadFire ? ` · ${this.squadFire.damageLabel}` : '';
        const progress = `击杀 ${this.zombieKills} · 僵尸 HP ${this.currentZombieHP}${this.rescueBuffLabel()}`;
        const boss = this.bosses[0];
        if (boss && this.player && boss.phase !== 'waiting') {
            const hint = boss.warning.active ? (boss.warning.position.x < 0 ? '向右闪避' : '向左闪避') : '首领战';
            label.string = `${hint} · 队伍 ${this.count}/${MAX_SQUAD_SIZE}${firepower}\n${progress}`;
            return;
        }
        const text = `队伍 ${this.count}/${MAX_SQUAD_SIZE} · ${this.distance()} m${firepower}\n${progress}`;
        if (label.string !== text) label.string = text;
    }

    private distance() {
        return Math.max(0, Math.floor(this.startZ - (this.player?.position.z ?? this.startZ)));
    }

    private endGame() {
        this.finished = true;
        this.audio?.finish();
        this.removeSurvivor();
        this.clearRescueBuffs();
        this.disposeBuffEffects();
        for (const boss of this.bosses) boss.warning.active = false;
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

        this.wireRestartButton(node);
    }

    private wireRestartButton(node: Node) {
        const button = node.addComponent(Button);
        button.transition = Button.Transition.NONE; // Graphics has no Sprite to tint.
        button.interactable = !this.restarting;
        this.restartButtons.push(button);
        node.on(Button.EventType.CLICK, this.restartGame, this);
    }

    private restartGame() {
        if (this.restarting) return;
        const scene = this.node.scene;
        if (!scene) return;
        // Runtime Scene.name can be empty (including Creator preview). The bundle's
        // scene URL is authoritative; a UUID itself is NOT accepted by loadScene.
        let sceneURL = '';
        assetManager.bundles.forEach(bundle => {
            const info = bundle.getAssetInfo(scene.uuid) as { uuid: string; url?: string } | null;
            if (info?.url && bundle.getSceneInfo(info.url)?.uuid === scene.uuid) sceneURL = info.url;
        });
        if (!sceneURL && scene.name) {
            const bundle = assetManager.bundles.find(candidate => {
                const info = candidate.getSceneInfo(scene.name);
                return !!info && (!scene.uuid || info.uuid === scene.uuid);
            });
            if (bundle) sceneURL = scene.name;
        }
        if (!sceneURL) {
            console.warn('Cannot restart: current scene is not registered in a loaded bundle.');
            return;
        }
        this.restarting = true;
        for (const button of this.restartButtons) if (button.isValid) button.interactable = false;
        const restore = () => {
            this.restarting = false;
            for (const button of this.restartButtons) if (button.isValid) button.interactable = true;
        };
        try {
            if (!director.loadScene(sceneURL, error => { if (error) restore(); })) restore();
        } catch (error) {
            restore();
            console.warn('Could not restart scene.', error);
        }
    }

    private createRestartIcon() {
        const canvas = this.node.scene?.getComponentInChildren(Canvas);
        if (!canvas) return;
        const node = new Node('Restart Icon');
        node.layer = Layers.Enum.UI_2D;
        canvas.node.addChild(node);
        node.addComponent(UITransform).setContentSize(64, 64);
        const graphics = node.addComponent(Graphics);
        graphics.fillColor = new Color(19, 43, 33, 240);
        graphics.roundRect(-32, -32, 64, 64, 14);
        graphics.fill();
        graphics.strokeColor = new Color(255, 255, 255);
        graphics.lineWidth = 5;
        graphics.arc(0, 0, 18, Math.PI * 0.25, Math.PI * 1.85, true);
        graphics.stroke();
        graphics.fillColor = new Color(255, 255, 255);
        graphics.moveTo(22, 10);
        graphics.lineTo(8, 14);
        graphics.lineTo(17, 23);
        graphics.close();
        graphics.fill();
        const widget = node.addComponent(Widget);
        widget.isAlignTop = widget.isAlignLeft = true;
        widget.top = widget.left = 24;
        widget.alignMode = Widget.AlignMode.ALWAYS;
        widget.updateAlignment();
        this.wireRestartButton(node);
        // Reserve the top row for the control; keep the two-line HUD below it
        // at every aspect ratio instead of its authored portrait-only Y position.
        if (this.countLabel) {
            const label = this.countLabel;
            label.overflow = Label.Overflow.SHRINK;
            label.node.getComponent(UITransform)!.setContentSize(400, 100);
            const hud = label.node.getComponent(Widget) ?? label.node.addComponent(Widget);
            hud.isAlignTop = hud.isAlignLeft = hud.isAlignRight = true;
            hud.top = 100;
            hud.left = hud.right = 24;
            hud.alignMode = Widget.AlignMode.ALWAYS;
            hud.updateAlignment();
        }
    }

    private createSoundButton() {
        const canvas = this.node.scene?.getComponentInChildren(Canvas);
        if (!canvas) return;
        const node = new Node('Sound toggle');
        node.layer = Layers.Enum.UI_2D;
        canvas.node.addChild(node);
        node.addComponent(UITransform).setContentSize(64, 64);
        this.soundIcon = node.addComponent(Graphics);
        const button = node.addComponent(Button);
        button.transition = Button.Transition.NONE;
        this.soundButton = button;
        node.on(Button.EventType.CLICK, this.toggleSound, this);
        const widget = node.addComponent(Widget);
        widget.isAlignTop = widget.isAlignRight = true;
        widget.top = widget.right = 24;
        widget.alignMode = Widget.AlignMode.ALWAYS;
        widget.updateAlignment();
        this.drawSoundIcon();
    }

    private toggleSound() {
        this.audio?.toggle();
        this.drawSoundIcon();
    }

    private drawSoundIcon() {
        const graphics = this.soundIcon;
        if (!graphics) return;
        graphics.clear();
        graphics.fillColor = new Color(19, 43, 33, 240);
        graphics.roundRect(-32, -32, 64, 64, 14);
        graphics.fill();
        graphics.fillColor = new Color(255, 255, 255);
        graphics.moveTo(-21, -7);
        graphics.lineTo(-12, -7);
        graphics.lineTo(0, -16);
        graphics.lineTo(0, 16);
        graphics.lineTo(-12, 7);
        graphics.lineTo(-21, 7);
        graphics.close();
        graphics.fill();
        graphics.strokeColor = new Color(255, 255, 255);
        graphics.lineWidth = 4;
        if (this.audio?.muted) {
            graphics.moveTo(8, -10);
            graphics.lineTo(24, 10);
            graphics.moveTo(8, 10);
            graphics.lineTo(24, -10);
            graphics.stroke();
        } else {
            graphics.moveTo(9, 0);
            graphics.lineTo(23, 0);
            graphics.moveTo(8, 9);
            graphics.lineTo(18, 18);
            graphics.moveTo(8, -9);
            graphics.lineTo(18, -18);
            graphics.stroke();
        }
    }

    private get initialBossGoal() {
        return Number.isFinite(this.bossKillsRequired)
            ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, Math.floor(this.bossKillsRequired))) : 150;
    }

    private get bossKillTarget() {
        return this.bossGoal ??= this.initialBossGoal;
    }

    private createBossMeter() {
        const canvas = this.node.scene?.getComponentInChildren(Canvas);
        const transform = canvas?.node.getComponent(UITransform);
        if (!canvas || !transform) return;
        this.bossMeterCanvas = transform;
        const node = new Node('Boss Kill Charge');
        node.layer = Layers.Enum.UI_2D;
        canvas.node.addChild(node);
        node.addComponent(UITransform);
        node.addComponent(Graphics);
        this.bossMeter = node;
        const fill = new Node('Charge Fill');
        fill.layer = node.layer;
        node.addChild(fill);
        fill.addComponent(UITransform);
        this.bossMeterFill = fill.addComponent(Graphics);
        const text = new Node('Charge Label');
        text.layer = node.layer;
        node.addChild(text);
        text.addComponent(UITransform);
        const label = text.addComponent(Label);
        label.fontSize = 20;
        label.lineHeight = 24;
        label.isBold = true;
        label.color = new Color(43, 38, 52);
        label.overflow = Label.Overflow.SHRINK;
        this.bossMeterLabel = label;
        // Display only: no Button, input listener, or gameplay-blocking hit region.
        this.updateBossMeter(0);
    }

    update(dt: number) { this.updateBossMeter(dt); }

    private updateBossMeter(dt: number) {
        const node = this.bossMeter;
        const canvas = this.bossMeterCanvas;
        const fill = this.bossMeterFill;
        const label = this.bossMeterLabel;
        if (!node || !canvas || !fill || !label) return;
        const { width, height } = canvas.contentSize;
        // Symmetric gutters reserve the 64px restart control plus 16px breathing room.
        const meterWidth = Math.max(120, Math.min(520, width < 600 ? width - 48 : width - 208));
        const compact = width < 600;
        const top = compact ? 100 : 24;
        if (this.bossMeterWidth !== meterWidth || this.bossMeterHeight !== height || node.position.y !== height / 2 - top - 32) {
            this.bossMeterWidth = meterWidth;
            this.bossMeterHeight = height;
            node.setPosition(0, height / 2 - top - 32, 0);
            node.getComponent(UITransform)!.setContentSize(meterWidth, 64);
            const g = node.getComponent(Graphics)!;
            g.clear();
            const x = -meterWidth / 2;
            g.fillColor = new Color(43, 38, 52);
            g.roundRect(x, -34, meterWidth, 66, 10); g.fill();
            g.fillColor = new Color(255, 246, 224);
            g.roundRect(x + 3, -29, meterWidth - 6, 58, 8); g.fill();
            // One same-ramp track, not segments or a second health bar.
            g.fillColor = new Color(205, 226, 251);
            g.roundRect(x + 56, -19, meterWidth - 72, 14, 4); g.fill();
            // Original crowned monster badge, drawn from simple shapes.
            const bx = x + 29;
            g.fillColor = new Color(43, 38, 52);
            g.roundRect(bx - 17, -18, 34, 33, 12); g.fill();
            g.fillColor = new Color(183, 211, 246);
            g.roundRect(bx - 14, -15, 28, 27, 10); g.fill();
            g.fillColor = new Color(43, 38, 52);
            g.roundRect(bx - 9, -2, 5, 7, 2); g.fill();
            g.roundRect(bx + 4, -2, 5, 7, 2); g.fill();
            g.moveTo(bx - 13, 13); g.lineTo(bx - 16, 24); g.lineTo(bx - 5, 20);
            g.lineTo(bx, 28); g.lineTo(bx + 5, 20); g.lineTo(bx + 16, 24);
            g.lineTo(bx + 13, 13); g.close(); g.fill();
            g.fillColor = new Color(250, 178, 25);
            g.moveTo(bx - 10, 16); g.lineTo(bx - 12, 20); g.lineTo(bx - 4, 17);
            g.lineTo(bx, 23); g.lineTo(bx + 4, 17); g.lineTo(bx + 12, 20);
            g.lineTo(bx + 10, 16); g.close(); g.fill();
            label.node.setPosition(20, 10, 0);
            label.node.getComponent(UITransform)!.setContentSize(meterWidth - 64, 26);
            const hud = this.countLabel?.node.getComponent(Widget);
            if (hud) { hud.top = compact ? 176 : 100; hud.updateAlignment(); }
            this.bossMeterDrawn = -1;
        }
        const target = this.bossKillTarget;
        const charge = Math.min(target, this.bossCharge);
        const active = this.bosses.length > 0;
        const available = !!this.bossPrefabs[this.bossEncounterIndex % this.bossPrefabs.length];
        const text = active ? 'BOSS · 战斗中' : charge >= target
            ? (available ? 'BOSS · 来袭！' : 'BOSS · 等待配置') : `BOSS  ${charge}/${target}`;
        if (label.string !== text) label.string = text;
        const ratio = active ? 1 : charge / target;
        const delta = ratio - this.bossMeterShown;
        this.bossMeterShown = Math.abs(delta) < 0.001 ? ratio
            : this.bossMeterShown + delta * (1 - Math.exp(-Math.max(0, dt) * 14));
        if (this.bossMeterDrawn === this.bossMeterShown) return;
        this.bossMeterDrawn = this.bossMeterShown;
        fill.clear();
        const filled = (meterWidth - 72) * this.bossMeterShown;
        if (filled > 0) {
            fill.fillColor = new Color(42, 120, 214);
            fill.roundRect(-meterWidth / 2 + 56, -19, filled, 14, Math.min(4, filled / 2));
            fill.fill();
        }
    }

    onDestroy() {
        if (this.soundButton?.isValid && this.soundButton.node?.isValid) {
            this.soundButton.node.off(Button.EventType.CLICK, this.toggleSound, this);
            this.soundButton.node.destroy();
        }
        this.soundButton = null;
        this.soundIcon = null;
        this.audio = null;
        this.removeSurvivor();
        // Scene siblings/children may already be destroyed. Teardown must not
        // update effects or query components on their invalid nodes.
        this.damageBuffTime = this.hasteBuffTime = this.shieldCharges = 0;
        this.buffStarTime = this.shieldBurstTime = this.buffToastTime = 0;
        this.updateRescueBuffs(0); // Plain weapon state only; never renders during destruction.
        this.disposeBuffEffects();
        this.unscheduleAllCallbacks();
        const runner = this.player?.isValid ? this.player.getComponent(PlayerRunner) : null;
        if (runner?.isValid) runner.isUIInput = null;
        for (const button of this.restartButtons) {
            if (button.isValid && button.node?.isValid) button.node.off(Button.EventType.CLICK, this.restartGame, this);
        }
        this.restartButtons.length = 0;
        if (this.bossMeter?.isValid) this.bossMeter.destroy();
        this.bossMeter = null;
        this.bossMeterCanvas = null;
        this.bossMeterFill = null;
        this.bossMeterLabel = null;
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
