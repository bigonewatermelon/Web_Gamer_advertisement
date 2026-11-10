// Run: node scripts/test-rewards.cjs [path/to/typescript.js]
// Executes the real TypeScript methods with a minimal engine double; no npm install needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require(process.argv[2] || 'C:/ProgramData/cocos/editors/Creator/3.8.5/resources/app.asar.unpacked/node_modules/typescript/lib/typescript.js');
class Vec3 {
    constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
    set(v) { Object.assign(this, v); return this; }
    clone() { return new Vec3(this.x, this.y, this.z); }
    add(v) { return this.add3f(v.x, v.y, v.z); }
    add3f(x, y, z) { this.x += x; this.y += y; this.z += z; return this; }
    multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
    length() { return Math.hypot(this.x, this.y, this.z); }
    normalize() { return this.multiplyScalar(1 / (this.length() || 1)); }
    static subtract(out, a, b) { return out.set(new Vec3(a.x - b.x, a.y - b.y, a.z - b.z)); }
    static lerp(out, a, b, t) { return out.set(new Vec3(a.x + (b.x-a.x)*t, a.y + (b.y-a.y)*t, a.z + (b.z-a.z)*t)); }
    static scaleAndAdd(out, a, b, s) { return out.set(new Vec3(a.x+b.x*s, a.y+b.y*s, a.z+b.z*s)); }
    static transformQuat(out, a) { return out.set(a); } // Aiming visuals do not affect targeting/cadence.
}
class Node {
    constructor(name = '') { this.name = name; this.position = new Vec3(); this.active = this.isValid = true; this.children = []; this.components = []; }
    get activeInHierarchy() { return this.active && (!this.parent || this.parent.activeInHierarchy); }
    get worldPosition() { const p = this.parent?.worldPosition || new Vec3(); return new Vec3(p.x + this.position.x, p.y + this.position.y, p.z + this.position.z); }
    addChild(n) { n.parent = this; this.children.push(n); }
    setParent(parent) { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); parent.addChild(this); }
    setPosition(x, y, z) { const v = typeof x === 'object' ? x : { x, y, z }; this.position.set(v); }
    getPosition(out) { return out.set(this.position); }
    setWorldPosition(v) { this.position = new Vec3(v.x, v.y, v.z); }
    setWorldRotation(q) { this.worldRotation = q; }
    setScale(x, y = x, z = x) { this.scale = typeof x === 'object' ? x : new Vec3(x, y, z); }
    setRotationFromEuler(x, y, z) { this.eulerAngles = new Vec3(x, y, z); }
    getComponent(type) { if (!this.isValid) throw new TypeError("Cannot read properties of null (reading 'length')"); return this.components.find(c => c instanceof type); }
    addComponent(type) { const c = new type(this); c.node = this; this.components.push(c); return c; }
    on(type, callback, target) { (this.listeners ??= {})[type] = { callback, target }; }
    off(type) { if (this.listeners) delete this.listeners[type]; }
    emit(type, ...args) { const l = this.listeners?.[type]; l?.callback.apply(l.target, args); }
    getComponentsInChildren(type) { return [...this.components.filter(c => c instanceof type), ...this.children.flatMap(c => c.getComponentsInChildren(type))]; }
    getComponentInChildren(type) { return this.getComponentsInChildren(type)[0]; }
    inverseTransformPoint(out, v) { const p = this.worldPosition; return out.set(new Vec3(v.x - p.x, v.y - p.y, v.z - p.z)); }
    destroy() { this.active = this.isValid = false; this.children.forEach(c => c.destroy()); }
}
class Material { initialize(options) { this.options = options; } setProperty(key, value) { this[key] = value; } destroy() { this.destroyed = true; } }
class MeshRenderer { constructor(node) { this.node = node; } setMaterial(material) { this.material = material; } destroy() { this.destroyed = true; } }
function gunNode(prefab) {
    const gun = new Node(prefab.name);
    for (const name of ['scope', prefab.name, 'magazine']) {
        const mesh = new Node(name); mesh.components.push(new MeshRenderer(mesh)); gun.addChild(mesh);
    }
    return gun;
}
MeshRenderer.ShadowCastingMode = { ON: 1 };
class UITransform {
    constructor() { this.contentSize = { width: 100, height: 100 }; }
    setContentSize(width, height) { this.contentSize = { width, height }; }
    hitTest(p) { const v = this.node.worldPosition; return Math.abs(p.x - v.x) <= this.contentSize.width / 2 && Math.abs(p.y - v.y) <= this.contentSize.height / 2; }
}
class Widget { static AlignMode = { ALWAYS: 2 }; updateAlignment() {} }
class Button { static EventType = { CLICK: 'click' }; static Transition = { NONE: 0 }; constructor() { this.isValid = this.interactable = true; } }
const inputListeners = new Map();
const cc = { Node, Vec3, Material, MeshRenderer, Label: class { static Overflow = { SHRINK: 2 }; }, Component: class { constructor() { this.enabledInHierarchy = true; } },
    UITransform, Widget, Button, Canvas: class {},
    Graphics: class { clear() {} roundRect() {} fill() {} arc(...args) { this.arcArgs = args; } stroke() {} moveTo() {} lineTo() {} close() {} },
    director: {}, assetManager: { bundles: [] },
    Input: { EventType: Object.fromEntries(['KEY_DOWN', 'KEY_UP', 'TOUCH_START', 'TOUCH_END', 'TOUCH_CANCEL', 'TOUCH_MOVE', 'MOUSE_DOWN', 'MOUSE_UP', 'MOUSE_MOVE'].map(k => [k, k])) },
    input: { on: (k, fn, target) => inputListeners.set(k, { fn, target }), off: k => inputListeners.delete(k) },
    EventMouse: { BUTTON_LEFT: 0 }, KeyCode: { ARROW_LEFT: 37, ARROW_RIGHT: 39, KEY_A: 65, KEY_D: 68 },
    SkeletalAnimation: class {}, Layers: { Enum: { DEFAULT: 1, UI_2D: 33554432 } },
    Color: class { constructor(r, g, b, a = 255) { Object.assign(this, { r, g, b, a }); } }, Quat: class { static fromEuler(out) { return out; } },
    instantiate: gunNode, utils: { createMesh: () => ({ destroy() { this.destroyed = true; } }) }, primitives: { box: () => ({}), sphere: () => ({}), torus: () => ({}) },
    tween: () => { const t = { to: () => t, call: () => t, union: () => t, repeatForever: () => t, start: () => t }; return t; },
    _decorator: { ccclass: () => c => c, property: (...args) => args.length >= 2 ? undefined : () => {} } };
const modules = {};
function load(name) {
    if (modules[name]) return modules[name];
    const source = fs.readFileSync(path.join(__dirname, '../assets', name + '.ts'), 'utf8');
    const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true } }).outputText;
    const exports = {};
    vm.runInNewContext(js, { exports, require: n => n === 'cc' ? cc : n.startsWith('./') ? load(n.slice(2)) : {}, console });
    modules[name] = exports;
    return exports;
}
const { GameManager } = load('GameManager');
const { SquadFire, WeaponAppearance } = load('SquadFire');
const { BridgeScenery } = load('BridgeScenery');
const nodeAt = (x, z) => { const n = new Node(); n.setPosition(x, 0, z); return n; };
function manager() {
    const g = new GameManager(); g.node = new Node();
    g.blaster = { name: 'blaster-e' }; g.targetingPose = {};
    g.player = nodeAt(2.83, 0); const parent = nodeAt(100, 200); parent.addChild(g.player);
    g.soldierModel = nodeAt(0, 0);
    g.setSquadCount = n => { g.count = Math.max(0, n); };
    g.rand = (min, max) => (min + max) / 2;
    g.layoutSquad = () => ({});
    return g;
}
const scenery = Object.create(BridgeScenery.prototype);
scenery.root = new Node(); scenery.spans = [new Node()];
scenery.rewardAppearance = new WeaponAppearance();
scenery.surface = scenery.color = () => ({}); scenery.piece = () => new Node();
scenery.label = (parent, text) => { const node = new Node(); const label = new cc.Label(); label.string = text; label.node = node; node.components.push(label); parent.addChild(node); return label; };
const bridge = { gate: () => new Node(), numberedTarget: (x, z, health) => ({ node: nodeAt(x, z), label: { string: String(health) } }),
    floatingRifle: (...args) => scenery.floatingRifle(...args),
    updateRewardDisplay: (...args) => scenery.updateRewardDisplay(...args) };
