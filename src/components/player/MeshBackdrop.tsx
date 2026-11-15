import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';

export type MeshBackdropProps = {
  colors?: [string, string, string];
  className?: string;
};

/**
 * The soft mesh gradient behind the app. Each disc is a static radial gradient
 * tinted by the open book's palette; keeping it filter-free and animation-free
 * means it never forces a full-screen repaint while the UI is scrolling.
 */
export function MeshBackdrop({
  colors = ['#fa2d48', '#ff9f0a', '#5e5ce6'],
  className,
}: MeshBackdropProps) {
  return (
    <div className={cn('mesh-stage', className)} aria-hidden="true">
      <div
        className="mesh-orb"
        style={{ '--orb': colors[0], top: '-28%', left: '-16%' } as CSSProperties}
      />
      <div
        className="mesh-orb"
        style={{ '--orb': colors[1], top: '18%', right: '-24%' } as CSSProperties}
      />
      <div
        className="mesh-orb"
        style={{ '--orb': colors[2], bottom: '-36%', left: '18%' } as CSSProperties}
      />
    </div>
  );
}
