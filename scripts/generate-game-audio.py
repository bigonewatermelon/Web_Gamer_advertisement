"""Compose the game's original looping score and cartoon sound effects as PCM WAV assets."""
from pathlib import Path
import wave

import numpy as np


RATE = 22050
BEAT = 60 / 112
OUTPUT = Path(__file__).resolve().parents[1] / "assets/resources/audio"
RNG = np.random.default_rng(1487)


def frequency(note):
    return 440 * 2 ** ((note - 69) / 12)


def tone(note, duration, instrument="bell"):
    t = np.arange(round(duration * RATE)) / RATE
    phase = 2 * np.pi * frequency(note) * t
    attack = np.minimum(1, t / 0.006)
    if instrument == "pluck":
        signal = np.sin(phase) + 0.28 * np.sin(2 * phase) + 0.09 * np.sin(3 * phase)
        envelope = np.exp(-t * 8) * np.minimum(1, (duration - t) / 0.04)
    elif instrument == "bass":
        signal = np.sin(phase) + 0.12 * np.sin(2 * phase)
        envelope = np.exp(-t * 3) * np.minimum(1, (duration - t) / 0.06)
    else:
        signal = np.sin(phase) * np.exp(-t * 4.8)
        signal += 0.28 * np.sin(phase * 2.76) * np.exp(-t * 10)
        signal += 0.07 * np.sin(phase * 5.4) * np.exp(-t * 17)
        envelope = np.minimum(1, (duration - t) / 0.05)
    return signal * envelope * attack


def mix(buffer, sound, start, gain=1, pan=0, loop=False):
    start = round(start * RATE)
    indices = np.arange(len(sound)) + start
    valid = np.ones(len(indices), dtype=bool) if loop else (indices < len(buffer))
    indices = indices[valid] % len(buffer)
    angle = (pan + 1) * np.pi / 4
    buffer[indices, 0] += sound[valid] * gain * np.cos(angle)
    buffer[indices, 1] += sound[valid] * gain * np.sin(angle)


def save(name, buffer):
    file = OUTPUT / (name + ".wav")
    file.parent.mkdir(parents=True, exist_ok=True)
    peak = np.max(np.abs(buffer))
    if peak > 0.86:
        buffer *= 0.86 / peak
    with wave.open(str(file), "wb") as audio:
        audio.setnchannels(2)
        audio.setsampwidth(2)
        audio.setframerate(RATE)
        audio.writeframes((buffer * 32767).astype("<i2").tobytes())