const g = manager();
const rounds = [];
for (let round = 1; round <= 50; round++) {
    const before = g.tireRewards.length;
    g.addGateRow(bridge, -round * 19, 1, 1);
    if (g.tireRewards.length > before) rounds.push(round);
}
assert.deepEqual(rounds, [1, 3, 5, 8, 11, 15, 20, 25, 30, 35, 40, 45, 50]);
assert.deepEqual(Array.from(g.tireRewards, r => r.challengeSeconds), [1.5, 1.5, 1.5, 3.5, 4, 5, 6, 7, 8, 8, 8, 8, 8]);
assert.ok(g.tireRewards.every(r => r.health === null)); // Lookahead must never snapshot DPS.
assert.equal(g.tireRewards[0].label.string, '');
assert.equal(g.tireRewards[8].label.string, '');
assert.equal(g.tireRewards[0].node.position.z, -24);
assert.equal(g.tireRewards[0].display.children[0].name, 'blaster-e'); // Optional rifle falls back to configured gun.
assert.ok(g.tireRewards.every(r => r.previewDamage === 2)); // Before SquadFire initialization.
for (const [index, reward] of g.tireRewards.entries()) {
    assert.equal(reward.node.position.x, 2.25);
    assert.ok(Math.abs(reward.node.position.x) - 1.05 > 0); // Center is unobstructed.
    assert.ok(Math.abs(reward.node.position.x) + 1.16 < 3.93); // Halo fits inside curb.
    assert.equal(reward.display.position.x, reward.node.position.x);
    assert.equal(reward.display.position.z, reward.node.position.z - 0.6);
    assert.equal(reward.display.getComponentInChildren(cc.Label).string, '火力+1 → 2');
}
const streamed = manager();
streamed.bridge = { ...bridge, extendTo: () => {} };
streamed.spawnBoss = () => {};
streamed.addGateRow(streamed.bridge, -17, -1, 1);
streamed.addGateRow(streamed.bridge, -26, 2, -1);
streamed.nextGateZ = -43;
streamed.extendCourse(-550);
assert.equal(streamed.tireRewards[0].node.position.z, -22); // Round 1, opening gate.
assert.equal(streamed.tireRewards[1].node.position.z, -48); // Round 3, first streamed gate.
assert.equal(streamed.tireRewards[8].node.position.z, streamed.gates[29].z - 5); // Round 30, not wave 30.
// Seeded procedural generation: sample once per spawn, never per update.
const isPositive = v => v === 'double' || (typeof v === 'number' && v > 0);
const isPenalty = v => v === 'halve' || (typeof v === 'number' && v < 0);
let dualCount = 0, eligibleCount = 0;
const lanes = new Set(), positions = new Set(), durations = new Set(), contents = new Set();
for (let seed = 1; seed <= 100; seed++) {
    const m = manager(); let state = seed, draws = 0;
    m.rand = (min, max) => { draws++; state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return min + state / 4294967296 * (max - min); };
    m.startZ = 137; m.bridge = { ...bridge, extendTo() {} };
    for (const distance of [17, 26]) {
        const values = m.randomGateValues(m.startZ - distance, false, true);
        assert.ok(values.includes(-1)); assert.ok(values.some(v => v === 1 || v === 2));
        m.addGateRow(m.bridge, m.startZ - distance, ...values);
    }
    m.nextGateZ = m.startZ - 43;
    m.player.position.z = m.startZ - 220;
    m.extendCourse(m.player.position.z); // Lookahead reaches305 while player is only at220.
    assert.ok(m.gates.filter(r => m.startZ - r.z < 300).every(r => [r.left.value,r.right.value].some(isPositive)));
    m.extendCourse(m.startZ - 1200);
    for (const [i, row] of m.gates.entries()) {
        const values = [row.left.value, row.right.value]; contents.add(values.join(','));
        assert.ok(values.every(v => v === 'double' || v === 'halve' || (Number.isInteger(v) && Math.abs(v) >= 1 && Math.abs(v) <= 3)));
        if (m.startZ - row.z < 300) assert.ok(values.some(isPositive));
        if (i >= 2 && (i - 1) % 5 === 0) assert.ok(values.includes('double') && values.every(isPositive));
        else if (m.startZ - row.z >= 300) { eligibleCount++; if (values.every(isPenalty)) dualCount++; }
        if (i > 2) { const gap = m.gates[i - 1].z - row.z; assert.ok(gap >= 17 && gap <= 22); }
    }
    const rewardRounds = [1,3,5,8,11,15];
    for (let round = 20; round <= m.gates.length; round += 5) rewardRounds.push(round);
    assert.equal(m.tireRewards.length, rewardRounds.length);
    for (const [i, reward] of m.tireRewards.entries()) {
        const rowIndex = rewardRounds[i] - 1, offset = m.gates[rowIndex].z - reward.node.position.z;
        assert.ok(offset >= 4 && offset <= 6);
        if (m.gates[rowIndex + 1]) assert.ok(reward.node.position.z - m.gates[rowIndex + 1].z >= 3);
        assert.ok(Math.abs(reward.node.position.x) >= 1.9 && Math.abs(reward.node.position.x) <= 2.6);
        assert.ok(Math.abs(reward.node.position.x) + 1.16 < 3.93);
        assert.ok(Math.abs(reward.node.position.x) - 1.05 > 0.56); // Entire centered formation clears.
        if (i < 3) { assert.ok(reward.challengeSeconds >= 1 && reward.challengeSeconds <= 2); durations.add(reward.challengeSeconds); }
        else assert.equal(reward.challengeSeconds, [3.5,4,5,6,7,8][Math.min(i - 3,5)]);
        assert.equal(reward.health, null); assert.equal(reward.label.string, '');
        lanes.add(Math.sign(reward.node.position.x)); positions.add(reward.node.position.x);
    }
    const frozen = JSON.stringify(m.gates.map(r => [r.z,r.left.value,r.right.value]).concat(m.tireRewards.map(r => [r.node.position.x,r.node.position.z,r.challengeSeconds,r.aimRange])));
    const before = draws;
    for (let i = 0; i < 10; i++) { m.extendCourse(m.startZ - 1200); m.refreshRewardPreviews(); }
    assert.equal(draws, before);
    assert.equal(JSON.stringify(m.gates.map(r => [r.z,r.left.value,r.right.value]).concat(m.tireRewards.map(r => [r.node.position.x,r.node.position.z,r.challengeSeconds,r.aimRange]))), frozen);
}
assert.ok(dualCount / eligibleCount > 0.35 && dualCount / eligibleCount < 0.45);
assert.equal(lanes.size, 2); assert.ok(positions.size > 100); assert.equal(durations.size, 11); assert.ok(contents.size > 20);
for (const sample of [0, 1 - Number.EPSILON]) {
    const m = manager(); m.rand = (min,max) => min + sample * (max - min);
    m.addGateRow(bridge, -17, 1, -1);
    assert.equal(m.tireRewards[0].challengeSeconds, sample === 0 ? 1 : 2);
    assert.equal(Math.sign(m.tireRewards[0].node.position.x), sample === 0 ? -1 : 1);
    for (const distance of [299.999, 300, 300.001]) {
        const values = m.randomGateValues(-distance);
        assert.equal(values.every(isPenalty), distance >= 300 && sample === 0);
    }
}
console.log('Random course regressions passed:100 seeded runs,1–2s early/unchanged late rewards,300m exact threshold and lookahead safety,40% eligible dual penalties, bonus cadence, lane/content variety,17–22m gaps,4–6m tire offsets, curb/center/next-gate clearance, immutable samples and spawn rounds.');

const destroyed = manager();
const rewardNode = nodeAt(2.83, -6), displayNode = new Node();
rewardNode.destroy = () => {}; // Cocos destruction is deferred; active=false must guard late impacts.
destroyed.tireRewards = [{ node: rewardNode, label: {}, health: 8, display: displayNode }];
let upgrades = 0;
destroyed.squadFire = { upgrade: () => upgrades++ };
destroyed.hitTarget(rewardNode, 8);
destroyed.hitTarget(rewardNode, 8); // Late projectiles cannot grant a duplicate upgrade.
assert.equal(upgrades, 1);
assert.equal(displayNode.isValid, false);
assert.equal(destroyed.tireRewards.length, 0);
const missing = manager(); missing.blaster = null;
missing.addGateRow(bridge, -17, 1, 1);
assert.equal(missing.tireRewards.length, 0);
const gun = new SquadFire(new Node(), { name: 'blaster-e' }, {}, 28.5);
const bodyColor = node => node.getComponentsInChildren(MeshRenderer).find(r => r.node.name === node.name).material.mainColor;
const held = gun.createGun(); held.active = true;
gun.weapons.set(new Node(), { gun: held });
const colors = new Set();
for (let tier = 2; tier <= 6; tier++) {
    gun.upgrade(null);
    assert.equal(gun.currentDamage, tier);
    assert.equal(gun.upgraded, false); // Original grip stays valid without optional rifle.
    assert.equal(held.isValid, true); // Recolor existing model, not replacement every tier.
    const color = bodyColor(held);
    colors.add(JSON.stringify(color));
    scenery.updateRewardDisplay(g.tireRewards[tier - 2].display, tier);
    assert.deepEqual(bodyColor(g.tireRewards[tier - 2].display.children[0]), color);
    assert.deepEqual(bodyColor(gun.createGun()), color); // Same creation path used by future recruits.

}
assert.equal(colors.size, 5);
for (let i = 6; i < 100; i++) gun.upgrade(null);
assert.equal(gun.damage, 100);
const skipped = manager(); skipped.bridge = bridge;
skipped.squadFire = new SquadFire(new Node(), skipped.blaster, {}, 28.5);
const original = skipped.squadFire.createGun(); original.active = true;
const weapon = { gun: original }; skipped.squadFire.weapons.set(new Node(), weapon);
skipped.displayRifle = { name: 'blaster-f' };
for (let round = 1; round <= 20; round++) skipped.addGateRow(bridge, -round * 19, 1, 1);
const older = skipped.tireRewards[0], third = skipped.tireRewards[2];
const collectedLabel = third.display.getComponentInChildren(cc.Label).node;
skipped.lockRewardHealth(third.node, 1 / 60);
skipped.hitTarget(third.node, third.health);
assert.equal(skipped.squadFire.currentDamage, 2); // Skipping first two still grants exactly +1.
assert.equal(original.isValid, false);
assert.equal(weapon.gun.name, 'blaster-f');
assert.equal(weapon.gun.active, true);
assert.equal(collectedLabel.isValid, false);
assert.equal(older.previewDamage, 3);
assert.equal(older.display.getComponentInChildren(cc.Label).string, '火力+1 → 3');
assert.notDeepEqual(bodyColor(older.display.children[0]), bodyColor(weapon.gun));
const sameGun = weapon.gun;
skipped.lockRewardHealth(older.node, 1 / 60);
skipped.hitTarget(older.node, older.health);
assert.equal(skipped.squadFire.currentDamage, 3); // An earlier reward also grants exactly +1.
assert.equal(weapon.gun, sameGun);
for (const reward of [...skipped.tireRewards]) {
    skipped.lockRewardHealth(reward.node, 1 / 60);
    skipped.hitTarget(reward.node, reward.health);
    assert.equal(weapon.gun, sameGun); // Subsequent upgrades recolor the held rifle too.
    assert.deepEqual(bodyColor(skipped.squadFire.createGun()), bodyColor(weapon.gun));
}
assert.equal(skipped.squadFire.currentDamage, 8);
assert.deepEqual(bodyColor(weapon.gun), bodyColor(held));
const recruit = new Node('Recruit');
recruit.getChildByPath = () => new Node(); recruit.getComponent = () => null;
const shoulder = new Node(); shoulder.rotation = { clone: () => ({}) };
skipped.squadFire.findArm = () => ({ upper: { parent: shoulder } });
skipped.squadFire.targetingPose = { createEvaluator: () => ({ evaluate: () => {} }) };
skipped.squadFire.equip(recruit);
assert.equal(skipped.squadFire.weapons.get(recruit).gun.name, 'blaster-f');
assert.deepEqual(bodyColor(skipped.squadFire.weapons.get(recruit).gun), bodyColor(held));
const behind = nodeAt(2.83, 2), ahead = nodeAt(2.83, -4);
gun.shotRange = 28.5;
assert.equal(gun.findTarget(new Vec3(2.83, 0, 0), [], [behind, ahead]), ahead);
function pathCase(gateZ, tireZ, initial, expected) {
    const m = manager(); m.count = initial;
    m.previousPlayerPosition = new Vec3(2.83, 0, 0); m.player.position.z = -12;
    m.gates = [{ z: gateZ, left: { value: 2, node: new Node() }, right: { value: 2, node: new Node() } }];
    const tire = nodeAt(2.83, tireZ); m.player.parent.addChild(tire);
    m.tireRewards = [{ node: tire, collided: false, display: null }];
    m.checkPathEvents(0);
    assert.equal(m.count, expected);
    return m;
}
pathCase(-3, -8, 2, 1); // Gate first: 2 + 2 - 3, translated parent.
pathCase(-9, -4, 2, 0); // Tire first kills squad; later gate must not resurrect it.
const cleanup = pathCase(-3, -8, 2, 1);
const cleanupDisplay = scenery.floatingRifle({ name: 'blaster-f' }, 2.55, 2.2, -8, 3);
const cleanupLabel = cleanupDisplay.getComponentInChildren(cc.Label).node;
cleanup.tireRewards[0].display = cleanupDisplay;
cleanup.player.position.z = -20;
cleanup.cleanupTireRewards();
assert.equal(cleanup.tireRewards.length, 0);
assert.equal(cleanup.player.parent.children[1].isValid, false);
assert.equal(cleanupLabel.isValid, false);
// Real scenery methods must parent to stable root, never a recycled span.
const target = scenery.numberedTarget(2.83, -100, 8).node;
assert.equal(target.parent, scenery.root);
assert.equal(target.position.z, -100);
// Keep both configured fire intervals unchanged; tire cadence now carries fractional frames.
const fireSource = fs.readFileSync(path.join(__dirname, '../assets/SquadFire.ts'), 'utf8');
assert.equal(Number(fireSource.match(/const SHOT_INTERVAL = ([\d.]+);/)[1]), 0.38 / 2);
assert.equal(Number(fireSource.match(/const TIRE_BURST_INTERVAL = ([\d.]+);/)[1]), 0.09 / 2);
// Range is reward-specific, preserves early targeting, and fits the moving late challenge.
assert.equal(g.tireRewards[0].aimRange, 16);
assert.equal(g.tireRewards[8].aimRange, 42.75);
for (const reward of g.tireRewards) {
    assert.ok((reward.aimRange - 1.05 - 1.2) / 4.5 > reward.challengeSeconds + 0.29);
}
const farTire = nodeAt(2.83, -40);
assert.equal(gun.findTarget(new Vec3(2.83, 0, 0), [], [farTire]), null);
assert.equal(gun.findTarget(new Vec3(2.83, 0, 0), [], [farTire], () => 42.75), farTire);
assert.equal(gun.findTarget(new Vec3(0, 0, 0), [], [farTire], () => 42.75), null);
const closeEnemy = nodeAt(2.83, -1);
assert.equal(gun.findTarget(new Vec3(2.83, 0, 0), [closeEnemy], [farTire], () => 42.75), closeEnemy);
const snapshot = manager(); snapshot.bridge = bridge;
snapshot.squadFire = new SquadFire(new Node(), snapshot.blaster, {}, 28.5);
snapshot.addGateRow(bridge, -100, 1, 1);
const snap = snapshot.tireRewards[0];
snapshot.hitTarget(snap.node, 99999); assert.equal(snap.health, null);
snapshot.count = 9; snapshot.squadFire.damage = 5;
snapshot.squadFire.bonusDamage = 1; snapshot.squadFire.fireRateMultiplier = 1.5;
snapshot.refreshRewardPreviews(); assert.equal(snap.health, null);
snapshot.lockRewardHealth(snap.node, 1 / 60);
assert.equal(snap.health, Math.ceil(9 * 6 / 0.03 * snap.challengeSeconds));
snapshot.hitTarget(snap.node, 6); const damagedHP = snap.health;
snapshot.count = 1; snapshot.squadFire.damage = 1;
snapshot.squadFire.bonusDamage = 0; snapshot.squadFire.fireRateMultiplier = 1;
snapshot.refreshRewardPreviews(); snapshot.lockRewardHealth(snap.node, 1 / 30);
assert.equal(snap.health, damagedHP); assert.equal(snap.label.string, String(damagedHP));
assert.equal(snap.aimRange, 16); // Buff expiry/count/tier changes never resize range or heal HP.
console.log('Reward regressions passed: staged1–8s, first-launch DPS snapshot with buffs, frozen damaged HP, reward-specific16–42.75 range, exact +1, previews/colors, duplicate impacts, cleanup and swept ordering.');

