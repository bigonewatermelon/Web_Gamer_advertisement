import { Color, Label, Layers, Material, Mesh, MeshRenderer, Node, Prefab, Quat, RenderRoot2D, Texture2D, Vec3, Vec4, instantiate, primitives, tween, utils } from 'cc';

const DECK_START = 16;
const DECK_END = -54;
const DECK_CENTER = (DECK_START + DECK_END) / 2;
const DECK_LENGTH = DECK_START - DECK_END;
const BRIDGE_LOOKAHEAD = 175;

/** Creates the bridge scenery and shares its meshes with the course markers. */
export class BridgeScenery {
    private readonly box = utils.createMesh(primitives.box());
    private readonly post = utils.createMesh(primitives.cylinder(0.5, 0.5, 1, { radialSegments: 12 }));
    private readonly deck = utils.createMesh(primitives.plane({
        width: 8, length: DECK_LENGTH, widthSegments: 1, lengthSegments: 1,
    }));
    private readonly concrete = this.surface(165, 164, 154);
    private readonly steel = this.surface(92, 91, 84);
    private readonly cable = this.surface(141, 138, 120);
    private readonly spans: Node[] = [];
    private nextSpanZ = 0;
    private ocean: Node | null = null;
    private readonly recruit = this.gateColors(89, 235, 44, 177, 255, 106);
    private readonly penalty = this.gateColors(247, 65, 59, 255, 142, 127);

    constructor(private readonly root: Node, private readonly deckMaterial: Material | null) {}

    build(oceanTexture: Texture2D | null) {
        const ocean = new Material();
        ocean.initialize({ effectName: 'builtin-unlit', defines: { USE_TEXTURE: !!oceanTexture } });
        if (oceanTexture) {
            ocean.setProperty('mainTexture', oceanTexture);
            ocean.setProperty('tilingOffset', new Vec4(138, 246, 0, 0));
        } else ocean.setProperty('mainColor', new Color(18, 133, 195, 255));

        const water = utils.createMesh(primitives.plane({ width: 1800, length: 1800, widthSegments: 1, lengthSegments: 1 }));
        this.ocean = this.piece(this.root, 'Ocean', water, ocean, 0, -2.2, -840, 1, 1, 1);
        this.extendTo(0);
    }

    extendTo(playerZ: number) {
        while (this.nextSpanZ + DECK_START > playerZ - BRIDGE_LOOKAHEAD) {
            const span = new Node('Bridge span');
            this.root.addChild(span);
            span.setPosition(0, 0, this.nextSpanZ);
            this.buildSpan(span);
            this.spans.push(span);
            this.nextSpanZ -= DECK_LENGTH;
        }
        while (this.spans[0].position.z + DECK_END > playerZ + 35) {
            this.spans.shift()!.destroy();
        }
        // Shift the water by whole texture repeats so the surface does not jump.
        const seaStep = 1800 / 246 * 10;
        const seaZ = -840 + Math.ceil(playerZ / seaStep) * seaStep;
        if (this.ocean && this.ocean.position.z !== seaZ) this.ocean.setPosition(0, -2.2, seaZ);
    }

    private buildSpan(span: Node) {
        const { concrete, steel, cable } = this;
        this.piece(span, 'Road', this.deck, this.deckMaterial ?? concrete, 0, 0, DECK_CENTER, 1, 1, 1);
        this.piece(span, 'Deck fascia', this.box, concrete, 0, -0.23, DECK_CENTER, 8.6, 0.44, DECK_LENGTH);

        const towerNear = -11;
        const towerFar = -43;
        for (const side of [-1, 1]) {
            const railX = side * 4.12;
            const towerX = side * 4.51;
            this.piece(span, 'Curb', this.box, concrete, railX, 0.17, DECK_CENTER, 0.38, 0.34, DECK_LENGTH, true);
            this.piece(span, 'Guardrail', this.box, steel, railX, 0.82, DECK_CENTER, 0.18, 0.16, DECK_LENGTH, true);
            this.piece(span, 'Lower rail', this.box, steel, railX, 0.51, DECK_CENTER, 0.11, 0.09, DECK_LENGTH, true);

            for (let z = DECK_START - 1.5; z > DECK_END; z -= 3.5) {
                this.piece(span, 'Rail upright', this.box, steel, railX, 0.49, z, 0.11, 0.65, 0.13, true);
            }
            for (const z of [towerNear, towerFar]) {
                this.piece(span, 'Bridge tower', this.box, steel, towerX, 2.45, z, 0.76, 9.4, 0.91, true);
                this.piece(span, 'Tower flange', this.box, concrete, towerX - side * 0.35, 2.6, z,
                    0.13, 9.1, 0.99, true);
                this.piece(span, 'Tower footing', this.box, concrete, towerX, -0.25, z, 1.05, 0.95, 1.32, true);
            }

            let previous = new Vec3(towerX, 7, towerNear);
            for (let i = 1; i <= 12; i++) {
                const t = i / 12;
                const z = towerNear + (towerFar - towerNear) * t;
                const y = 7 - 17.4 * t * (1 - t);
                const next = new Vec3(towerX, y, z);
                this.beam(span, 'Suspension cable', previous, next, 0.09, cable);
                if (i < 12) this.beam(span, 'Suspender', next, new Vec3(railX, 0.89, z), 0.038, cable);
                previous = next;
            }
            this.beam(span, 'Anchor cable', new Vec3(railX, 0.88, 10), new Vec3(towerX, 7, towerNear), 0.08, cable);
            this.beam(span, 'Anchor cable', new Vec3(towerX, 7, towerFar), new Vec3(railX, 0.88, -53), 0.08, cable);
        }

        for (const z of [towerNear, towerFar]) {
            this.piece(span, 'Tower crossbeam', this.box, steel, 0, 6.88, z, 9.05, 0.43, 0.64, true);
        }
    }

