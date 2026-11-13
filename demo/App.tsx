import { useCallback, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent } from "react";
import { Rig, useAnimator, type ColorTransform, type RigEffects, type RigHandle, type Vector2 } from "paper-svg";
import { buildScene, DEFAULT_POSE, type Pose } from "./puppet";
import { followPointer, idle, waveHello } from "./animations";

const ANIMATION_FADE_MS = 400;

// Looping animations, each turned on and off by a checkbox.
const LOOPS = {
  idle: { label: "Idle (breathing and sway)", animation: () => idle },
  follow: { label: "Follow the pointer", animation: followPointer },
} as const;

type LoopId = keyof typeof LOOPS;
const loopIds = Object.keys(LOOPS) as LoopId[];

const TOGGLES = {
  clipSash: { label: "Clip sash to torso", initial: true },
  showPivots: { label: "Show joint pivots", initial: false },
  mirror: { label: "Mirror", initial: false },
  night: { label: "Night lighting (color transform)", initial: false },
  outerOutline: { label: "Outer outline", initial: false },
  glow: { label: "Glow", initial: false },
  tint: { label: "Tint", initial: false },
} as const;

type ToggleId = keyof typeof TOGGLES;

const toggleIds = Object.keys(TOGGLES) as ToggleId[];
const initialToggles = Object.fromEntries(toggleIds.map((id) => [id, TOGGLES[id].initial])) as Record<ToggleId, boolean>;

/** Darkens and blues a hex color. Other color values pass through unchanged. */
const nightLighting: ColorTransform = (color) => {
  const match = color?.match(/^#([0-9a-f]{6})$/i);
  if (!match) return color;
  const value = parseInt(match[1], 16);
  const channels = [(value >> 16) * 0.45, ((value >> 8) & 255) * 0.5, (value & 255) * 0.85];
  return `rgb(${channels.map(Math.round).join(", ")})`;
};

const angleTo = (pivot: Vector2, event: { clientX: number; clientY: number }) =>
  (Math.atan2(event.clientY - pivot.y, event.clientX - pivot.x) * 180) / Math.PI;

const App = () => {
  const [pose, setPose] = useState<Pose>(DEFAULT_POSE);
  const [shirtColor, setShirtColor] = useState("#4f9d69");
  const [balloon, setBalloon] = useState({ x: 125, y: 165 });
  const [toggles, setToggles] = useState(initialToggles);
  const [loops, setLoops] = useState<Record<LoopId, boolean>>({ idle: false, follow: false });

  // The animations play on top of the dragged pose, which is built into the tree, so their base is
  // the empty pose. The Rig shows each frame without a React render.
  const rigRef = useRef<RigHandle>(null);
  const pointerRef = useRef<Vector2 | null>(null);
  const animator = useAnimator({ base: () => ({}), write: (pose) => rigRef.current?.setPose(pose) });

  const setLoop = (id: LoopId, on: boolean) => {
    setLoops((last) => ({ ...last, [id]: on }));
    if (on) animator.add(id, LOOPS[id].animation(pointerRef), { fadeMs: ANIMATION_FADE_MS });
    else animator.remove(id, { fadeMs: ANIMATION_FADE_MS });
  };

  const handleStagePointer = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    pointerRef.current = {
      x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
      y: ((event.clientY - rect.top) / rect.height) * 2 - 1,
    };
  };

  const body = useMemo(
    () => buildScene({ pose, shirtColor, balloon, clipSash: toggles.clipSash }),
    [pose, shirtColor, balloon, toggles.clipSash],
  );

  const handleRotate = useCallback(
    (id: string, pivot: Vector2) => (event: ReactMouseEvent) => {
      event.preventDefault();
      // Pose values are stored before mirroring, so a mirrored part turns the opposite way on screen.
      const direction = (id.endsWith("_left") ? -1 : 1) * (toggles.mirror ? -1 : 1);
      let previous = angleTo(pivot, event);

      const onMove = (move: MouseEvent) => {
        const current = angleTo(pivot, move);
        const delta = ((current - previous + 540) % 360) - 180;
        previous = current;
        setPose((last) => ({ ...last, [id]: (last[id] ?? 0) + direction * delta }));
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [toggles.mirror],
  );

  const effects: RigEffects = {
    outerOutline: toggles.outerOutline ? { color: "#f59e0b", thickness: 5 } : undefined,
    glow: toggles.glow ? { color: "#7dd3fc", radius: 10, intensity: 0.9 } : undefined,
    tint: toggles.tint ? { color: "#a855f7", opacity: 0.4 } : undefined,
  };

  return (
    <main className="layout">
      <section className="stage">
        <svg
          viewBox="-220 -240 440 480"
          role="img"
          aria-label="Posable puppet holding a balloon"
          onPointerMove={handleStagePointer}
          onPointerLeave={() => (pointerRef.current = null)}
        >
          <Rig
            ref={rigRef}
            body={body}
            mirror={toggles.mirror}
            showPivots={toggles.showPivots}
            colorTransform={toggles.night ? nightLighting : undefined}
            onRotate={handleRotate}
            effects={effects}
          />
        </svg>
      </section>

      <aside className="panel">
        <h1>paper-svg</h1>
        <p>Drag the head, arms or legs to rotate their joints.</p>
        <button type="button" onClick={() => setPose(DEFAULT_POSE)}>
          Reset pose
        </button>

        <h2>Animation</h2>
        <p className="hint">Animations layer onto the pose each frame, so you can keep dragging joints while they play.</p>
        {loopIds.map((id) => (
          <label key={id} className="check">
            <input type="checkbox" checked={loops[id]} onChange={(event) => setLoop(id, event.target.checked)} />
            {LOOPS[id].label}
          </label>
        ))}
        <button type="button" onClick={() => animator.add("wave", waveHello())}>
          Wave
        </button>

        <h2>Balloon</h2>
        <p className="hint">The string and the eyes follow it with pin and aim constraints.</p>
        <label className="row">
          X
          <input
            type="range"
            min={-190}
            max={190}
            value={balloon.x}
            onChange={(event) => setBalloon({ ...balloon, x: Number(event.target.value) })}
          />
        </label>
        <label className="row">
          Y
          <input
            type="range"
            min={40}
            max={185}
            value={balloon.y}
            onChange={(event) => setBalloon({ ...balloon, y: Number(event.target.value) })}
          />
        </label>

        <h2>Appearance</h2>
        <label className="row">
          Shirt
          <input type="color" value={shirtColor} onChange={(event) => setShirtColor(event.target.value)} />
        </label>
        {toggleIds.map((id) => (
          <label key={id} className="check">
            <input
              type="checkbox"
              checked={toggles[id]}
              onChange={(event) => setToggles({ ...toggles, [id]: event.target.checked })}
            />
            {TOGGLES[id].label}
          </label>
        ))}
      </aside>
    </main>
  );
};

export default App;