// Exercise real SquadFire.update/findTarget + manager snapshot/hits with delayed bullet arrivals.
// Engine-only arm posing/rendering is stubbed; no enemies, losses, gates or buff expiry here.
let timedCases = 0, minimumOverhead = Infinity, maximumOverhead = -Infinity;
for (const fps of [30, 60, 120]) for (const count of [1, 9]) {
    for (const round of [1, 3, 5, 8, 11, 15, 20, 25, 30]) for (const enhanced of [false, true])
    for (const earlySeconds of round <= 5 ? [1, 1.5, 2] : [1.5]) {
        const m = manager(); m.count = count;
        m.rand = (min, max) => min === 1 && max === 2 ? earlySeconds : (min + max) / 2;
        m.squadFire = new SquadFire(new Node(), m.blaster, {}, 28.5);
        const fire = m.squadFire; fire.damage = enhanced ? 5 : 1;
        fire.bonusDamage = enhanced ? 1 : 0; fire.fireRateMultiplier = enhanced ? 1.5 : 1;
        fire.poseArm = () => {};
        m.gateRound = round - 1; m.rewardIndex = [1,3,5,8,11,15,20,25,30].indexOf(round);
        m.addGateRow(bridge, -100, 1, 1); const reward = m.tireRewards[0];
        reward.node.setPosition(2.55, 0, -reward.aimRange + 0.01);
        const troops = [];
        for (let i = 0; i < count; i++) {
            const troop = nodeAt(2.55 + [0,-0.56,0.56][i % 3], Math.floor(i / 3) * 0.6);
            troops.push(troop);
            fire.weapons.set(troop, {gun:fire.createGun(), aimPose:[], left:{upper:troop},
                right:{upper:troop,hand:troop}, cooldown:0.12+i*0.007, recoil:0});
        }
        let time = 0, firstLaunch = null, pending = [], launchesThisFrame = 0;
        fire.drawShot = (from, to, targeted, onImpact) => {
            launchesThisFrame++;
            if (onImpact) { assert.notEqual(reward.health, null); pending.push({at:time+0.29, onImpact}); }
        };
        const initialDamage = fire.currentDamage;
        // Passive aiming, with cooldown still positive, must not lock HP.
        fire.update(0, [], [reward.node], (n,d) => m.hitTarget(n,d), null,
            () => reward.aimRange, n => m.lockRewardHealth(n, 1 / fps));
        assert.equal(reward.health, null);
        while (m.tireRewards.length && time < 12) {
            time += 1 / fps; launchesThisFrame = 0;
            troops.forEach(t => t.position.z -= 4.5 / fps);
            fire.update(1 / fps, [], [reward.node], (n,d) => m.hitTarget(n,d), null,
                () => reward.aimRange, n => {
                    if (firstLaunch === null) firstLaunch = time;
                    m.lockRewardHealth(n, 1 / fps);
                });
            assert.ok(launchesThisFrame <= count); // No catch-up burst at any tested rate.
            const arriving = pending.filter(p => p.at <= time); pending = pending.filter(p => p.at > time);
            arriving.forEach(p => p.onImpact());
            assert.ok(troops[0].position.z - reward.node.position.z > 1.05,
                `must break before contact: ${fps}Hz/${count} troops/${reward.challengeSeconds}s/buff=${enhanced}`);
        }
        assert.equal(m.tireRewards.length, 0);
        assert.equal(fire.currentDamage, initialDamage + 1);
        pending.forEach(p => p.onImpact()); assert.equal(fire.currentDamage, initialDamage + 1);
        const elapsed = time - firstLaunch, overhead = elapsed - reward.challengeSeconds;
        assert.ok(overhead >= -0.1 && overhead < 0.7, `timed challenge overhead ${overhead}`);
        minimumOverhead = Math.min(minimumOverhead, overhead); maximumOverhead = Math.max(maximumOverhead, overhead);
        timedCases++;
    }
}
console.log(`Timed reward regressions passed: ${timedCases} actual firing cases at30/60/120Hz,1/9 troops,1–8s,base/haste+damage; arrival/formation overhead ${minimumOverhead.toFixed(3)}–${maximumOverhead.toFixed(3)}s, all before contact, exact-once +1.`);

// Spatial horde exercises real GameManager methods: no timer-based emission.
function streamManager() {
    const m = manager(); m.node = new Node(); m.player.setPosition(0, 0, -30);
    m.previousPlayerPosition.set(m.player.position); m.rand = (min, max) => (min + max) / 2;
    return m;
}
function fillHorde(m) { for (let i = 0; i < 80; i++) m.updateZombieHorde(false); }
const spatial = streamManager();
spatial.updateZombieHorde(false); assert.equal(spatial.zombies.length, 16); // Two rows/frame.
fillHorde(spatial); assert.equal(spatial.zombies.length, 664); // 83 rows, vs 42 at the old 4-unit spacing.
assert.ok(spatial.zombies.length / 336 > 1.97);
assert.equal(spatial.zombies[0].position.z - spatial.zombies[8].position.z, 2);
assert.equal(spatial.initialHordeReady, true);
for (let i = 0; i < spatial.zombies.length; i += 8) {
    const row = spatial.zombies.slice(i, i + 8);
    assert.ok(row[0].position.x < -2.9 && row[7].position.x > 2.9);
    assert.ok(row.every(z => spatial.player.position.z - z.position.z >= 48));
    assert.ok(row.every(z => spatial.player.position.z - z.position.z <= 213));
    assert.ok(row.every(z => spatial.zombieHealth.get(z) === 1));
}
const initialSize = spatial.zombies.length;
fillHorde(spatial); assert.equal(spatial.zombies.length, initialSize); // Waiting cannot emit more.
spatial.player.position.z -= 12;
spatial.updateZombieHorde(false);
assert.equal(spatial.zombies.length, initialSize + 16);
for (const fresh of spatial.zombies.slice(initialSize)) {
    assert.ok(spatial.player.position.z - fresh.position.z > 196);
    assert.equal(spatial.zombieProxies.get(fresh).enabled, false);
}
spatial.player.position.z -= 1000; // Teleport/hitch skips obsolete rows, never catches up near the squad.
const beforeTeleport = spatial.zombies.length;
spatial.updateZombieHorde(false);
assert.ok(spatial.zombies.length - beforeTeleport <= 16);
for (const fresh of spatial.zombies.slice(beforeTeleport)) assert.ok(spatial.player.position.z - fresh.position.z > 196);
const fade = streamManager(); fade.spawnZombie(0, fade.player.position.z - 200);
const farNode = fade.zombies[0], proxy = fade.zombieProxies.get(farNode);
fade.updateZombieAppearance(); assert.equal(proxy.enabled, false);
farNode.position.z += 6; fade.updateZombieAppearance();
assert.equal(proxy.enabled, true); assert.equal(proxy.material.mainColor.a, 32);
farNode.position.z += 12; fade.updateZombieAppearance(); assert.ok(proxy.material.mainColor.a > 32);
assert.ok(fade.zombieFadeMaterials.filter(Boolean).length <= 7);
fade.zombiePrefab = { name: 'ZombieModel' };
for (let i = 0; i < 8; i++) fade.spawnZombie(i * 0.5, fade.player.position.z - 40);
for (const node of fade.zombies) node.position.z = fade.player.position.z - 35;
fade.updateZombieAppearance(); assert.equal(fade.zombieProxies.size, 5); // At most four promotions/frame.
fade.updateZombieAppearance(); assert.equal(fade.zombieProxies.size, 1);
const capped = streamManager(); fillHorde(capped);
for (let i = 0; i < 200; i++) { capped.player.position.z -= 4; capped.updateZombieHorde(false); }
assert.equal(capped.zombies.length, 960);
const paused = streamManager(); paused.updateZombieHorde(true); assert.equal(paused.zombies.length, 0);
paused.updateZombieHorde(false); assert.equal(paused.zombies.length, 16);
paused.finished = true; fillHorde(paused); assert.equal(paused.zombies.length, 16);
paused.finished = false; paused.count = 0; fillHorde(paused); assert.equal(paused.zombies.length, 16);
const march = streamManager(); march.spawnZombie(3, march.player.position.z - 100);
const oldZ = march.zombies[0].position.z;
march.moveZombies(0.2, 0); assert.equal(march.zombies[0].position.z, oldZ + 0.3);
assert.equal(march.zombies[0].position.x, 3); // Distant rows do not collapse into center lane.
const kills = streamManager();
kills.spawnZombie(0, -60, 2); const survivor = kills.zombies[0];
kills.hitTarget(survivor, 1); assert.equal(kills.zombieKills, 0);
for (let i = 1; i <= 400; i++) {
    kills.spawnZombie(0, -60); const victim = kills.zombies[kills.zombies.length - 1];
    victim.destroy = () => {}; // Deferred engine destruction.
    kills.hitTarget(victim, 1); kills.hitTarget(victim, 1); // Initial zombies die to one base bullet.
    assert.equal(kills.zombieKills, i);
    assert.equal(kills.zombieHealth.has(victim), false);
    assert.equal(kills.currentZombieHP, 1); // Kills no longer drive difficulty.
}
for (const [meters, hp] of [[0, 1], [99.99, 1], [100, 2], [199.99, 2], [200, 3], [300, 4]]) {
    kills.player.position.z = kills.startZ - meters;
    assert.equal(kills.currentZombieHP, hp);
    kills.spawnZombie(0, kills.player.position.z - 60);
    const fresh = kills.zombies[kills.zombies.length - 1];
    assert.equal(kills.zombieHealth.get(fresh), hp);
    assert.equal(kills.zombieHealth.get(survivor), 1); // Existing damaged enemies never heal.
    kills.removeZombie(kills.zombies.length - 1); // Cleanup never counts as a kill.
}
assert.equal(kills.zombieKills, 400);
kills.countLabel = {}; kills.showCount();
assert.ok(kills.countLabel.string.includes('击杀 400 · 僵尸 HP 4'));
const passing = streamManager(); passing.spawnZombie(0, 10);
passing.moveZombies(0.1, 0); assert.equal(passing.zombies.length, 0); assert.equal(passing.zombieKills, 0);
const contact = streamManager(); contact.soldierModel = null; contact.spawnZombie(0, -30);
contact.moveZombies(0.1, 0); assert.equal(contact.count, 0); assert.equal(contact.zombieKills, 0);
const firstGate = streamManager(); firstGate.player.setPosition(0, 0, -16.9);
firstGate.previousPlayerPosition.set(firstGate.player.position);
firstGate.gates = [{ z: -17 }]; firstGate.spawnZombie(0, -19.5);
firstGate.moveZombies(1, 0); assert.equal(firstGate.zombies[0].position.z, -19.4);
assert.equal(firstGate.count, 1); // Existing first-recruit advance protection retained.
const frame = streamManager(); let spawnFrames = 0;
frame.extendCourse = frame.cleanupTireRewards = frame.frameSquad = frame.showCount = () => {};
frame.updateZombieHorde = (...args) => { spawnFrames++; GameManager.prototype.updateZombieHorde.apply(frame, args); };
for (let i = 0; i < 120; i++) frame.lateUpdate(1 / 60);
assert.equal(spawnFrames, 120); assert.ok(frame.zombies.length > 0);
const warm = streamManager(); warm.player.position.z = -9; warm.previousPlayerPosition.set(warm.player.position);
warm.extendCourse = warm.cleanupTireRewards = warm.frameSquad = warm.showCount = () => {};
warm.lateUpdate(1 / 60); const warmZ = warm.zombies[0].position.z;
warm.lateUpdate(1 / 60); assert.equal(warm.zombies[0].position.z, warmZ);
assert.equal(warm.count, 1); // Warmup has a far view of the horde, but no attacks/motion.
assert.equal(destroyed.zombieKills, 0); assert.equal(skipped.zombieKills, 0); // Tires excluded.
const bossKill = streamManager(); const bossNode = new Node();
bossKill.bosses = [{ node: bossNode, health: 1, maxHealth: 1, title: 'Boss', label: { node: new Node() }, warning: new Node() }];
bossKill.hitTarget(bossNode, 1); assert.equal(bossKill.zombieKills, 0);
console.log('Horde regressions passed: spatial full-width rows, 48–212 initial band, hidden far-frontier generation, 2-row frame cap, 960 population cap, shared fade buckets, bounded model promotion, distant marching, warmup, no stationary timed emission, 100m/200m HP boundaries independent of kills, no healing/duplicate kills, cleanup/contact/tire/boss exclusions, first-recruit protection, HUD.');

