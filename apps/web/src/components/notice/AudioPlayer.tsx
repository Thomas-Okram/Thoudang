import { useEffect, useRef, useState } from 'react';
import { generateNoticeAudio, type NoticeAudio } from '../../lib/api';

/** Large "Listen in Manipuri" button. No audio → a quiet note, never an error. */
export function AudioPlayer({ caseId, audio }: { caseId: string; audio: NoticeAudio }) {
  const [state, setState] = useState<NoticeAudio>(audio);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const el = useRef<HTMLAudioElement>(null);
  useEffect(() => setState(audio), [audio]);

  if (!state.available) {
    return (
      <p
        className="flex max-w-sm items-center rounded-card border border-dashed border-line-strong bg-white/60 px-5 py-4 text-sm text-ink-muted"
        data-testid="audio-unavailable"
      >
        Audio unavailable
        {state.reason
          ? ` — ${state.reason.replace(/^Audio unavailable\s*[—(-]\s*/, '').replace(/\)$/, '')}`
          : ''}
      </p>
    );
  }

  const play = async () => {
    let url = state.url;
    if (!url) {
      setBusy(true);
      const next = await generateNoticeAudio(caseId).catch(
        () =>
          ({
            available: false,
            cached: false,
            url: null,
            reason: 'Audio unavailable',
          }) as NoticeAudio,
      );
      setBusy(false);
      setState(next);
      if (!next.url) return;
      url = next.url;
    }
    const a = el.current;
    if (!a) return;
    if (a.src !== new URL(url, window.location.origin).href) a.src = url;
    if (playing) {
      a.pause();
    } else {
      await a.play().catch(() => undefined);
    }
  };

  return (
    <div className="flex items-center gap-4 rounded-card border border-teal-accent/40 bg-teal-wash px-5 py-4 shadow-card">
      <button
        onClick={() => void play()}
        disabled={busy}
        aria-label={playing ? 'Pause' : 'Listen in Manipuri'}
        className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-teal-deep text-white shadow-raised transition hover:bg-teal-darker disabled:bg-slate-400 ${playing ? 'animate-halo' : ''}`}
      >
        {busy ? (
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
        ) : playing ? (
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden>
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="ml-1 h-7 w-7" fill="currentColor" aria-hidden>
            <path d="M7 4.5v15l13-7.5z" />
          </svg>
        )}
      </button>
      <div>
        <div className="text-lg font-bold text-navy-900">Listen in Manipuri</div>
        <div className="font-beng text-sm text-ink-soft">মণিপুরীদা তাবীয়ু</div>
        <div className="text-xs text-ink-muted">
          {busy
            ? 'Preparing audio…'
            : state.cached
              ? 'Pre-generated · plays offline'
              : 'Generated on first play'}
        </div>
      </div>
      <audio
        ref={el}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        preload="none"
      />
    </div>
  );
}