    gate(z: number, side: number, value: number | 'double', labelOffset = 0) {
        const positive = value === 'double' || value > 0;
        const { frame, cap, panel, glow } = positive ? this.recruit : this.penalty;
        const gate = new Node(positive ? 'Recruit gate' : 'Penalty gate');
        this.root.addChild(gate);
        gate.setPosition(side * 1.96, 0, z);

        this.piece(gate, 'Gate zone', this.box, glow, 0, 0.027, 0, 3.84, 0.02, 1.58);
        this.piece(gate, 'Gate panel', this.box, panel, 0, 0.74, 0, 3.84, 1.48, 0.035);
        this.piece(gate, 'Gate threshold', this.box, cap, 0, 0.04, 0.77, 3.84, 0.025, 0.045);
        for (const x of [-1.9, 1.9]) {
            this.piece(gate, 'Gate post', this.post, frame, x, 0.76, 0, 0.19, 1.52, 0.19, true);
            this.piece(gate, 'Gate cap', this.post, cap, x, 1.53, 0, 0.25, 0.11, 0.25);
            this.piece(gate, 'Gate footing', this.post, frame, x, 0.11, 0, 0.27, 0.2, 0.27);
        }
        const text = value === 'double' ? '×2' : value > 0 ? `+${value}` : `−${Math.abs(value)}`;
        this.label(gate, text, labelOffset, 0.94, 0.2, 0.012, -15);
        return gate;
    }

    numberedTarget(x: number, z: number, number: number) {
        const target = new Node(`Target ${number}`);
        this.spans[0].addChild(target);
        target.setPosition(x, 0, z);
        target.setScale(1, 1.22, 1);
        const rubber = this.surface(51, 48, 42);
        const edge = this.surface(92, 81, 59);
        const gold = this.color(255, 215, 79);
        for (let level = 0; level < 3; level++) {
            const y = 0.19 + level * 0.33;
            this.piece(target, 'Target drum', this.post, rubber, 0, y, 0, 1.61, 0.31, 1.61, true);
            this.piece(target, 'Raised seam', this.post, edge, 0, y - 0.106, 0, 1.67, 0.045, 1.67);
        }
        this.piece(target, 'Gold rim', this.post, gold, 0, 1.03, 0, 1.74, 0.077, 1.74);
        this.piece(target, 'Recessed lid', this.post, edge, 0, 1.075, 0, 1.51, 0.028, 1.51);
        this.piece(target, 'Target center', this.post, gold, 0, 1.096, 0, 0.54, 0.021, 0.54);
        const label = this.label(target, String(number), 0, 0.68, 0.88, 0.0095, -15, new Color(204, 66, 12));
        return { node: target, label };
    }