const { PlayerRunner } = load('PlayerRunner');
function formationManager() {
    const m = new GameManager(); m.node = new Node();
    m.player = nodeAt(0, -30); new Node().addChild(m.player);
    m.soldierModel = nodeAt(0, 0); m.soldierModel.position.y = -0.7;
    m.player.addChild(m.soldierModel);
    m.squadFormation = new Node(); m.player.addChild(m.squadFormation);
    const runner = new PlayerRunner(); runner.node = m.player; m.player.components.push(runner);
    m.countLabel = {};
    m.previousPlayerPosition.set(m.player.position);
    return m;
}
function slots(m) { return [m.soldierModel, ...m.squadMembers].map(n => [n.position.x, n.position.y, n.position.z]); }
function checkGrid(m, count) {
    assert.equal(m.count, count); assert.equal(m.squadMembers.length, count - 1);
    const positions = slots(m), base = positions[0];
    assert.equal(new Set(positions.map(p => JSON.stringify(p))).size, count);
    positions.forEach(([x, y, z], i) => {
        const column = i % 3;
        assert.ok(Math.abs(x - base[0] - (column === 0 ? 0 : column === 1 ? -0.56 : 0.56)) < 1e-10);
        assert.equal(y, base[1]);
        assert.ok(Math.abs(z - base[2] - Math.floor(i / 3) * 0.6) < 1e-10);
    });
    assert.equal(m.squadRearExtent(), base[2] + Math.floor((count - 1) / 3) * 0.6);
    assert.ok(m.countLabel.string.includes(`队伍 ${count}/9`));
}
const formation = formationManager();
for (let count = 1; count <= 9; count++) {
    formation.setSquadCount(count); checkGrid(formation, count);
    const before = slots(formation); formation.setSquadCount(count);
    assert.deepEqual(slots(formation), before); // Re-layout is deterministic, not randomized.
    for (const edge of [-3.5, 3.5]) {
        formation.player.position.x = edge; const bounds = formation.layoutSquad();
        checkGrid(formation, count);
        assert.equal(formation.squadFormation.position.x, 0);
        for (const [x] of slots(formation)) assert.ok(Math.abs(formation.player.position.x + x) <= 3.5 + 1e-10);
        assert.equal(bounds.left, Math.min(...slots(formation).map(p => p[0])));
        assert.equal(bounds.right, Math.max(...slots(formation).map(p => p[0])));
    }
}
assert.equal(new Set(slots(formation).map(p => p[0])).size, 3);
assert.equal(new Set(slots(formation).map(p => p[2])).size, 3);
assert.equal(formation.squadRearExtent(), 1.2);
formation.setSquadCount(99); checkGrid(formation, 9);
for (const value of [6, 'double']) {
    formation.setSquadCount(8); formation.player.setPosition(2, 0, -32);
    formation.previousPlayerPosition.set(new Vec3(2, 0, -30));
    formation.gates = [{ z: -31, left: { value, node: new Node() }, right: { value, node: new Node() } }];
    formation.checkPathEvents(0); checkGrid(formation, 9); // Actual additive/multiplier gate paths.
}
// Full additive gates grant exactly one existing buff, irrespective of their +X value.
for (const kind of [0, 1, 2]) {
    const m = formationManager(); m.setSquadCount(9);
    m.rand = () => kind + 0.25;
    let pickups = 0;
    m.showBuffPickup = () => { pickups++; };
    const cross = value => {
        m.player.setPosition(2, 0, -32);
        m.previousPlayerPosition.set(new Vec3(2, 0, -30));
        m.gates = [{ z: -31, left: { value, node: new Node() }, right: { value, node: new Node() } }];
        m.checkPathEvents(0);
    };
    cross(3); checkGrid(m, 9); assert.equal(pickups, 1);
    assert.equal(m.damageBuffTime, kind === 0 ? 10 : 0);
    assert.equal(m.hasteBuffTime, kind === 1 ? 10 : 0);
    assert.equal(m.shieldCharges, kind === 2 ? 1 : 0);
    m.checkPathEvents(0); assert.equal(pickups, 1); // Consumed gate cannot award twice.
    m.updateRescueBuffs(3); cross(1); assert.equal(pickups, 2);
    assert.equal(kind === 0 ? m.damageBuffTime : kind === 1 ? m.hasteBuffTime : m.shieldCharges, kind === 2 ? 1 : 10);
    cross('double'); assert.equal(pickups, 2); checkGrid(m, 9);
    cross(-1); assert.equal(m.count, 8); assert.equal(pickups, 2);
    cross(3); checkGrid(m, 9); assert.equal(pickups, 2); // Reaching cap is recruitment, not an extra buff.
    cross('halve'); assert.equal(m.count, 4); assert.equal(pickups, 2);
}
for (const count of [8, 7, 6, 5, 4, 3, 2, 1, 9]) {
    formation.setSquadCount(count); checkGrid(formation, count);
}
const baseSlot = slots(formation)[0];
for (const casualty of [2, -1, 0, -1]) {
    formation.removeSoldier(casualty); formation.setSquadCount(formation.count - 1);
    checkGrid(formation, formation.count); assert.deepEqual(slots(formation)[0], baseSlot);
    formation.setSquadCount(9); checkGrid(formation, 9);
    assert.deepEqual(slots(formation)[0], baseSlot); // No accumulated row drift after promotions/recruits.
}
const steering = formation.player.getComponent(PlayerRunner);
formation.player.position.x = 3.5; formation.layoutSquad();
const atEdge = formation.player.position.x;
formation.previousPlayerPosition.set(formation.player.position);
steering.slide(0.8); formation.layoutSquad();
assert.equal(formation.player.position.x, atEdge);
assert.equal(formation.previousPlayerPosition.x, atEdge); // Layout never mutates sweep history.
steering.slide(-0.2); formation.layoutSquad();
assert.ok(formation.player.position.x < atEdge); // Edge clamp never sticks input.
const edgeCollision = formationManager(); edgeCollision.setSquadCount(9);
edgeCollision.player.position.x = 3.5; edgeCollision.layoutSquad();
edgeCollision.previousPlayerPosition.set(edgeCollision.player.position);
const edgeTire = nodeAt(3.5, -30); edgeCollision.player.parent.addChild(edgeTire);
assert.equal(edgeCollision.tireContactTime({ node: edgeTire, collided: false }, 0, 0), 0);
edgeCollision.spawnZombie(3.5, -30); edgeCollision.moveZombies(0, 0);
checkGrid(edgeCollision, 8); // Right-front collision, followed by real casualty repack.
const leaderCollision = formationManager(); leaderCollision.setSquadCount(9);
leaderCollision.spawnZombie(0, -30); leaderCollision.moveZombies(0, 0);
checkGrid(leaderCollision, 8); assert.equal(leaderCollision.soldierModel.parent, leaderCollision.player);
assert.deepEqual(slots(leaderCollision)[0], [0, -0.7, 0]);
const authoredBase = formationManager(); authoredBase.soldierModel.setPosition(0.1, -0.7, 0.2);
for (let cycle = 0; cycle < 3; cycle++) {
    authoredBase.setSquadCount(9); authoredBase.removeSoldier(-1); authoredBase.setSquadCount(8);
    checkGrid(authoredBase, 8); assert.deepEqual(slots(authoredBase)[0], [0.1, -0.7, 0.2]);
}
const rearCleanup = formationManager(); rearCleanup.setSquadCount(9);
const rearTire = nodeAt(0, rearCleanup.player.position.z + 5.1); rearCleanup.player.parent.addChild(rearTire);
rearCleanup.tireRewards = [{ node: rearTire, display: null }]; rearCleanup.cleanupTireRewards();
assert.equal(rearCleanup.tireRewards.length, 1); // Keep while within full 1.2-unit rear plus4.
rearTire.position.z += 0.2; rearCleanup.cleanupTireRewards(); assert.equal(rearCleanup.tireRewards.length, 0);
for (const aspect of [0.5, 16 / 9]) {
    const cameraNode = new Node(); cameraNode.eulerAngles = { x: -45 };
    formation.squadCamera = { node: cameraNode, fov: 45, camera: { aspect } };
    formation.cameraHome.set(new Vec3(0, 6, 10));
    const bounds = formation.layoutSquad(); formation.frameSquad(bounds.left, bounds.right, 1 / 60);
    assert.ok(Object.values(cameraNode.position).every(Number.isFinite));
    const tangent = Math.tan(Math.PI / 8) * 0.9, sin = Math.SQRT1_2;
    for (const [x, y, z] of slots(formation)) {
        const p = cameraNode.position;
        const depth = (p.y - y) * sin + (p.z - z) * sin;
        assert.ok(Math.abs(x - p.x) <= depth * tangent * aspect);
        assert.ok(Math.abs((y - p.y) * sin - (z - p.z) * sin) <= depth * tangent);
    }
}
formation.setSquadCount(-3); assert.equal(formation.count, 0); assert.equal(formation.squadMembers.length, 0);
assert.equal(formation.soldierModel.active, false);
console.log('Formation regressions passed: real counts1–9, cap9 and gate bonuses/multiplier, deterministic 3x3 including leader, no overlaps, loss/recruit/promotion repacking, no row drift, rear extent, road-edge regularity, steering/sweep history, tire/zombie contacts, HUD cap.');
function runningFight() {
    const m = streamManager(); m.count = 12;
    m.extendCourse = m.cleanupTireRewards = m.frameSquad = m.showCount = () => {};
    const runner = new PlayerRunner(); runner.node = m.player; m.player.components.push(runner);
    const makeBoss = z => ({ node: nodeAt(0, z), phase: 'waiting', health: 9999, maxHealth: 9999,
        label: { node: new Node() }, title: 'Boss', warning: new Node(), attackTimer: 0 });
    const boss = makeBoss(m.player.position.z - 24); boss.node.active = false; boss.warning.active = false;
    const queued = makeBoss(m.player.position.z - 28); queued.node.active = false; queued.warning.active = false;
    m.bosses = [boss, queued];
    return { m, runner, boss, queued };
}
function fightStep(f, dt = 1 / 60) { f.runner.update(dt); f.m.lateUpdate(dt); }
for (const fps of [30, 60, 120]) {
    const f = runningFight(); const start = f.m.player.position.z;
    for (let i = 0; i < 6 * fps; i++) fightStep(f, 1 / fps);
    assert.ok(Math.abs(f.m.player.position.z - (start - 27)) < 1e-8);
    assert.equal(f.runner.speed, 4.5); assert.equal(f.runner.forwardLimitZ, null);
    assert.ok(f.m.count < 12 && f.m.count >= 8); // Finite, spaced melee strikes, not per-frame loss.
    assert.equal(f.queued.phase, 'waiting'); assert.equal(f.queued.node.active, false);
    assert.ok(f.m.player.position.z - f.boss.node.position.z <= 24.1);
}
const melee = runningFight();
for (let i = 0; i < 240 && melee.boss.phase !== 'windup'; i++) fightStep(melee);
assert.equal(melee.boss.phase, 'windup'); assert.equal(melee.m.count, 12);
assert.equal(melee.boss.warning.active, true);
const warningStart = melee.boss.warning.position.z;
fightStep(melee); assert.ok(melee.boss.warning.position.z < warningStart);
assert.equal(melee.boss.warning.position.z, melee.boss.node.position.z);
for (let i = 0; i < 60 && melee.boss.phase === 'windup'; i++) fightStep(melee);
assert.equal(melee.m.count, 10); assert.equal(melee.boss.phase, 'retreat');
const strikeDepth = melee.m.player.position.z - melee.boss.node.position.z;
fightStep(melee); assert.ok(melee.m.player.position.z - melee.boss.node.position.z > strikeDepth);
for (let i = 0; i < 45 && melee.boss.phase === 'retreat'; i++) fightStep(melee);
assert.equal(melee.boss.phase, 'approach');
assert.ok(Math.abs(melee.m.player.position.z - melee.boss.node.position.z - 6) < 1e-6);
assert.equal(melee.m.count, 10);
const dodge = runningFight();
for (let i = 0; i < 240 && dodge.boss.phase !== 'windup'; i++) fightStep(dodge);
dodge.m.player.position.x = 3.5;
for (let i = 0; i < 60 && dodge.boss.phase === 'windup'; i++) fightStep(dodge);
assert.equal(dodge.m.count, 12); assert.equal(dodge.boss.phase, 'retreat');
const outOfReach = runningFight(); outOfReach.boss.phase = 'windup'; outOfReach.boss.attackTimer = 0;
outOfReach.m.updateBossAttack(outOfReach.boss, 0.1); assert.equal(outOfReach.m.count, 12);
const dead = runningFight(); dead.m.bosses.pop();
dead.m.spawnZombie(0, dead.m.player.position.z - 10);
dead.m.spawnZombie(0, dead.m.player.position.z - 100);
fightStep(dead);
assert.equal(dead.m.zombies.length, 1); assert.equal(dead.m.zombieKills, 0); // Melee corridor cleared, distant crowd retained.
const farDepth = dead.m.player.position.z - dead.m.zombies[0].position.z;
for (let i = 0; i < 60; i++) fightStep(dead);
assert.ok(Math.abs(dead.m.player.position.z - dead.m.zombies[0].position.z - farDepth) < 1e-8);
dead.boss.phase = 'windup'; dead.boss.attackTimer = 0;
dead.boss.warning.active = true; dead.m.hitTarget(dead.boss.node, 9999);
assert.equal(dead.boss.warning.isValid, false); assert.equal(dead.boss.warning.active, false);
const beforeDeadAttack = dead.m.count; dead.m.updateBossAttack(dead.boss, 1);
assert.equal(dead.m.count, beforeDeadAttack); assert.equal(dead.m.bosses.length, 0);
fightStep(dead); assert.ok(dead.m.zombies.length > 1); // Far population resumes, never a close wall.
console.log('Running boss regressions passed: maintained 4.5 speed at 30/60/120Hz, only one active encounter, approach/windup/retreat6, melee-only finite strikes, lateral escape, moving warning, death cleanup/no post-death strike, far crowd retention and population resume.');

