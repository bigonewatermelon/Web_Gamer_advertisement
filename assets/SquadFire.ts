import { AnimationClip, Color, Material, Mesh, MeshRenderer, Node, Prefab, Quat, SkeletalAnimation, Vec3, instantiate, primitives, tween, utils } from 'cc';

const SHOT_INTERVAL = 0.38;
const GUN_SCALE = 0.44;
const TIRE_RANGE = 16;
const TIRE_BURST_INTERVAL = 0.09;
// The blaster-e model points along +Z. These coordinates are in its authored units.
const GRIP = new Vec3(-0.045, -0.095, 0.48);
const MUZZLE = new Vec3(-0.045, 0.016, 1.39);
// The blaster-f reward uses a centered origin.
const RIFLE_GRIP = new Vec3(0, -0.105, -0.18);
const RIFLE_MUZZLE = new Vec3(0, 0.02, 0.655);
const FORWARD = new Vec3(0, 0, -1);

interface Arm {
    upper: Node;
    forearm: Node;
    hand: Node;
    upperLength: number;
    forearmLength: number;
}

interface Weapon {
    gun: Node;
    left: Arm;
    right: Arm;
    aimPose: { joint: Node; rotation: Quat }[];
    cooldown: number;
    recoil: number;
}

/** Keeps the run cycle on the legs and applies the imported targeting pose to the arms. */
export class SquadFire {
    private readonly weapons = new Map<Node, Weapon>();
    private readonly tracer = utils.createMesh(primitives.box());
    private readonly spark = utils.createMesh(primitives.sphere(0.5, { segments: 5 }));
    private readonly white = this.makeMaterial(255, 251, 209);
    private readonly gold = this.makeMaterial(255, 143, 11);
    private readonly debris = this.makeMaterial(107, 95, 68);
    private readonly gunBody = this.makeMaterial(10, 163, 232, 'builtin-standard');
    private readonly rifleBody = this.makeMaterial(163, 83, 255, 'builtin-standard');
    private readonly gunTrim = this.makeMaterial(25, 44, 62, 'builtin-standard');
    private readonly direction = new Vec3();
    private readonly muzzle = new Vec3();
    private readonly impact = new Vec3();
    private readonly position = new Vec3();
    private readonly rotation = new Quat();
    private readonly chestCenter = new Vec3();
    private readonly wrist = new Vec3();
    private readonly reach = new Vec3();
    private readonly bend = new Vec3();
    private readonly elbow = new Vec3();
    private readonly boneDirection = new Vec3();
    private readonly boneRotation = new Quat();
    private upgraded = false;

    constructor(private readonly root: Node, private gunPrefab: Prefab, private readonly targetingPose: AnimationClip,
        private readonly shotRange: number) {}

    equip(soldier: Node) {
        const chest = soldier.getChildByPath('Root/HipsCtrl/Hips/Spine/Chest/UpperChest');
        if (!chest) return;
        const left = this.findArm(chest, 'Left');
        const right = this.findArm(chest, 'Right');
        if (!left || !right) return;

        const aimPose: Weapon['aimPose'] = [];
        const capture = (joint: Node) => {
            aimPose.push({ joint, rotation: joint.rotation.clone() });
            joint.children.forEach(capture);
        };
        const animation = soldier.getComponent(SkeletalAnimation);
        if (animation) animation.useBakedAnimation = false;
        this.targetingPose.createEvaluator({ target: soldier }).evaluate(0);
        capture(left.upper.parent!);
        capture(right.upper.parent!);

        const gun = this.createGun();
        this.weapons.set(soldier, { gun, left, right, aimPose, cooldown: Math.random() * 0.13, recoil: 0 });
    }

    upgrade(prefab: Prefab) {
        if (this.upgraded) return;
        this.upgraded = true;
        this.gunPrefab = prefab;
        for (const weapon of this.weapons.values()) {
            const oldGun = weapon.gun;
            weapon.gun = this.createGun();
            weapon.gun.setWorldPosition(oldGun.worldPosition);
            weapon.gun.setWorldRotation(oldGun.worldRotation);
            weapon.gun.active = oldGun.active;
            oldGun.active = false;
            oldGun.destroy();
        }
    }

    private createGun() {
        const gun = instantiate(this.gunPrefab);
        this.root.addChild(gun);
        gun.active = false;
        gun.setScale(GUN_SCALE, GUN_SCALE, GUN_SCALE);
        const body = this.upgraded ? this.rifleBody : this.gunBody;
        for (const renderer of gun.getComponentsInChildren(MeshRenderer)) {
            renderer.setMaterial(renderer.node.name === gun.name ? body : this.gunTrim, 0);
        }
        return gun;
    }

    unequip(soldier: Node) {
        const weapon = this.weapons.get(soldier);
        if (!weapon) return;
        weapon.gun.active = false;
        weapon.gun.destroy();
        this.weapons.delete(soldier);
    }