def compose_music():
    music = np.zeros((round(16 * 4 * BEAT * RATE), 2))
    chords = [(48, 60, 64, 67, 69), (45, 57, 60, 64, 67),
              (41, 57, 60, 64, 65), (43, 55, 59, 62, 67)]
    melodies = [
        [76, 79, 81, None, 79, 76, 74, None],
        [72, 76, 79, None, 76, 72, 69, None],
        [69, 72, 77, 76, 74, None, 72, None],
        [71, 74, 79, None, 77, 74, 71, 74],
        [76, None, 79, 81, 84, None, 81, 79],
        [76, 79, 81, None, 79, 76, 72, None],
        [77, 76, 72, None, 69, 72, 74, 77],
        [79, None, 77, 74, 71, None, 74, None],
        [79, 84, 83, 81, 79, None, 76, None],
        [81, None, 79, 76, 72, 76, 79, None],
        [77, 81, 79, 77, 76, None, 72, None],
        [74, 79, 77, None, 74, 71, 67, None],
        [76, 79, 81, None, 79, 76, 74, None],
        [72, 76, 79, None, 81, 79, 76, None],
        [77, 76, 72, None, 69, 72, 74, 77],
        [79, None, 77, 74, 71, None, 74, 71],
    ]
    for bar, melody in enumerate(melodies):
        root, *chord = chords[bar % 4]
        for step, note in enumerate(melody):
            if note is not None:
                length = 0.75 if step < 7 and melody[step + 1] is None else 0.45
                mix(music, tone(note, length * BEAT + 0.22),
                    (bar * 4 + step / 2) * BEAT, 0.19, -0.12, True)
        for step in range(8):
            timing = (bar * 4 + step / 2 + (0.025 if step % 2 else 0)) * BEAT
            mix(music, tone(chord[[0, 2, 1, 3, 0, 2, 1, 2][step]], 0.34, "pluck"),
                timing, 0.085, 0.38 if step % 2 else -0.4, True)
            shaker_t = np.arange(round(RATE * 0.055)) / RATE
            noise = RNG.normal(0, 1, len(shaker_t))
            noise = np.concatenate(([0], np.diff(noise)))
            mix(music, noise * np.exp(-shaker_t * 85), timing, 0.008, 0.55, True)
        for beat, note in [(0, root), (2, root + 7)]:
            mix(music, tone(note, BEAT * 1.4, "bass"), (bar * 4 + beat) * BEAT, 0.15, 0, True)
            t = np.arange(round(RATE * 0.2)) / RATE
            kick = np.sin(2 * np.pi * (52 * t + 5 * (1 - np.exp(-t * 30)))) * np.exp(-t * 22)
            mix(music, kick, (bar * 4 + beat) * BEAT, 0.10, 0, True)
        for beat in [1, 3]:
            t = np.arange(round(RATE * 0.12)) / RATE
            brush = RNG.normal(0, 0.45, len(t)) * np.exp(-t * 37)
            mix(music, brush, (bar * 4 + beat) * BEAT, 0.025, -0.18, True)
    # Periodic reverb wraps the final note tails into the start for a seamless loop.
    dry = music.copy()
    for delay, gain in [(0.11, 0.10), (0.23, 0.065), (0.37, 0.035)]:
        music += np.roll(dry[:, ::-1], round(delay * RATE), axis=0) * gain
    music *= 1.9
    save("bridge-bounce", music)


def chime(name, notes, spacing, gain=0.55):
    duration = (len(notes) - 1) * spacing + 0.55
    sound = np.zeros((round(duration * RATE), 2))
    for index, note in enumerate(notes):
        mix(sound, tone(note, 0.55), index * spacing, gain / (1 + index * 0.08), (index % 2 - 0.5) * 0.25)
    save("effects/" + name, sound)


def sweep(name, duration, start, end, gain, noise=0):
    t = np.arange(round(duration * RATE)) / RATE
    pitch = end + (start - end) * np.exp(-t * 8 / duration)
    phase = 2 * np.pi * np.cumsum(pitch) / RATE
    envelope = np.minimum(1, t / 0.004) * np.exp(-t * 5 / duration)
    signal = (np.sin(phase) + noise * RNG.normal(0, 1, len(t))) * envelope
    save("effects/" + name, np.column_stack((signal, signal)) * gain)


if __name__ == "__main__":
    compose_music()
    sweep("shot", 0.085, 850, 180, 0.48, 0.08)
    sweep("hit", 0.10, 480, 110, 0.48, 0.18)
    sweep("loss", 0.30, 360, 95, 0.50, 0.04)
    sweep("ui", 0.055, 1200, 780, 0.28)
    sweep("boss-attack", 0.48, 160, 580, 0.40, 0.035)
    chime("recruit", [76, 79, 84], 0.07)
    chime("upgrade", [72, 76, 79, 84, 88], 0.09, 0.45)
    chime("shield", [79, 86, 91], 0.045, 0.46)
    chime("rescue", [79, 84, 88], 0.095, 0.48)
    chime("boss-intro", [55, 58, 62, 67], 0.16, 0.52)
    chime("boss-win", [72, 76, 79, 84, 84], 0.12, 0.48)
    chime("game-over", [76, 74, 71, 60], 0.18, 0.45)
    print("Composed", len(list(OUTPUT.rglob("*.wav"))), "original audio clips in", OUTPUT)