const restart = new GameManager(); restart.node = new Node();
const scene = new Node(''); scene.uuid = 'scene-uuid'; restart.node.scene = scene;
const canvas = new Node(); scene.addChild(canvas); canvas.addComponent(cc.Canvas);
restart.createRestartIcon(); restart.showRestartButton();
assert.equal(restart.restartButtons.length, 2);
const [icon, revive] = restart.restartButtons;
for (const [button, width, height] of [[icon, 64, 64], [revive, 296, 90]]) {
    assert.equal(button.node.layer, cc.Layers.Enum.UI_2D);
    const transform = button.node.getComponent(UITransform);
    assert.deepEqual(transform.contentSize, { width, height });
    const p = button.node.worldPosition;
    assert.equal(transform.hitTest({ x: p.x + width / 2 - 1, y: p.y + height / 2 - 1 }), true);
    assert.equal(transform.hitTest({ x: p.x + width / 2 + 1, y: p.y }), false);
    assert.equal(button.node.listeners.click.callback, restart.restartGame);
}
const alignment = icon.node.getComponent(Widget);
assert.equal(icon.node.getComponent(cc.Graphics).arcArgs[5], true); // Cocos CCW gives the long circular arc, not a short hook.
assert.equal(alignment.top, 24); assert.equal(alignment.left, 24);
assert.equal(alignment.isAlignTop && alignment.isAlignLeft, true);
assert.equal(alignment.alignMode, Widget.AlignMode.ALWAYS);
const info = { uuid: scene.uuid, url: 'db://assets/main.scene' };
cc.assetManager.bundles = [{ getAssetInfo: uuid => uuid === info.uuid ? info : null, getSceneInfo: name => [info.url, 'main'].includes(name) ? info : null }];
let loads = 0, onLoaded;
cc.director.loadScene = (url, callback) => { assert.equal(url, info.url); loads++; onLoaded = callback; return true; };
icon.node.emit('click'); revive.node.emit('click');
assert.equal(loads, 1); assert.equal(restart.restarting, true);
assert.ok(restart.restartButtons.every(b => !b.interactable));
onLoaded(new Error('load failed'));
assert.equal(restart.restarting, false); assert.ok(restart.restartButtons.every(b => b.interactable));
revive.node.emit('click'); assert.equal(loads, 2); onLoaded(new Error('retry'));
for (const fail of [() => false, () => { throw new Error('sync failure'); }]) {
    cc.director.loadScene = fail; icon.node.emit('click');
    assert.equal(restart.restarting, false); assert.ok(restart.restartButtons.every(b => b.interactable));
}
cc.assetManager.bundles = []; cc.director.loadScene = () => { throw new Error('must not attempt invalid scene'); };
revive.node.emit('click'); assert.equal(restart.restarting, false);
assert.ok(restart.restartButtons.every(b => b.interactable));
const inputRunner = new PlayerRunner(); inputRunner.node = new Node();
inputRunner.onEnable(); assert.equal(inputListeners.size, 9);
const event = { getID: () => 7, getDelta: () => ({ x: 20 }), getButton: () => 0 };
inputRunner.isUIInput = () => true;
inputRunner.onTouchStart(event); inputRunner.onTouchMove(event);
inputRunner.onMouseDown(event); inputRunner.onMouseMove(event);
assert.equal(inputRunner.node.position.x, 0);
inputRunner.isUIInput = () => false; inputRunner.onTouchMove(event);
assert.equal(inputRunner.node.position.x, 0); // UI-origin drag remains excluded after leaving control.
inputRunner.onTouchStart(event); inputRunner.onTouchMove(event);
assert.equal(inputRunner.node.position.x, 0.4);
inputRunner.enabledInHierarchy = false; inputRunner.onDisable();
inputRunner.onTouchMove(event); inputRunner.onMouseDown(event); inputRunner.onMouseMove(event); inputRunner.slide(1);
assert.equal(inputRunner.node.position.x, 0.4); assert.equal(inputListeners.size, 0);
assert.equal(inputRunner.mouseHeld, false); assert.equal(inputRunner.keyDir, 0);
inputRunner.enabledInHierarchy = true; inputRunner.onEnable(); assert.equal(inputListeners.size, 9); inputRunner.onDisable();
console.log('Restart regressions passed: real builders and click wiring, hit bounds, top-left Widget, empty-name UUID metadata resolution, shared load guard, false/callback/throw recovery, invalid scene, UI-origin drag filtering, disabled input cleanup.');

