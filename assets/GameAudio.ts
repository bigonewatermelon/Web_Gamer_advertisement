import { _decorator, AudioClip, AudioSource, Component, Game, Input, Node, game, input, resources, sys } from 'cc';

const { ccclass } = _decorator;
const STORAGE_KEY = 'bridge-game-muted';
const SOUNDS = {
    shot: { gap: 0.09, volume: 0.24 },
    hit: { gap: 0.10, volume: 0.28 },
    recruit: { gap: 0.18, volume: 0.65 },
    loss: { gap: 0.25, volume: 0.6 },
    upgrade: { gap: 0.45, volume: 0.7 },
    shield: { gap: 0.2, volume: 0.65 },
    rescue: { gap: 0.25, volume: 0.65 },
    'boss-intro': { gap: 1, volume: 0.7 },
    'boss-attack': { gap: 0.5, volume: 0.6 },
    'boss-win': { gap: 1, volume: 0.7 },
    'game-over': { gap: 1, volume: 0.7 },
    ui: { gap: 0.08, volume: 0.5 },
};
export type GameSound = keyof typeof SOUNDS;

/** Scene-owned audio. Browser playback starts on the first gesture inside the game. */
@ccclass('GameAudio')
export class GameAudio extends Component {
    muted = false;
    private music: AudioSource | null = null;
    private effects: AudioSource[] = [];
    private clips = new Map<string, AudioClip>();
    private lastPlayed = new Map<GameSound, number>();
    private voiceFreeAt = new Map<AudioSource, number>();
    private unlocked = false;
    private hidden = false;
    private ended = false;
    private destroyed = false;
    private nextVoice = 0;
    private musicRequested = false;

    onLoad() {
        try { this.muted = sys.localStorage.getItem(STORAGE_KEY) === 'true'; } catch {}
        this.music = this.source('Background music');
        this.music.loop = true;
        this.music.volume = 0.32;
        for (let index = 0; index < 6; index++) this.effects.push(this.source(`Sound effect ${index + 1}`));
        input.on(Input.EventType.TOUCH_END, this.unlock, this);
        input.on(Input.EventType.MOUSE_UP, this.unlock, this);
        input.on(Input.EventType.KEY_DOWN, this.unlock, this);
        game.on(Game.EVENT_HIDE, this.onHide, this);
        game.on(Game.EVENT_SHOW, this.onShow, this);

        resources.load('audio/bridge-bounce', AudioClip, (error, clip) => {
            if (this.destroyed) return;
            if (error) { console.warn('Background music could not load.', error); return; }
            clip.addRef();
            this.clips.set('music', clip);
            this.music!.clip = clip;
            this.resumeMusic();
        });
        resources.loadDir('audio/effects', AudioClip, (error, clips) => {
            if (this.destroyed) return;
            if (error) { console.warn('Sound effects could not load.', error); return; }
            for (const clip of clips) {
                clip.addRef();
                this.clips.set(clip.name, clip);
            }
        });
    }

    play(sound: GameSound) {
        if (this.destroyed || this.muted || this.hidden || !this.unlocked) return;
        if (this.ended && sound !== 'game-over' && sound !== 'ui') return;
        const clip = this.clips.get(sound);
        if (!clip) return;
        const settings = SOUNDS[sound];
        const now = Date.now() / 1000;
        if (now - (this.lastPlayed.get(sound) ?? -Infinity) < settings.gap) return;

        let voice = this.effects.find(source => !source.playing && now >= (this.voiceFreeAt.get(source) ?? 0));
        if (!voice) {
            if (sound === 'shot' || sound === 'hit') return;
            voice = this.effects[this.nextVoice++ % this.effects.length];
            voice.stop();
        }
        this.lastPlayed.set(sound, now);
        this.voiceFreeAt.set(voice, now + Math.max(0.12, clip.getDuration()));
        voice.clip = clip;
        voice.volume = settings.volume;
        voice.play();
    }

    toggle() {
        this.muted = !this.muted;
        try { sys.localStorage.setItem(STORAGE_KEY, String(this.muted)); } catch {}
        if (this.muted) {
            if (this.music) this.music.volume = 0;
            this.music?.pause();
            this.musicRequested = false;
            for (const voice of this.effects) voice.stop();
            this.voiceFreeAt.clear();
        } else {
            this.unlock();
            this.play('ui');
        }
    }

    finish() {
        this.ended = true;
        if (this.music) this.music.volume = 0;
        this.music?.stop();
        this.musicRequested = false;
        for (const voice of this.effects) voice.stop();
        this.voiceFreeAt.clear();
        this.play('game-over');
    }

    private source(name: string) {
        const node = new Node(name);
        this.node.addChild(node);
        const source = node.addComponent(AudioSource);
        source.playOnAwake = false;
        return source;
    }

    private unlock() {
        this.unlocked = true;
        this.resumeMusic();
    }

    private resumeMusic() {
        if (this.destroyed || this.muted || this.hidden || this.ended) return;
        if (this.music) this.music.volume = 0.32;
        if (this.music?.clip && !this.music.playing && !this.musicRequested) {
            // Prime Cocos' native canvas gesture listener before the first browser touch.
            this.musicRequested = true;
            this.music.play();
        }
    }

    private onHide() {
        this.hidden = true;
        if (this.music) this.music.volume = 0;
        this.music?.pause();
        this.musicRequested = false;
        for (const voice of this.effects) voice.stop();
        this.voiceFreeAt.clear();
    }

    private onShow() {
        this.hidden = false;
        this.resumeMusic();
    }

    onDestroy() {
        this.destroyed = true;
        input.off(Input.EventType.TOUCH_END, this.unlock, this);
        input.off(Input.EventType.MOUSE_UP, this.unlock, this);
        input.off(Input.EventType.KEY_DOWN, this.unlock, this);
        game.off(Game.EVENT_HIDE, this.onHide, this);
        game.off(Game.EVENT_SHOW, this.onShow, this);
        for (const source of [this.music, ...this.effects]) {
            if (!source?.isValid) continue;
            source.stop();
            source.clip = null;
        }
        for (const clip of this.clips.values()) clip.decRef();
        this.clips.clear();
        this.effects.length = 0;
        this.music = null;
    }
}
