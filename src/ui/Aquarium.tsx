import { useEffect, useRef } from "react";

export type CreatureMood =
  "idle" | "thinking" | "working" | "waiting" | "complete" | "error";
export interface AquariumCompanion {
  id: string;
  name: string;
  mood?: CreatureMood;
}
export interface AquariumProps {
  name?: string;
  mood?: CreatureMood;
  station?: "terminal" | "files" | "tools" | null;
  selected?: boolean;
  presentation?: boolean;
  onSelect?: () => void;
  companions?: AquariumCompanion[];
  onSelectCompanion?: (id: string) => void;
}

// Original, procedural pixel art. Visual motion is ambient, never task progress.
export function Aquarium({
  name = "Miso",
  mood = "idle",
  station = null,
  selected = true,
  presentation = false,
  onSelect,
  companions = [],
  onSelectCompanion,
}: AquariumProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const settings = useRef({ name, mood, station, selected, companions });
  settings.current = { name, mood, station, selected, companions };
  useEffect(() => {
    const el = canvas.current!;
    const ctx = el.getContext("2d")!;
    let frame = 0;
    let active = true;
    const started = performance.now();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const rect = (
      x: number,
      y: number,
      w: number,
      h: number,
      color: string,
    ) => {
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(x), Math.round(y), w, h);
    };
    const plant = (
      x: number,
      floor: number,
      height: number,
      color: string,
      t: number,
      seed: number,
    ) => {
      for (let n = 0; n < height; n += 5) {
        const sway = Math.sin(t * 0.6 + n * 0.07 + seed) * (n / height) * 9;
        rect(x + sway, floor - n, 5, 6, color);
        if (n % 15 === 0)
          rect(x + sway - (n % 30 ? 7 : -4), floor - n, 9, 4, color);
      }
    };
    const draw = () => {
      if (!active) return;
      const box = el.getBoundingClientRect();
      const w = Math.max(400, Math.round(box.width / 2));
      const h = Math.max(230, Math.round(box.height / 2));
      if (el.width !== w || el.height !== h) {
        el.width = w;
        el.height = h;
      }
      ctx.imageSmoothingEnabled = false;
      const t = reducedMotion.matches
        ? 0
        : (performance.now() - started) / 1000;
      const s = settings.current;
      const floor = h - 33;
      const gradient = ctx.createLinearGradient(0, 0, 0, h);
      gradient.addColorStop(0, "#082a3d");
      gradient.addColorStop(0.6, "#061e30");
      gradient.addColorStop(1, "#071b29");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
      // Thin shafts of light and suspended particles give the water depth.
      for (let i = 0; i < 5; i++) {
        ctx.fillStyle = "rgba(64,184,190,.025)";
        ctx.beginPath();
        ctx.moveTo(w * (0.07 + i * 0.24), 0);
        ctx.lineTo(w * (0.17 + i * 0.24), 0);
        ctx.lineTo(w * (0.37 + i * 0.24), h);
        ctx.lineTo(w * (0.16 + i * 0.24), h);
        ctx.fill();
      }
      for (let i = 0; i < 43; i++)
        rect(
          (i * 83.17 + t * ((i % 3) + 1)) % w,
          (i * 61.31) % (h - 40),
          1,
          1,
          i % 4 === 0 ? "#356078" : "#173e50",
        );
      // Back reef silhouette.
      for (let i = 0; i < 13; i++)
        plant((i * w) / 12, floor, 30 + ((i * 23) % 50), "#103c45", t, i);
      rect(0, floor + 12, w, 30, "#102d38");
      rect(0, floor + 24, w, 20, "#163842");
      for (let i = 0; i < 80; i++)
        rect(
          (i * 47.77) % w,
          floor + 15 + ((i * 13) % 17),
          2 + (i % 3),
          2,
          i % 3 ? "#24434a" : "#31515a",
        );
      // Original low-resolution rocks.
      const rock = (x: number, y: number, size: number) => {
        rect(x + 5, y, size - 10, 5, "#2c4955");
        rect(x, y + 5, size, 13, "#263f4c");
        rect(x - 4, y + 18, size + 8, 8, "#1b3542");
        rect(x + 8, y + 4, size / 3, 3, "#3e5b64");
      };
      rock(22, floor - 13, 45);
      rock(w - 73, floor - 17, 60);
      rock(w * 0.52, floor + 3, 26);
      [12, 31, w - 31, w - 46, w * 0.63].forEach((x, i) =>
        plant(
          x,
          floor + 20,
          46 + ((i * 7) % 35),
          i % 2 ? "#238b7e" : "#1a6c70",
          t,
          i,
        ),
      );
      // Coral colonies, built exclusively from rectangles.
      for (let i = 0; i < 5; i++) {
        const x = w * 0.14 + i * 9;
        const y = floor + 13;
        rect(x, y - 17 - (i % 3) * 7, 5, 24 + (i % 3) * 7, "#b96169");
        rect(x - 5, y - 17 - (i % 3) * 7, 12, 4, "#ed8c82");
      }
      for (let i = 0; i < 4; i++) {
        const x = w * 0.86 + i * 8;
        rect(x, floor - 9 - (i % 2) * 8, 4, 27, "#ad786c");
        rect(x - 3, floor - 12 - (i % 2) * 8, 11, 4, "#dca78b");
      }
      // Station iconography remains paired with readable DOM labels below.
      const positions = { terminal: w * 0.3, files: w * 0.5, tools: w * 0.7 };
      for (const [key, x] of Object.entries(positions)) {
        const lit = s.station === key;
        rect(x - 14, floor - 13, 28, 20, lit ? "#2a727b" : "#213f50");
        rect(x - 12, floor - 11, 24, 15, "#0a202d");
        if (key === "terminal") {
          rect(x - 7, floor - 7, 3, 2, "#62c6c4");
          rect(x - 4, floor - 5, 3, 2, "#62c6c4");
          rect(x + 1, floor - 3, 7, 1, "#62c6c4");
        }
        if (key === "files") {
          rect(x - 7, floor - 8, 7, 3, "#6bafb4");
          rect(x - 7, floor - 5, 15, 7, "#6bafb4");
        }
        if (key === "tools") {
          rect(x - 2, floor - 8, 4, 10, "#6bafb4");
          rect(x - 5, floor - 6, 10, 4, "#6bafb4");
        }
        rect(x - 17, floor + 7, 34, 4, "#395663");
      }
      for (let i = 0; i < 13; i++) {
        const y = h - ((t * (8 + (i % 4) * 3) + i * 39) % (h + 20));
        const x = ((i * 71.1) % w) + Math.sin(t + i) * 3;
        ctx.strokeStyle = "#2e6374";
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(x), Math.round(y), 2 + (i % 3), 2 + (i % 3));
      }
      const targetX = s.station ? positions[s.station] : w * 0.48;
      const x = targetX + Math.sin(t * 0.5) * (s.station ? 7 : 24);
      const y = (s.station ? floor - 55 : h * 0.45) + Math.sin(t * 1.1) * 5;
      const drawCreature = (
        x: number,
        y: number,
        creatureName: string,
        creatureMood: CreatureMood,
        highlight: boolean,
      ) => {
        if (highlight) {
          ctx.strokeStyle = "rgba(103,222,211,.18)";
          ctx.beginPath();
          ctx.ellipse(x, y + 4, 33, 29, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
        const body =
          creatureMood === "error"
            ? "#ef968e"
            : creatureMood === "complete"
              ? "#a7e0bd"
              : "#8de1d2";
        // Miso: a tiny axolotl with branching coral gills and a tapered tail.
        rect(x - 20, y - 5, 8, 3, "#cc817e");
        rect(x - 23, y - 10, 4, 5, "#efaba0");
        rect(x - 22, y + 1, 7, 3, "#efaba0");
        rect(x + 13, y - 5, 9, 3, "#cc817e");
        rect(x + 20, y - 10, 4, 5, "#efaba0");
        rect(x + 17, y + 1, 7, 3, "#efaba0");
        rect(x - 14, y - 9, 28, 18, body);
        rect(x - 10, y - 13, 20, 5, body);
        rect(x - 10, y + 8, 21, 7, "#65b9b0");
        rect(x + 10, y + 10, 12, 4, "#65b9b0");
        rect(x + 20, y + 7 + Math.sin(t * 3) * 2, 6, 4, "#81cec2");
        rect(x - 8, y - 3, 3, 4, "#0a3241");
        rect(x + 6, y - 3, 3, 4, "#0a3241");
        rect(x - 1, y + 4, 4, 1, "#31676b");
        rect(x - 11, y + 2, 4, 2, "#d99d96");
        rect(x + 9, y + 2, 4, 2, "#d99d96");
        ctx.font = "7px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillStyle = "#b1d4d7";
        ctx.fillText(creatureName.slice(0, 19), x, y + 28);
      };
      drawCreature(x, y, s.name, s.mood, s.selected);
      s.companions.slice(0, 3).forEach((creature, index) => {
        drawCreature(
          w * (0.2 + index * 0.3) + Math.sin(t * 0.5 + index) * 5,
          h * 0.22 + Math.sin(t + index) * 3,
          creature.name,
          creature.mood ?? "idle",
          false,
        );
      });
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => {
      active = false;
      cancelAnimationFrame(frame);
    };
  }, []);
  const content = (
    <>
      <canvas ref={canvas} />
      <span className="aquarium-hint">Click a creature to inspect</span>
    </>
  );
  // Keep this wrapper and canvas mounted when sessions arrive asynchronously.
  // Switching the wrapper element would leave the animation drawing a detached canvas.
  return (
    <div className={`aquarium-canvas ${presentation ? "is-presentation" : ""}`}>
      {content}
      <button
        type="button"
        className="aquarium-primary-hit"
        aria-label={`Inspect ${name}, ${mood}`}
        onClick={onSelect}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          border: 0,
          background: "transparent",
          outlineOffset: -4,
        }}
      />
      {companions.slice(0, 3).map((creature, index) => (
        <button
          key={creature.id}
          type="button"
          className="aquarium-companion-hit"
          style={{
            position: "absolute",
            left: `${20 + index * 30}%`,
            top: "22%",
            width: 100,
            height: 90,
            transform: "translate(-50%, -35%)",
            background: "transparent",
            border: 0,
            padding: 0,
          }}
          aria-label={`Inspect ${creature.name}, ${creature.mood ?? "idle"}`}
          onClick={() => onSelectCompanion?.(creature.id)}
        />
      ))}
    </div>
  );
}