function bossSchedule() {
    const m = streamManager();
    m.nextSurvivorDistance = Infinity; // Isolate the boss schedule from rescue spawning.
    m.blaster = null;
    m.bossPrefabs = [{ name: 'BossA' }, { name: 'BossB' }];
    m.bridge = { ...bridge, extendTo() {}, bossWarning: () => new Node(), bossLabel: () => ({ node: new Node() }) };
    m.nextGateZ = -43;
    m.player.setPosition(0, 0, -30); m.previousPlayerPosition.set(m.player.position);
    m.moveZombies = m.checkPathEvents = m.cleanupTireRewards = m.frameSquad = m.showCount = () => {};
    m.updateBossAttack = () => {};
    return m;
}
function killOrdinary(m, count = 1) {
    for (let i = 0; i < count; i++) {
        m.spawnZombie(0, m.player.position.z - 60, 1);
        const victim = m.zombies[m.zombies.length - 1];
        victim.destroy = () => {};
        m.hitTarget(victim, 1); m.hitTarget(victim, 1);
    }
}
const schedule = bossSchedule();
schedule.extendCourse(-1000); assert.equal(schedule.bosses.length, 0); // Distance/gates never trigger.
assert.ok(schedule.gates.some(g => g.left.value === 'double' || g.right.value === 'double'));
killOrdinary(schedule, 149); assert.equal(schedule.bossCharge, 149);
schedule.lateUpdate(0); assert.equal(schedule.bosses.length, 0);
killOrdinary(schedule); assert.equal(schedule.bossCharge, 150);
assert.equal(schedule.bosses.length, 0); // Callback only queues via saturated charge.
schedule.lateUpdate(0); const firstBoss = schedule.bosses[0];
assert.equal(firstBoss.node.position.z, schedule.player.position.z - 24);
assert.equal(firstBoss.phase, 'approach'); assert.equal(firstBoss.maxHealth, 1250);
killOrdinary(schedule, 120); schedule.extendCourse(-2000);
assert.equal(schedule.bossCharge, 150); assert.equal(schedule.bosses.length, 1);
assert.equal(schedule.bossEncounterIndex, 1);
schedule.hitTarget(firstBoss.node, 1249); assert.equal(schedule.bossCharge, 150);
schedule.hitTarget(firstBoss.node, 1); schedule.hitTarget(firstBoss.node, 1);
assert.equal(schedule.bossCharge, 0); assert.equal(schedule.bosses.length, 0);
killOrdinary(schedule); assert.equal(schedule.bossCharge, 0); // Same-frame delayed shots not banked.
schedule.lateUpdate(0); killOrdinary(schedule, 299); schedule.lateUpdate(0);
assert.equal(schedule.bosses.length, 0); killOrdinary(schedule); schedule.lateUpdate(0);
assert.equal(schedule.bosses.length, 1); assert.equal(schedule.bosses[0].maxHealth, 1600);
assert.equal(schedule.bossEncounterIndex, 2);
const noBossAssets = bossSchedule(); noBossAssets.bossPrefabs = [];
killOrdinary(noBossAssets, 170); noBossAssets.lateUpdate(0);
assert.equal(noBossAssets.bossCharge, 150); assert.equal(noBossAssets.bosses.length, 0);
assert.equal(noBossAssets.bossEncounterIndex, 0);
noBossAssets.bossPrefabs = [{ name: 'Boss' }]; noBossAssets.lateUpdate(0);
assert.equal(noBossAssets.bosses.length, 1);
for (const [configured, expected] of [[0, 1], [-3, 1], [2.9, 2], [NaN, 150], [Infinity, 150]]) {
    const m = bossSchedule(); m.bossKillsRequired = configured; assert.equal(m.bossKillTarget, expected);
}
const custom = bossSchedule(); custom.bossKillsRequired = 3;
killOrdinary(custom, 2); custom.lateUpdate(0); assert.equal(custom.bosses.length, 0);
killOrdinary(custom); custom.lateUpdate(0); assert.equal(custom.bosses.length, 1);
assert.equal(destroyed.bossCharge, 0); assert.equal(skipped.bossCharge, 0);
assert.equal(passing.bossCharge, 0); assert.equal(contact.bossCharge, 0); assert.equal(bossKill.bossCharge, 0);
const hudManager = new GameManager(); hudManager.node = new Node(); hudManager.node.scene = scene;
const canvasTransform = canvas.addComponent(UITransform);
hudManager.createBossMeter();
for (const [width, height] of [[720, 1280], [1280, 720], [400, 800], [320, 640]]) {
    canvasTransform.setContentSize(width, height); hudManager.updateBossMeter(1);
    const meter = hudManager.bossMeter;
    assert.ok(Math.abs(meter.position.x) + hudManager.bossMeterWidth / 2 <= width / 2 - 16);
    const top = height / 2 - meter.position.y - 32;
    assert.ok(top >= 24);
    if (width >= 600) assert.ok(width / 2 - hudManager.bossMeterWidth / 2 >= 104);
    else assert.ok(top >= 100);
    assert.equal(meter.getComponent(Button), undefined);
    assert.equal(meter.listeners, undefined);
}
hudManager.bossCharge = 42; hudManager.updateBossMeter(1); assert.equal(hudManager.bossMeterLabel.string, 'BOSS  42/150');
hudManager.bossCharge = 150; hudManager.updateBossMeter(1); assert.equal(hudManager.bossMeterLabel.string, 'BOSS · 等待配置');
hudManager.bossPrefabs = [{}]; hudManager.updateBossMeter(1); assert.equal(hudManager.bossMeterLabel.string, 'BOSS · 来袭！');
hudManager.bosses = [{}]; hudManager.updateBossMeter(1); assert.equal(hudManager.bossMeterLabel.string, 'BOSS · 战斗中');
console.log('Boss charge regressions passed: 150 kills/default and configurable target, exact-once delayed impacts, deferred 24-ahead spawn, gate/distance independence, special gates retained, one boss/no backlog/no bank, actual death reset, encounter growth, empty prefab recovery, exclusions, portrait/landscape HUD bounds and explicit states.');

function rescueManager() {
    const m = streamManager();
    m.bridge = { bossLabel: (parent, string) => {
        const root = new Node(); parent.addChild(root); const node = new Node(); root.addChild(node);
        return { node, string };
    } };
    m.nextSurvivorDistance = 50;
    return m;
}
for (const gap of [50, 100]) {
    const m = rescueManager(); m.rand = () => gap; let spawns = 0;
    m.spawnSurvivor = () => { spawns++; m.survivor = nodeAt(3.65, m.player.position.z - 20); };
    m.player.position.z = -49.99; m.updateSurvivorSchedule(false); assert.equal(spawns, 0);
    m.player.position.z = -50; m.updateSurvivorSchedule(false); assert.equal(spawns, 1);
    assert.equal(m.nextSurvivorDistance, 50 + gap);
    m.player.position.z = -1000; m.updateSurvivorSchedule(true); assert.equal(spawns, 1);
    assert.equal(m.nextSurvivorDistance, 1000 + gap);
    m.updateSurvivorSchedule(false); assert.equal(spawns, 1); // No bank on boss exit.
    m.player.position.z = -2000; m.updateSurvivorSchedule(false); assert.equal(spawns, 2);
    m.updateSurvivorSchedule(false); assert.equal(spawns, 2); // No hitch burst.
}
const civilian = rescueManager(); civilian.spawnSurvivor();
assert.ok(civilian.survivor); const friendly = civilian.survivor;
assert.ok(friendly.name.includes('1 HP')); assert.equal(civilian.zombies.includes(friendly), false);
assert.equal(civilian.tireRewards.some(r => r.node === friendly), false);
civilian.spawnSurvivor(); assert.equal(civilian.survivor, friendly); // At most one.
const regularKills = civilian.zombieKills;
civilian.hitTarget(friendly, 99); assert.equal(civilian.survivor, friendly); // Never an enemy target.
civilian.survivor.setPosition(0, 0, -60);
civilian.spawnZombie(0, -60); civilian.survivorRescueTime = Infinity;
civilian.moveZombies(0, 0); assert.equal(civilian.survivor, null); // First tiny bite is lethal.
assert.equal(civilian.zombieKills, regularKills); assert.equal(civilian.bossCharge, 0);
const followerRescue = rescueManager(); followerRescue.player.position.z = -32;
followerRescue.previousPlayerPosition.set(new Vec3(0, 0, -30));
followerRescue.squadMembers = [nodeAt(0.56, 0.6)];
followerRescue.survivor = nodeAt(1.1, -31);
assert.ok(followerRescue.survivorContactTime(followerRescue.survivor) <= 1);
let awards = 0; followerRescue.grantRescueBuff = () => awards++;
followerRescue.rescueSurvivor(); followerRescue.rescueSurvivor(); assert.equal(awards, 1);
const ordered = rescueManager(); ordered.survivor = nodeAt(0, -60);
ordered.spawnZombie(0, -60.6); ordered.survivorRescueTime = 0.1;
ordered.moveZombies(0.2, 0); assert.ok(ordered.survivor); // Rescue precedes later bite.
ordered.survivorRescueTime = Infinity; ordered.moveZombies(0.2, 0); assert.equal(ordered.survivor, null);
const passedSurvivor = rescueManager(); passedSurvivor.survivor = nodeAt(0, -20);
passedSurvivor.updateSurvivorSchedule(false); assert.equal(passedSurvivor.survivor, null);
const rescuedBuff = rescueManager(); rescuedBuff.squadFire = new SquadFire(new Node(), {name:'blaster-e'}, {}, 28.5);
const rescueFire = rescuedBuff.squadFire;
rescuedBuff.grantRescueBuff(0); assert.equal(rescueFire.shotDamage, 2); assert.equal(rescueFire.currentDamage, 1);
rescuedBuff.updateRescueBuffs(3); rescuedBuff.grantRescueBuff(0); assert.equal(rescuedBuff.damageBuffTime, 10);
assert.equal(rescueFire.shotDamage, 2); // Refresh, not stack.
rescueFire.upgrade(null); assert.equal(rescueFire.shotDamage, 3); assert.equal(rescueFire.currentDamage, 2);
assert.equal(rescueFire.rewardDamage(), 3); // Preview excludes temporary bonus damage.
rescuedBuff.grantRescueBuff(1); assert.equal(rescueFire.fireRateMultiplier, 1.5);
assert.equal(rescueFire.shotInterval(false), 0.19 / 1.5); assert.equal(rescueFire.shotInterval(true), 0.045 / 1.5);
rescuedBuff.updateRescueBuffs(10); assert.equal(rescueFire.shotDamage, 2);
assert.equal(rescueFire.shotInterval(false), 0.19); assert.equal(rescueFire.shotInterval(true), 0.045);
rescuedBuff.count = 9; rescuedBuff.grantRescueBuff(2); rescuedBuff.grantRescueBuff(2);
assert.equal(rescuedBuff.shieldCharges, 1); rescuedBuff.applyAttackLoss(3); assert.equal(rescuedBuff.count, 9);
assert.equal(rescuedBuff.shieldCharges, 0); rescuedBuff.applyAttackLoss(2); assert.equal(rescuedBuff.count, 7);
const shieldZombie = rescueManager(); shieldZombie.count = 2; shieldZombie.shieldCharges = 1;
shieldZombie.spawnZombie(0, -30); shieldZombie.moveZombies(0, 0);
assert.equal(shieldZombie.count, 2); assert.equal(shieldZombie.shieldCharges, 0);
assert.equal(shieldZombie.zombieKills, 0); assert.equal(shieldZombie.bossCharge, 0);
const penaltyShield = rescueManager(); penaltyShield.shieldCharges = 1; penaltyShield.count = 4;
penaltyShield.player.position.z = -32; penaltyShield.previousPlayerPosition.set(new Vec3(0, 0, -30));
penaltyShield.gates = [{z:-31,left:{node:new Node(),value:-1},right:{node:new Node(),value:-1}}];
penaltyShield.checkPathEvents(0); assert.equal(penaltyShield.count, 3); assert.equal(penaltyShield.shieldCharges, 1);
rescuedBuff.grantRescueBuff(0); rescuedBuff.grantRescueBuff(1); rescuedBuff.grantRescueBuff(2);
rescuedBuff.countLabel = {}; rescuedBuff.showCount(); assert.ok(rescuedBuff.countLabel.string.includes('伤害+1 10s'));
assert.ok(rescuedBuff.countLabel.string.includes('射速×1.5 10s')); assert.ok(rescuedBuff.countLabel.string.includes('护盾 1次'));
rescuedBuff.clearRescueBuffs(); assert.equal(rescueFire.bonusDamage, 0); assert.equal(rescueFire.fireRateMultiplier, 1);
assert.equal(rescuedBuff.shieldCharges, 0);
console.log('Survivor regressions passed: random gap endpoints, travel schedule, boss pause/no backlog, one friendly/1HP, excluded targets, first bite death/no kill credit, swept follower contact, event ordering, one reward, passed cleanup, damage and rate refresh/expiry/permanent tier preservation, shield attack consumption/zombie credit/negative gate exclusion, explicit buff HUD and reset.');

