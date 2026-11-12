import { Play } from 'lucide-react';

const waveform = Array.from({ length: 30 }, (_, index) => 5 + ((index * 7) % 18));

export function BookShowcase() {
  return (
    <div
      role="img"
      aria-label="Preview of the Cadence player, showing a book cover and the floating playback dock"
      className="group relative mx-auto h-[470px] w-full max-w-[500px] select-none sm:h-[530px]"
    >
      <div className="absolute left-1/2 top-1/2 size-[320px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/20 blur-[110px] sm:size-[380px]" />

      {/* Back covers */}
      <div
        className="absolute left-[2%] top-[9%] h-[258px] w-[180px] -rotate-[9deg] overflow-hidden rounded-[18px] border border-white/10 shadow-[0_28px_60px_rgba(0,0,0,0.32)] sm:h-[300px] sm:w-[208px]"
        style={{ background: 'linear-gradient(150deg, #241050 0%, #742a6d 55%, #d9655f 100%)' }}
      >
        <div className="absolute inset-y-0 left-0 w-2 bg-black/20" />
        <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-white/20" />
        <div className="relative flex h-full flex-col p-5">
          <p className="text-[7px] font-semibold uppercase tracking-[0.3em] text-white/50">
            Cadence library
          </p>
          <p className="mt-auto font-reader text-[19px] font-semibold leading-[1.02] text-white/90">
            The Cartographer&rsquo;s Daughter
          </p>
        </div>
      </div>

      <div
        className="absolute right-[1%] top-[4%] h-[268px] w-[184px] rotate-[8deg] overflow-hidden rounded-[18px] border border-white/10 shadow-[0_28px_60px_rgba(0,0,0,0.32)] sm:h-[308px] sm:w-[212px]"
        style={{ background: 'linear-gradient(155deg, #4b2208 0%, #b85a17 56%, #f5bd63 100%)' }}
      >
        <div className="absolute inset-y-0 left-0 w-2 bg-black/15" />
        <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-white/20" />
        <div className="relative flex h-full flex-col p-5">
          <p className="text-[7px] font-semibold uppercase tracking-[0.3em] text-white/55">
            A memoir
          </p>
          <p className="mt-auto font-reader text-[19px] font-semibold leading-[1.02] text-white/95">
            North of the<br />Quiet Sea
          </p>
        </div>
      </div>

      {/* Front cover */}
      <div className="absolute left-1/2 top-[44%] -translate-x-1/2 -translate-y-1/2 -rotate-[2deg]">
        <div className="relative h-[318px] w-[220px] overflow-hidden rounded-[18px] border border-white/10 shadow-[0_40px_80px_rgba(0,0,0,0.42)] transition-transform duration-500 ease-out group-hover:-translate-y-2 group-hover:rotate-[0.5deg] sm:h-[356px] sm:w-[248px]">
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(155deg, #071e24 0%, #0b303a 52%, #15545e 100%)',
            }}
          />
          <div className="absolute -right-16 -top-16 size-48 rounded-full border border-white/10" />
          <div className="absolute -right-7 top-5 size-40 rounded-full border border-white/[0.07]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_86%,rgba(255,159,10,0.30),transparent_55%)]" />
          <div className="absolute inset-y-0 left-0 w-2.5 bg-black/25" />
          <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/[0.025] to-white/[0.13]" />

          <div className="relative flex h-full flex-col p-6 sm:p-7">
            <p className="text-[8px] font-semibold uppercase tracking-[0.34em] text-white/45">
              A novel
            </p>
            <div className="my-auto pt-8">
              <h2 className="font-reader text-[30px] font-semibold leading-[0.96] tracking-[-0.02em] text-white sm:text-[34px]">
                The
                <br />
                Glass
                <br />
                Horizon
              </h2>
              <div className="mt-5 h-px w-10 bg-amber/70" />
            </div>
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.26em] text-white/55">
                Elena Marlow
              </p>
              <p className="mt-2 text-[7px] uppercase tracking-[0.3em] text-white/25">
                Cadence edition
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Live lyrics chip */}
      <div className="glass absolute right-[4%] top-[15%] z-20 inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-secondary sm:right-[7%]">
        <span className="size-1.5 rounded-full bg-brand" />
        Live lyrics
      </div>

      {/* Dock */}
      <div className="glass-dock absolute inset-x-0 bottom-1 z-10 rounded-[24px] p-3.5 sm:bottom-0">
        <div className="flex items-center gap-3">
          <div
            className="size-11 shrink-0 rounded-[12px] border border-white/10 shadow-lg"
            style={{ background: 'linear-gradient(145deg, #0b303a, #15545e 60%, #b8792d)' }}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold tracking-[-0.01em]">
              The Glass Horizon
            </p>
            <p className="mt-0.5 truncate text-[10.5px] text-ink-secondary">
              Chapter 4 &middot; 14:22 left
            </p>
          </div>
          <div className="hidden h-7 items-center gap-[2px] sm:flex" aria-hidden="true">
            {waveform.map((height, index) => (
              <span
                key={index}
                className={index < 11 ? 'w-[2px] rounded-full bg-ink/80' : 'w-[2px] rounded-full bg-ink/20'}
                style={{ height }}
              />
            ))}
          </div>
          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-white text-[#111] shadow-[0_6px_18px_rgba(0,0,0,0.3)]">
            <Play size={13} fill="currentColor" className="ml-0.5" />
          </div>
        </div>
        <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-ink/10">
          <div className="h-full w-[38%] rounded-full bg-ink/75" />
        </div>
      </div>
    </div>
  );
}