    update(dt: number, enemies: Node[], tire: Node | null, focusTire: boolean,
        hit: (target: Node, damage: number) => void, boss: Node | null = null) {
        for (const [soldier, weapon] of this.weapons) {
            for (const { joint, rotation } of weapon.aimPose) joint.setRotation(rotation);
            weapon.cooldown = Math.max(0, weapon.cooldown - dt);
            weapon.recoil = Math.max(0, weapon.recoil - dt * 8);

            Vec3.lerp(this.chestCenter, weapon.left.upper.worldPosition, weapon.right.upper.worldPosition, 0.5);
            const target = boss?.activeInHierarchy ? boss : focusTire ? tire : this.findTarget(soldier.worldPosition, enemies, tire);
            this.direction.set(FORWARD);
            if (target) {
                this.impact.set(target.worldPosition);
                if (target === boss) this.impact.y += 1.5;
                else if (target === tire) this.impact.y += 0.7;
                else this.impact.y = soldier.worldPosition.y + 0.49;
                Vec3.subtract(this.direction, this.impact, this.chestCenter).normalize();
            }
            const yaw = Math.atan2(this.direction.x, this.direction.z) * 180 / Math.PI;
            const pitch = -Math.asin(this.direction.y) * 180 / Math.PI - weapon.recoil * 6;
            Quat.fromEuler(this.rotation, pitch, yaw, 0);

            // Put the grip outside the torso's silhouette when viewed from behind.
            this.wrist.set(this.chestCenter).add3f(0.23, -0.082, 0);
            Vec3.scaleAndAdd(this.wrist, this.wrist, this.direction, 0.09 - weapon.recoil * 0.028);
            this.poseArm(weapon.right, this.wrist, 1);
            const hand = weapon.right.hand.worldPosition;
            this.wrist.set(hand).add3f(-0.072, 0.029, 0);
            Vec3.scaleAndAdd(this.wrist, this.wrist, this.direction, 0.095);
            this.poseArm(weapon.left, this.wrist, -1);

            weapon.gun.setWorldRotation(this.rotation);
            Vec3.transformQuat(this.position, this.upgraded ? RIFLE_GRIP : GRIP, this.rotation).multiplyScalar(GUN_SCALE);
            Vec3.subtract(this.position, hand, this.position);
            weapon.gun.setWorldPosition(this.position);
            weapon.gun.active = true;
            if (weapon.cooldown > 0) continue;

            weapon.cooldown = focusTire ? TIRE_BURST_INTERVAL : SHOT_INTERVAL;
            weapon.recoil = 1;
            Vec3.transformQuat(this.muzzle, this.upgraded ? RIFLE_MUZZLE : MUZZLE, this.rotation)
                .multiplyScalar(GUN_SCALE).add(this.position);
            if (!target) {
                Vec3.scaleAndAdd(this.impact, this.muzzle, FORWARD, this.shotRange);
            }
            if (target && target === tire) {
                this.drawShot(this.muzzle, this.impact, true, () => hit(target, 1));
            } else {
                this.drawShot(this.muzzle, this.impact, !!target);
                if (target) hit(target, this.upgraded ? 2 : 1);
            }
        }
    }

    private findArm(chest: Node, side: 'Left' | 'Right'): Arm | null {
        const upper = chest.getChildByPath(`${side}Shoulder/${side}Arm`);
        const forearm = upper?.getChildByName(`${side}ForeArm`);
        const hand = forearm?.getChildByName(`${side}Hand`);
        if (!upper || !forearm || !hand) return null;
        return {
            upper, forearm, hand,
            upperLength: Vec3.distance(upper.worldPosition, forearm.worldPosition),
            forearmLength: Vec3.distance(forearm.worldPosition, hand.worldPosition),
        };
    }

    /** Solves a bent elbow without changing the hand and finger animation hierarchy. */
    private poseArm(arm: Arm, wrist: Vec3, side: number) {
        const shoulder = arm.upper.worldPosition;
        Vec3.subtract(this.reach, wrist, shoulder);
        const distance = Math.max(Math.abs(arm.upperLength - arm.forearmLength) + 0.001,
            Math.min(arm.upperLength + arm.forearmLength - 0.001, this.reach.length()));
        this.reach.normalize();
        this.bend.set(side * 0.7, -1, 0.35);
        Vec3.scaleAndAdd(this.bend, this.bend, this.reach, -Vec3.dot(this.bend, this.reach)).normalize();
        const along = (arm.upperLength ** 2 - arm.forearmLength ** 2 + distance ** 2) / (2 * distance);
        const outward = Math.sqrt(Math.max(0, arm.upperLength ** 2 - along ** 2));
        Vec3.scaleAndAdd(this.elbow, shoulder, this.reach, along);
        Vec3.scaleAndAdd(this.elbow, this.elbow, this.bend, outward);
        Vec3.scaleAndAdd(wrist, shoulder, this.reach, distance);
        this.pointBone(arm.upper, arm.forearm, this.elbow);
        this.pointBone(arm.forearm, arm.hand, wrist);
    }