    floatingRifle(prefab: Prefab, x: number, y: number, z: number) {
        const display = new Node('Floating rifle display');
        this.spans[0].addChild(display);
        display.setPosition(x, y, z);

        const rifle = instantiate(prefab);
        display.addChild(rifle);
        rifle.setScale(1.8, 1.8, 1.8);
        rifle.setRotationFromEuler(-10, 72, 12);
        const blue = this.color(29, 86, 121);
        const trim = this.color(26, 45, 65);
        rifle.getComponentsInChildren(MeshRenderer).forEach((renderer, index) => {
            renderer.setMaterial(index === 0 ? blue : trim, 0);
        });

        const haze = this.color(69, 222, 255, 112);
        const glow = this.color(171, 251, 255);
        this.piece(display, 'Blue halo', this.post, haze, 0, -0.36, 0, 2.32, 0.04, 1.1);
        this.piece(display, 'Halo core', this.post, glow, 0, -0.34, 0, 1.72, 0.035, 0.55);
        this.piece(display, 'Left glint', this.box, haze, -0.98, 0.04, -0.22, 0.045, 0.72, 0.045)
            .setRotationFromEuler(0, 0, 15);
        this.piece(display, 'Right glint', this.box, haze, 0.82, 0.28, -0.22, 0.045, 0.65, 0.045)
            .setRotationFromEuler(0, 0, -20);
        tween(rifle).to(0.85, { position: new Vec3(0, 0.22, 0) }, { easing: 'sineInOut' })
            .to(0.85, { position: new Vec3() }, { easing: 'sineInOut' }).union().repeatForever().start();
        return display;
    }

    bossWarning(stopZ: number) {
        const warning = new Node('Boss attack warning');
        this.root.addChild(warning);
        warning.setPosition(0, 0, stopZ);
        const red = this.color(250, 51, 36, 150);
        const edge = this.color(255, 177, 77);
        this.piece(warning, 'Danger lane', this.box, red, 0, 0.042, 0, 3.95, 0.015, 5);
        this.piece(warning, 'Danger edge', this.box, edge, 0, 0.055, 2.45, 3.95, 0.018, 0.1);
        warning.active = false;
        return warning;
    }

    bossLabel(node: Node, text: string) {
        return this.label(node, text, 0, 3.45, 0.12, 0.0075, -12, new Color(102, 27, 35));
    }

    private gateColors(r: number, g: number, b: number, capR: number, capG: number, capB: number) {
        return { frame: this.color(r, g, b), cap: this.color(capR, capG, capB),
            panel: this.color(r, g, b, 65), glow: this.color(r, g, b, 142) };
    }

    private beam(parent: Node, name: string, start: Vec3, end: Vec3, width: number, material: Material) {
        const direction = Vec3.subtract(new Vec3(), end, start);
        const length = direction.length();
        direction.normalize();
        const beam = this.piece(parent, name, this.box, material, (start.x + end.x) / 2,
            (start.y + end.y) / 2, (start.z + end.z) / 2, width, length, width, true);
        beam.setRotation(Quat.rotationTo(new Quat(), Vec3.UNIT_Y, direction));
    }

    private piece(parent: Node, name: string, mesh: Mesh, material: Material,
        x: number, y: number, z: number, sx: number, sy: number, sz: number, castsShadow = false) {
        const node = new Node(name);
        node.layer = Layers.Enum.DEFAULT;
        parent.addChild(node);
        node.setPosition(x, y, z);
        node.setScale(sx, sy, sz);
        const renderer = node.addComponent(MeshRenderer);
        renderer.mesh = mesh;
        renderer.setMaterial(material, 0);
        if (castsShadow) renderer.shadowCastingMode = MeshRenderer.ShadowCastingMode.ON;
        return node;
    }

    private surface(r: number, g: number, b: number) {
        const material = new Material();
        material.initialize({ effectName: 'builtin-standard', defines: { USE_INSTANCING: true } });
        material.setProperty('mainColor', new Color(r, g, b, 255));
        material.setProperty('roughness', 0.91);
        return material;
    }

    private color(r: number, g: number, b: number, a = 255) {
        const material = new Material();
        material.initialize({ effectName: 'builtin-unlit', technique: a < 255 ? 1 : 0 });
        material.setProperty('mainColor', new Color(r, g, b, a));
        return material;
    }

    private label(parent: Node, text: string, x: number, y: number, z: number, scale: number, pitch: number,
        outline = new Color(20, 31, 39, 255)) {
        const root = new Node('World label');
        root.layer = Layers.Enum.DEFAULT;
        root.addComponent(RenderRoot2D);
        parent.addChild(root);
        root.setPosition(x, y, z);
        root.setRotationFromEuler(pitch, 0, 0);
        root.setScale(scale, scale, scale);

        const node = new Node('Text');
        node.layer = Layers.Enum.DEFAULT;
        root.addChild(node);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = 100;
        label.lineHeight = 115;
        label.isBold = true;
        label.enableOutline = true;
        label.outlineColor = outline;
        label.outlineWidth = 7;
        return label;
    }
}
