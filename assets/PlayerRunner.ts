import { _decorator, Component, input, Input, EventTouch, EventMouse, EventKeyboard, KeyCode, Vec3 } from 'cc';
const { ccclass, property } = _decorator;

/**
 * Makes the player run forward on its own and steer left/right.
 * Controls: arrow keys or A/D, drag with the mouse, or swipe on a phone.
 * Attach this to the Player node.
 */
@ccclass('PlayerRunner')
export class PlayerRunner extends Component {
    @property speed = 4.5;          // how fast we run forward (units per second)
    @property steerSpeed = 8;       // how fast the keyboard moves us sideways
    @property dragSensitivity = 0.02; // how far a mouse/finger drag moves us
    @property roadHalfWidth = 3.5;  // how far from the middle we can go
    forwardLimitZ: number | null = null;

    private keyDir = 0;             // -1 = left, 1 = right, 0 = none
    private mouseHeld = false;
    private pos = new Vec3();

    onLoad() {
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.on(Input.EventType.KEY_UP, this.onKeyUp, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.on(Input.EventType.MOUSE_UP, this.onMouseUp, this);
        input.on(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
    }

    onDestroy() {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        input.off(Input.EventType.KEY_UP, this.onKeyUp, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.MOUSE_DOWN, this.onMouseDown, this);
        input.off(Input.EventType.MOUSE_UP, this.onMouseUp, this);
        input.off(Input.EventType.MOUSE_MOVE, this.onMouseMove, this);
    }

    private onKeyDown(e: EventKeyboard) {
        if (e.keyCode === KeyCode.ARROW_LEFT || e.keyCode === KeyCode.KEY_A) this.keyDir = -1;
        if (e.keyCode === KeyCode.ARROW_RIGHT || e.keyCode === KeyCode.KEY_D) this.keyDir = 1;
    }

    private onKeyUp(e: EventKeyboard) {
        const left = e.keyCode === KeyCode.ARROW_LEFT || e.keyCode === KeyCode.KEY_A;
        const right = e.keyCode === KeyCode.ARROW_RIGHT || e.keyCode === KeyCode.KEY_D;
        if ((left && this.keyDir === -1) || (right && this.keyDir === 1)) this.keyDir = 0;
    }

    private onTouchMove(e: EventTouch) {
        this.slide(e.getDelta().x * this.dragSensitivity);
    }

    private onMouseDown(e: EventMouse) { this.mouseHeld = true; }
    private onMouseUp(e: EventMouse) { this.mouseHeld = false; }
    private onMouseMove(e: EventMouse) {
        if (this.mouseHeld) this.slide(e.getDelta().x * this.dragSensitivity);
    }

    /** Move sideways by an amount, staying on the road. */
    private slide(amount: number) {
        this.node.getPosition(this.pos);
        this.pos.x = Math.min(this.roadHalfWidth, Math.max(-this.roadHalfWidth, this.pos.x + amount));
        this.node.setPosition(this.pos);
    }

    update(dt: number) {
        // Run forward. In Cocos, "forward" into the screen is the -Z direction.
        this.node.getPosition(this.pos);
        const nextZ = this.pos.z - this.speed * dt;
        this.pos.z = this.forwardLimitZ === null ? nextZ : Math.max(nextZ, this.forwardLimitZ);
        this.node.setPosition(this.pos);

        // Steer with the keyboard.
        if (this.keyDir !== 0) this.slide(this.keyDir * this.steerSpeed * dt);
    }
}
