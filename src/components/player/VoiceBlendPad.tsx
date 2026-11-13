import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { VoiceDefinition } from '@/core/tts/voices';
import { cn } from '@/lib/cn';

export type VoicePadWeights = [number, number, number];

type VoiceBlendPadProps = {
  /** Primary, secondary, tertiary definitions in vertex order. */
  voices: [VoiceDefinition, VoiceDefinition, VoiceDefinition];
  /** Normalised weights in the same order. */
  weights: VoicePadWeights;
  onChange: (weights: VoicePadWeights) => void;
};

// Triangle vertices in a 100 × 90 viewBox: primary on top, then the two
// supporting voices along the base.
const A = { x: 50, y: 14 };
const B = { x: 12, y: 82 };
const C = { x: 88, y: 82 };

function barycentric(px: number, py: number): VoicePadWeights {
  const v0x = C.x - B.x;
  const v0y = C.y - B.y;
  const v1x = A.x - B.x;
  const v1y = A.y - B.y;
  const v2x = px - B.x;
  const v2y = py - B.y;

  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;

  const denominator = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(denominator) < 1e-6) return [1 / 3, 1 / 3, 1 / 3];

  const weightC = (dot11 * dot02 - dot01 * dot12) / denominator;
  const weightA = (dot00 * dot12 - dot01 * dot02) / denominator;
  const weightB = 1 - weightA - weightC;

  const clamped: VoicePadWeights = [
    Math.max(0, weightA),
    Math.max(0, weightB),
    Math.max(0, weightC),
  ];
  const total = clamped[0] + clamped[1] + clamped[2];
  if (total < 1e-6) return [1 / 3, 1 / 3, 1 / 3];
  return [clamped[0] / total, clamped[1] / total, clamped[2] / total];
}

function pointForWeights(weights: VoicePadWeights): { x: number; y: number } {
  return {
    x: weights[0] * A.x + weights[1] * B.x + weights[2] * C.x,
    y: weights[0] * A.y + weights[1] * B.y + weights[2] * C.y,
  };
}

/**
 * A barycentric triangle mixer: dragging the puck blends the three style
 * vectors. Distances are normalised, so the puck always stays inside the
 * triangle and the weights always sum to one.
 */
export function VoiceBlendPad({ voices, weights, onChange }: VoiceBlendPadProps) {
  const padRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const point = pointForWeights(weights);

  const updateFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = padRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * 100;
    const py = ((event.clientY - rect.top) / rect.height) * 90;
    onChange(barycentric(px, py));
  };

  const start = (event: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromPointer(event);
  };

  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    updateFromPointer(event);
  };

  const end = (event: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const vertexLabels = [
    { voice: voices[0], alignment: 'top-0 left-1/2 -translate-x-1/2' },
    { voice: voices[1], alignment: 'bottom-0 left-0' },
    { voice: voices[2], alignment: 'bottom-0 right-0' },
  ];

  return (
    <div className="mt-4">
      <div
        ref={padRef}
        role="group"
        aria-label="Three-voice blend pad"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className="relative mx-auto aspect-[10/9] w-full max-w-[300px] touch-none select-none"
      >
        <svg
          viewBox="0 0 100 90"
          preserveAspectRatio="none"
          aria-hidden="true"
          className="absolute inset-0 h-full w-full overflow-visible"
        >
          <defs>
            <linearGradient id="voice-pad-fill" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--color-brand)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--color-amber)" stopOpacity="0.08" />
            </linearGradient>
          </defs>
          <polygon
            points={`${A.x},${A.y} ${B.x},${B.y} ${C.x},${C.y}`}
            fill="url(#voice-pad-fill)"
            stroke="var(--color-hairline)"
            strokeWidth="0.8"
          />
          {[
            { x1: A.x, y1: A.y, x2: 50, y2: 82 },
            { x1: B.x, y1: B.y, x2: 69, y2: 48 },
            { x1: C.x, y1: C.y, x2: 31, y2: 48 },
          ].map((line) => (
            <line
              key={`${line.x1}-${line.y1}`}
              x1={line.x1}
              y1={line.y1}
              x2={line.x2}
              y2={line.y2}
              stroke="var(--color-hairline)"
              strokeWidth="0.5"
              strokeDasharray="2 2"
            />
          ))}
          <circle cx={A.x} cy={A.y} r="1.6" fill="var(--color-ink-tertiary)" />
          <circle cx={B.x} cy={B.y} r="1.6" fill="var(--color-ink-tertiary)" />
          <circle cx={C.x} cy={C.y} r="1.6" fill="var(--color-ink-tertiary)" />
        </svg>

        {vertexLabels.map(({ voice, alignment }) => (
          <span
            key={voice.id}
            className={cn(
              'pointer-events-none absolute max-w-[44%] truncate text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-tertiary',
              alignment,
            )}
          >
            {voice.name}
          </span>
        ))}

        <span
          aria-hidden="true"
          className="pointer-events-none absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand text-white shadow-glow ring-2 ring-white/70"
          style={{ left: `${point.x}%`, top: `${(point.y / 90) * 100}%` }}
        />

        <span className="sr-only">
          {voices[0].name} {Math.round(weights[0] * 100)}%, {voices[1].name}{' '}
          {Math.round(weights[1] * 100)}%, {voices[2].name} {Math.round(weights[2] * 100)}%. Drag
          inside the triangle to blend.
        </span>
      </div>

      <div className="mt-1 grid grid-cols-3 gap-2 text-center">
        {voices.map((voice, index) => (
          <div key={voice.id} className="rounded-xl border border-hairline bg-surface-muted/30 px-2 py-1.5">
            <p className="truncate text-[10.5px] font-medium text-ink-secondary">{voice.name}</p>
            <p className="text-[12px] font-semibold tabular-nums">
              {Math.round(weights[index] * 100)}%
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