const pendingRescue = rescueManager(); pendingRescue.player.position.z = -50;
let placementAttempts = 0;
pendingRescue.spawnSurvivor = () => { if (++placementAttempts === 2) pendingRescue.survivor = nodeAt(3.65, -70); };
pendingRescue.updateSurvivorSchedule(false); assert.equal(pendingRescue.nextSurvivorDistance, 50);
pendingRescue.updateSurvivorSchedule(false); assert.ok(pendingRescue.survivor);
assert.equal(pendingRescue.nextSurvivorDistance, 125); assert.equal(placementAttempts, 2);
const shoulderCase = rescueManager();
// Worst authored outer column, every2m: shoulderCase can be placed and stays out of bite range.
for (let z = -40; z >= -60; z -= 2) { shoulderCase.spawnZombie(3.27, z); shoulderCase.spawnZombie(-3.27, z); }
shoulderCase.spawnSurvivor(); assert.ok(shoulderCase.survivor); assert.equal(Math.abs(shoulderCase.survivor.position.x), 3.65);
assert.ok(Math.abs(shoulderCase.survivor.position.x) - 3.5 < 0.6);
for (let step = 0; step < 240; step++) shoulderCase.moveZombies(1 / 60, 0);
assert.ok(shoulderCase.survivor); // Four-second approach is viable without immunity or killing a zombie.
const authored = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/main.scene'), 'utf8')).find(v => v.bossPrefabs);
assert.equal(authored.bossPrefabs.length, 3);
for (const [i, name] of ['MushroomKing', 'Orc_Skull', 'BlueDemon'].entries()) {
    const meta = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/ImportedCharacters', name + '.fbx.meta'), 'utf8'));
    const prefab = Object.values(meta.subMetas).find(v => v.importer === 'gltf-scene' && v.name === name + '.prefab');
    assert.ok(prefab && prefab.imported); assert.equal(authored.bossPrefabs[i].__uuid__, prefab.uuid);
    assert.equal(authored.bossPrefabs[i].__expectedType__, 'cc.Prefab');
}
console.log('Scene/gap regressions passed: all three real imported boss references, single pending rescue retry, reachable shoulderCase placement and four-second survival beside worst-case packed outer columns.');

let idlePlays = 0;
const dormantAnimation = { clips: [{name:'Rig|Idle'}], play: () => idlePlays++, getState: () => null };
assert.doesNotThrow(() => new GameManager().playBossIdle(dormantAnimation)); assert.equal(idlePlays, 1);
const activation = bossSchedule(); activation.bossCharge = 150;
activation.playBossIdle = () => assert.equal(activation.bosses[0].node.active, true);
activation.lateUpdate(0); activation.lateUpdate(0);
assert.equal(activation.bosses.length, 1); assert.equal(activation.bossEncounterIndex, 1);
const teardown = rescueManager(); teardown.survivor = new Node(); const dyingFriendly = teardown.survivor;
teardown.bossMeter = new Node(); const dyingMeter = teardown.bossMeter;
teardown.squadFire = {bonusDamage:1,fireRateMultiplier:1.5}; teardown.damageBuffTime = 10; teardown.shieldCharges = 1;
let unscheduled = false; teardown.unscheduleAllCallbacks = () => {unscheduled = true;};
teardown.onDestroy(); assert.equal(unscheduled, true); assert.equal(dyingFriendly.isValid, false);
assert.equal(dyingMeter.isValid, false); assert.equal(teardown.bossMeter, null);
assert.equal(teardown.squadFire.bonusDamage, 0); assert.equal(teardown.shieldCharges, 0);
console.log('Lifecycle regressions passed: inactive animation state is nullable, idle starts only after boss activation, no repeated spawn/index leak, meter/friendly/buff/scheduled callback teardown.');

const visuals = rescueManager(); visuals.node.scene = scene; visuals.squadFire = new SquadFire(new Node(), {name:'blaster-e'}, {}, 28.5);
visuals.grantRescueBuff(1); const effectRoot = visuals.buffFXRoot, firstToast = visuals.buffToast;
assert.ok(visuals.hasteFX.active); assert.equal(visuals.shieldFX.active, false);
assert.equal(effectRoot.getComponentsInChildren(MeshRenderer).length, 11);
assert.ok(visuals.buffStars.every(n => n.active)); assert.ok(firstToast.active);
assert.ok(visuals.buffToastLabel.string.includes('急速射击'));
assert.equal(firstToast.getComponent(Button), undefined); assert.equal(firstToast.listeners, undefined);
const oldRotation = visuals.hasteFX.eulerAngles.y;
visuals.updateBuffEffects(0.2); assert.notEqual(visuals.hasteFX.eulerAngles.y, oldRotation);
visuals.player.position.x += 1.5; visuals.updateBuffEffects(0);
assert.equal(effectRoot.worldPosition.x, visuals.player.worldPosition.x);
visuals.grantRescueBuff(1); assert.equal(visuals.buffFXRoot, effectRoot); assert.equal(visuals.buffToast, firstToast);
assert.ok(visuals.buffToastLabel.string.includes('刷新'));
assert.equal(effectRoot.getComponentsInChildren(MeshRenderer).length, 11); // Fixed pool, no refresh allocation.
visuals.grantRescueBuff(2); visuals.grantRescueBuff(0);
assert.ok(visuals.hasteFX.active && visuals.shieldFX.active); assert.equal(visuals.squadFire.bonusDamage, 1);
visuals.updateBuffEffects(2.1); assert.equal(firstToast.active, false); assert.ok(visuals.buffStars.every(n => !n.active));
visuals.hasteBuffTime = 0.1; visuals.updateRescueBuffs(0.2); visuals.updateBuffEffects(0.2);
assert.equal(visuals.hasteFX.active, false); assert.equal(visuals.shieldFX.active, true);
assert.equal(visuals.squadFire.bonusDamage, 1); // Independent visual expiry.
assert.equal(visuals.consumeShield(), true); assert.equal(visuals.shieldFX.active, false);
assert.equal(visuals.shieldBurstFX.active, true); const burstTime = visuals.shieldBurstTime;
assert.equal(visuals.consumeShield(), false); assert.equal(visuals.shieldBurstTime, burstTime);
visuals.updateBuffEffects(0.5); assert.equal(visuals.shieldBurstFX.active, false);
visuals.grantRescueBuff(2); visuals.clearRescueBuffs(); assert.equal(visuals.shieldBurstTime, 0);
assert.equal(effectRoot.active, false); assert.equal(firstToast.active, false); // Clear is not a hit.
const meshes = [...visuals.buffFXMeshes], materials = [...visuals.buffFXMaterials];
visuals.disposeBuffEffects(); assert.equal(effectRoot.isValid, false); assert.equal(firstToast.isValid, false);
assert.ok(meshes.every(m => m.destroyed)); assert.ok(materials.every(m => m.destroyed));
assert.equal(visuals.buffStars.length, 0); assert.equal(visuals.buffFXRoot, null);
visuals.disposeBuffEffects(); // Idempotent death then scene teardown.
const flashFire = new SquadFire(new Node(), {name:'blaster-e'}, {}, 28.5);
const flashes = [], fragments = [];
flashFire.burst = (...args) => flashes.push(args);
flashFire.effect = (name, mesh, material) => {fragments.push({name,material});return new Node();};
flashFire.drawImpact(new Vec3(), true);
assert.equal(flashes[0][2], 0.42); assert.equal(flashes[0][3], flashFire.buffGold);
assert.equal(fragments.length, 5); assert.ok(fragments.every(f => f.material === flashFire.buffGold));
flashFire.drawImpact(new Vec3(), false); assert.equal(flashes[1][2], 0.3); assert.equal(flashes[1][3], flashFire.gold);
assert.equal(flashFire.currentDamage, 1); // Visual style doesn't alter permanent damage/tier.
console.log('Buff visual regressions passed: capped11-renderer shared pool, refresh reuses nodes, no-input toast, icon/title refresh, orbit motion and squad follow, coexisting/independent expiry, single shield burst vs silent clear, disposed meshes/materials/nodes, five gold power fragments with unchanged base tiers.');

const harderCourse = bossSchedule(); harderCourse.nextGateZ = -43; harderCourse.extendCourse(-1000);
const courseRows = harderCourse.gates;
for (let i = 0; i < courseRows.length; i++) {
    const row = courseRows[i], values = [row.left.value, row.right.value];
    if (i % 5 === 4) assert.ok(values.includes('double'));
    else assert.ok(values.some(v => typeof v === 'number' && v > 0)); // Midpoint RNG misses the40% dual-negative roll.
}
for (const [count, expected] of [[9,4],[4,2],[3,1],[1,0]]) {
    const half = rescueManager(); half.count = count; half.shieldCharges = 1;
    half.player.position.z = -32; half.previousPlayerPosition.set(new Vec3(0,0,-30));
    half.gates = [{z:-31,left:{node:new Node(),value:'halve'},right:{node:new Node(),value:'halve'}}];
    half.checkPathEvents(0); assert.equal(half.count, expected); assert.equal(half.shieldCharges, 1);
}
const gateScenery = Object.create(BridgeScenery.prototype); gateScenery.root = new Node();
gateScenery.recruit = {panel:'positive'}; gateScenery.penalty = {panel:'negative'};
let gateText, gatePanel;
gateScenery.piece = (parent, name, mesh, material) => {if(name==='Gate panel')gatePanel=material;return new Node();};
gateScenery.label = (parent, text) => {gateText=text;};
assert.equal(gateScenery.gate(-20, 1, 'halve').name, 'Penalty gate');
assert.equal(gateText, '÷2'); assert.equal(gatePanel, 'negative');
const bossCap = bossSchedule(); bossCap.bossEncounterIndex = 100; bossCap.bossCharge = 150;
bossCap.lateUpdate(0); assert.equal(bossCap.bosses[0].maxHealth, 3200);
console.log('Balance regressions passed: DPS-scaled reward challenges, bosses1250/+350 cap3200 exactly10x, random penalty choices only from300m, special bonus cadence retained, halving rounds down including1→0, shield does not bypass gate costs, ÷2 label uses negative palette.');