    private pointBone(joint: Node, child: Node, target: Vec3) {
        Vec3.subtract(this.boneDirection, child.worldPosition, joint.worldPosition).normalize();
        Vec3.subtract(this.bend, target, joint.worldPosition).normalize();
        Quat.rotationTo(this.boneRotation, this.boneDirection, this.bend);
        Quat.multiply(this.boneRotation, this.boneRotation, joint.worldRotation);
        joint.setWorldRotation(this.boneRotation);
    }

    private findTarget(origin: Readonly<Vec3>, enemies: Node[], tire: Node | null) {
        let nearest: Node | null = null;
        let best = Infinity;
        const rangeSquared = this.shotRange ** 2;
        for (const enemy of enemies) {
            const position = enemy.worldPosition;
            const depth = origin.z - position.z;
            const x = position.x - origin.x;
            if (depth <= 0.7 || Math.abs(x) > 0.72 + depth * 0.13) continue;
            if (depth * depth + x * x > rangeSquared) continue;
            const distance = depth * depth + x * x * 4;
            if (distance >= best) continue;
            best = distance;
            nearest = enemy;
        }
        // Nearby enemies still take priority over the tire.
        if (best > 2.2 ** 2 && tire?.activeInHierarchy) {
            const depth = origin.z - tire.worldPosition.z;
            if (depth > 0.7 && depth < TIRE_RANGE && Math.abs(origin.x - tire.worldPosition.x) <= 1.45) return tire;
        }
        return nearest;
    }

    private drawShot(from: Vec3, to: Vec3, hasTarget: boolean, onImpact?: () => void) {
        const destination = to.clone();
        this.burst('Muzzle flash', from, 0.24, this.gold, 0.085);
        const direction = Vec3.subtract(new Vec3(), to, from);
        const length = direction.length();
        direction.normalize();
        const projectile = new Node('Tracer');
        this.root.addChild(projectile);
        projectile.setWorldPosition(from);
        projectile.setWorldRotation(Quat.rotationTo(new Quat(), Vec3.UNIT_Z, direction));
        const trail = this.effect('Bullet trail', this.tracer, this.gold, from, projectile);
        const head = this.effect('Bullet', this.spark, this.white, from, projectile);
        head.setScale(0.15, 0.15, 0.23);

        const duration = Math.max(0.13, Math.min(0.29, length / 72));
        const extendTrail = (ratio: number) => {
            const segment = Math.min(3, Math.max(0.01, length * ratio));
            const width = 0.085 * (1 - ratio * 0.45);
            trail.setPosition(0, 0, -segment / 2);
            trail.setScale(width, width, segment);
        };
        extendTrail(0);
        tween(projectile).to(duration, { worldPosition: destination }, { onUpdate: (_, ratio) => extendTrail(ratio) })
            .call(() => {
                projectile.destroy();
                if (onImpact) {
                    this.burst('Tire hit', destination, 0.16, this.gold, 0.08);
                    onImpact();
                } else if (hasTarget) this.drawImpact(destination);
            }).start();
    }

    private drawImpact(at: Vec3) {
        this.burst('Hit flash', at, 0.3, this.gold, 0.15);
        for (let i = 0; i < 5; i++) {
            const angle = Math.random() * Math.PI * 2;
            const distance = 0.17 + Math.random() * 0.27;
            const chip = this.effect('Hit fragment', this.spark, i < 2 ? this.gold : this.debris, at);
            chip.setScale(0.055, 0.055, 0.055);
            const scatter = new Vec3(at.x + Math.cos(angle) * distance, at.y + 0.12 + Math.random() * 0.26,
                at.z + Math.sin(angle) * distance);
            tween(chip).to(0.11, { worldPosition: scatter }, { easing: 'quadOut' })
                .to(0.14, { worldPosition: new Vec3(scatter.x, scatter.y - 0.24, scatter.z), scale: new Vec3(0.008, 0.008, 0.008) })
                .call(() => chip.destroy()).start();
        }
    }

    private burst(name: string, position: Vec3, size: number, material: Material, lifetime: number) {
        const flash = this.effect(name, this.spark, material, position);
        flash.setScale(size, size, size);
        tween(flash).to(lifetime, { scale: new Vec3(0.01, 0.01, 0.01) }).call(() => flash.destroy()).start();
    }

    private effect(name: string, mesh: Mesh, material: Material, position: Vec3, parent = this.root) {
        const node = new Node(name);
        parent.addChild(node);
        node.setWorldPosition(position);
        const renderer = node.addComponent(MeshRenderer);
        renderer.mesh = mesh;
        renderer.setMaterial(material, 0);
        return node;
    }

    private makeMaterial(r: number, g: number, b: number, effectName = 'builtin-unlit') {
        const material = new Material();
        material.initialize({ effectName });
        material.setProperty('mainColor', new Color(r, g, b, 255));
        return material;
    }
}
