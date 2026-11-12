import { Moon, ShieldCheck, Sun } from 'lucide-react';
import { EmptyLibrary } from '@/components/bookshelf/EmptyLibrary';
import { MeshBackdrop } from '@/components/player/MeshBackdrop';
import { IconButton } from '@/components/ui/IconButton';
import { LogoMark } from '@/components/ui/LogoMark';
import { useTheme } from '@/hooks/useTheme';

export function AppShell() {
  const { resolved, toggle } = useTheme();

  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-hidden">
      <MeshBackdrop />

      <header className="pt-safe relative z-10 px-5 sm:px-8">
        <div className="mx-auto flex h-[72px] w-full max-w-6xl items-center justify-between">
          <div className="flex items-center gap-2.5">
            <LogoMark className="size-8" />
            <div className="flex items-center gap-2">
              <span className="text-[17px] font-semibold tracking-[-0.035em]">Cadence</span>
              <span className="rounded-pill border border-hairline px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-ink-tertiary">
                Preview
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-pill border border-hairline bg-surface px-3 py-1.5 text-[11px] font-medium text-ink-secondary backdrop-blur-xl sm:inline-flex">
              <ShieldCheck size={13} className="text-success" aria-hidden="true" />
              100% on-device
            </span>
            <IconButton
              label={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} appearance`}
              onClick={toggle}
              variant="secondary"
            >
              {resolved === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </IconButton>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 items-center px-5 py-10 sm:px-8 lg:py-16">
        <EmptyLibrary />
      </main>

      <footer className="relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-1 px-5 pb-6 text-[11px] text-ink-tertiary sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p>Cadence 0.1 &middot; Preview build</p>
        <p>No accounts. No telemetry. No uploads.</p>
      </footer>
    </div>
  );
}