// Cocos destroys scene children and siblings before GameManager.onDestroy.
for (const ended of [false, true]) {
    const m = rescueManager(); m.node.scene = scene; m.unscheduleAllCallbacks = () => {};
    m.createRestartIcon(); m.createBossMeter(); m.spawnSurvivor(); m.grantRescueBuff(1);
    if (ended) m.endGame();
    const ownedMaterials = [...m.buffFXMaterials], ownedMeshes = [...m.buffFXMeshes];
    m.player.destroy(); m.player.position = null;
    m.soldierModel.position = null;
    m.buffFXRoot?.destroy(); m.buffToast?.destroy(); m.survivor?.destroy(); m.bossMeter.destroy();
    for (const b of m.restartButtons) { b.node.destroy(); b.isValid = false; b.node = null; }
    assert.doesNotThrow(() => m.onDestroy());
    assert.doesNotThrow(() => m.onDestroy());
    assert.equal(m.restartButtons.length, 0); assert.equal(m.buffFXRoot, null);
    assert.equal(m.bossMeter, null); assert.equal(m.survivor, null);
    assert.equal(m.buffStars.length, 0); assert.equal(m.upgradeTitles.size, 0);
    assert.ok(ownedMaterials.every(v => v.destroyed)); assert.ok(ownedMeshes.every(v => v.destroyed));
}
const growth = formationManager(); growth.node.scene = scene;
assert.equal(growth.buffFXRoot, null); growth.setSquadCount(1); assert.equal(growth.buffFXRoot, null);
growth.setSquadCount(3); assert.equal(growth.upgradeTitles.get(-2), '队伍壮大 +2');
assert.ok(growth.upgradeFX.active); const pool = growth.buffFXRoot;
growth.setSquadCount(12); assert.equal(growth.count, 9); assert.equal(growth.upgradeTitles.get(-2), '队伍壮大 +8');
growth.updateBuffEffects(0.2); const starTime = growth.buffStarTime;
growth.setSquadCount(15); growth.setSquadCount(4); assert.equal(growth.buffStarTime, starTime);
growth.updateBuffEffects(3); growth.setSquadCount(5); assert.equal(growth.upgradeTitles.get(-2), '队伍壮大 +1');
assert.equal(growth.buffFXRoot, pool);
const uninitialized = new GameManager(); uninitialized.player = new Node(); uninitialized.setSquadCount(2);
assert.equal(uninitialized.buffFXRoot, null); // No model/formation yet: no initialization celebration.
growth.squadFire = new SquadFire(new Node(), { name: 'blaster-e' }, {}, 28.5);
function upgradeTire(m) { const node = new Node(); m.tireRewards.push({node,health:1,label:{},display:null}); m.hitTarget(node,1); }
upgradeTire(growth); assert.equal(growth.upgradeTitles.get(-1),'武器升级 · 火力 2');
growth.updateBuffEffects(0.2); const weaponTime = growth.buffStarTime;
upgradeTire(growth); upgradeTire(growth); assert.ok(growth.buffStarTime>weaponTime);
assert.equal(growth.squadFire.currentDamage,4);
upgradeTire(growth); growth.updateBuffEffects(0.2); const cappedTime=growth.buffStarTime;
upgradeTire(growth); assert.ok(growth.buffStarTime>cappedTime);
for(let i=0;i<20;i++) for(const kind of [0,1,2]) growth.grantRescueBuff(kind);
assert.equal(growth.upgradeTitles.size,5); assert.equal(growth.buffToastLabel.string.split('\n').length,5);
assert.ok(growth.buffToastLabel.string.includes('刷新')); assert.ok(growth.buffToastLabel.string.includes('队伍壮大'));
assert.ok(growth.buffToastLabel.string.includes('火力 6')); assert.equal(growth.buffFXRoot,pool);
assert.equal(pool.getComponentsInChildren(MeshRenderer).length,11);
assert.equal(growth.buffFXMaterials.length,3); assert.equal(growth.buffFXMeshes.length,3);
growth.updateBuffEffects(3); assert.equal(growth.upgradeFX.active,false); assert.equal(growth.buffToast.active,false);
assert.ok(growth.hasteFX.active && growth.shieldFX.active);
growth.grantRescueBuff(0); assert.equal(growth.upgradeTitles.size,1);
growth.squadFire = null; // Formation double has no authored skeletal weapon attachment paths.
growth.setSquadCount(6); assert.equal(growth.upgradeTitles.get(-2),'队伍壮大 +1'); // Expired recruitment must not leak into a later buff presentation.
growth.disposeBuffEffects(); assert.equal(growth.upgradeTitles.size,0); assert.equal(growth.upgradeFX,null);
console.log('Restart teardown + unified upgrade regressions passed: destroyed sibling/component refs and positions, death/live FX teardown repeated; no init/loss flashes, actual recruit delta and every collected weapon, buff gain/refresh, five-category combined bounded toast, fixed eleven-renderer pool, independent persistent buffs, expiry and disposal.');

// New progression contract: permanent damage is unbounded, cosmetic allocations are not.
const endless = new SquadFire(new Node(), {name:'blaster-e'}, {}, 28.5);
const endlessHeld = endless.createGun(); endless.weapons.set(new Node(), {gun:endlessHeld});
for (let i=0;i<100;i++) endless.upgrade(null);
assert.equal(endless.currentDamage,101); assert.equal(endless.damageLabel,'火力 101');
assert.ok(endless.appearance.bodies.size<=6);
assert.deepEqual(bodyColor(endlessHeld),bodyColor(gun.createGun()));
endless.damage = Number.MAX_SAFE_INTEGER - 1; // Isolate the numeric safety boundary.
endless.upgrade(null); assert.equal(endless.currentDamage,Number.MAX_SAFE_INTEGER);
endless.upgrade(null); assert.equal(endless.currentDamage,Number.MAX_SAFE_INTEGER);
endless.decreaseDamage(); assert.equal(endless.currentDamage,Number.MAX_SAFE_INTEGER-1);
const loss = formationManager(); loss.bridge=bridge; loss.setSquadCount(9);
loss.squadFire = new SquadFire(new Node(),{name:'blaster-e'},{},28.5);
loss.squadFire.equip=()=>{}; for (let i=1;i<25;i++) loss.squadFire.upgrade(null);
loss.blaster={name:'blaster-e'}; loss.targetingPose={};
loss.addGateRow(bridge,-100,1,1); const preview=loss.tireRewards[0];
assert.equal(preview.previewDamage,26);
loss.updateBuffEffects(3); loss.setSquadCount(6);
assert.equal(loss.squadFire.currentDamage,24); assert.equal(preview.previewDamage,25);
assert.equal(preview.display.getComponentInChildren(cc.Label).string,'火力+1 → 25');
assert.ok(loss.countLabel.string.includes('火力 24')); assert.equal(loss.buffStarTime,0);
loss.setSquadCount(6); assert.equal(loss.squadFire.currentDamage,24);
loss.shieldCharges=1; loss.applyAttackLoss(3); assert.equal(loss.count,6); assert.equal(loss.squadFire.currentDamage,24);
loss.applyAttackLoss(3); assert.equal(loss.count,3); assert.equal(loss.squadFire.currentDamage,23);
loss.damageBuffTime=10; loss.updateRescueBuffs(0); loss.setSquadCount(2);
assert.equal(loss.squadFire.currentDamage,22); assert.equal(loss.squadFire.shotDamage,23);
loss.spawnZombie(0,-30); loss.moveZombies(0,0);
assert.equal(loss.count,1); assert.equal(loss.squadFire.currentDamage,21);
loss.setSquadCount(0); assert.equal(loss.squadFire.currentDamage,20);
loss.setSquadCount(0); assert.equal(loss.squadFire.currentDamage,20);
for(let i=0;i<30;i++) loss.squadFire.decreaseDamage();
assert.equal(loss.squadFire.currentDamage,1); assert.equal(loss.squadFire.shotDamage,2);
const batch = formationManager(); batch.setSquadCount(9);
batch.squadFire = new SquadFire(new Node(),{name:'blaster-e'},{},28.5); for (let i=1;i<10;i++) batch.squadFire.upgrade(null);
batch.spawnZombie(0,-30); batch.spawnZombie(-0.56,-30); batch.moveZombies(0,0);
assert.equal(batch.count,7); assert.equal(batch.squadFire.currentDamage,9); // One batched loss event, two people.
const gateLoss=formationManager(); gateLoss.setSquadCount(9);
gateLoss.squadFire = new SquadFire(new Node(),{name:'blaster-e'},{},28.5); for (let i=1;i<10;i++) gateLoss.squadFire.upgrade(null);
gateLoss.player.position.z=-32;gateLoss.gates=[{z:-31,left:{node:new Node(),value:'halve'},right:{node:new Node(),value:'halve'}}];
gateLoss.checkPathEvents(0); assert.equal(gateLoss.count,4);assert.equal(gateLoss.squadFire.currentDamage,10);
for (const [value, remaining] of [[-2, 2], [-3, 0]]) {
    gateLoss.previousPlayerPosition.set(gateLoss.player.position);
    gateLoss.player.position.z -= 2;
    gateLoss.gates=[{z:gateLoss.player.position.z+1,left:{node:new Node(),value},right:{node:new Node(),value}}];
    gateLoss.checkPathEvents(0);
    assert.equal(gateLoss.count,remaining); assert.equal(gateLoss.squadFire.currentDamage,10);
}
const progression=bossSchedule();
for(const target of [150,300,600,1200,2400]) {
    assert.equal(progression.bossKillTarget,target);
    killOrdinary(progression,target-1); progression.lateUpdate(0); assert.equal(progression.bosses.length,0);
    killOrdinary(progression); progression.lateUpdate(0); const boss=progression.bosses[0];
    assert.equal(progression.bossKillTarget,target); assert.equal(progression.bossCharge,target);
    progression.hitTarget(boss.node,boss.health); progression.hitTarget(boss.node,99999);
    assert.equal(progression.bossKillTarget,Math.ceil(target*2)); assert.equal(progression.bossCharge,0);
    killOrdinary(progression,3);assert.equal(progression.bossCharge,0);progression.lateUpdate(0);
}
assert.equal(bossSchedule().bossKillTarget,150);
const safeGoal=bossSchedule(); safeGoal.bossKillsRequired=Number.MAX_VALUE;
assert.equal(safeGoal.bossKillTarget,Number.MAX_SAFE_INTEGER);
safeGoal.bossCharge=Number.MAX_SAFE_INTEGER;safeGoal.lateUpdate(0);
safeGoal.hitTarget(safeGoal.bosses[0].node,999999);assert.equal(safeGoal.bossKillTarget,Number.MAX_SAFE_INTEGER);
console.log('New progression regressions passed: 100 upgrades, six-material palette, skipped/late guaranteed award, previews/HUD after loss, per-event loss including batched zombie deaths/gates/tire attacks/gameover, shield exemption, buff separation, minimum1, exact150/300/600/1200/2400 boss cycles, no bank/duplicates/spawn growth, fresh reset and finite safe integer guards.');
