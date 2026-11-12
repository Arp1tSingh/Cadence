import { cn } from '@/lib/cn';

export type MeshBackdropProps = {
  colors?: [string, string, string];
  className?: string;
};

/**
 * The slow-moving, ultra-blurred mesh gradient behind the app. Colors will be
 * extracted from the open book cover in a later milestone.
 */
export function MeshBackdrop({
  colors = ['#fa2d48', '#ff9f0a', '#5e5ce6'],
  className,
}: MeshBackdropProps) {
  return (
    <div className={cn('mesh-stage', className)} aria-hidden="true">
      <div
        className="mesh-orb"
        style={{ background: colors[0], top: '-28%', left: '-16%' }}
      />
      <div
        className="mesh-orb"
        style={{ background: colors[1], top: '18%', right: '-24%' }}
      />
      <div
        className="mesh-orb"
        style={{ background: colors[2], bottom: '-36%', left: '18%' }}
      />
    </div>
  );
}
