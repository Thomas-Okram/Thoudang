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
        className="rounded-lg bg-slate-100 px-4 py-3 text-sm text-slate-500"
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
    <div className="flex items-center gap-4 rounded-xl border border-teal-accent/40 bg-teal-soft/30 px-4 py-3">
      <button
        onClick={() => void play()}
        disabled={busy}
        aria-label={playing ? 'Pause' : 'Listen in Manipuri'}
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-teal-accent text-white shadow-md transition hover:brightness-110 disabled:bg-slate-400"
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
        <div className="font-beng text-sm text-slate-600">মণিপুরীদা তাবীয়ু</div>
        <div className="text-xs text-slate-500">
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
