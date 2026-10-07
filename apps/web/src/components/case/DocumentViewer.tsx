import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import type { CaseDocument } from '../../lib/api';
import type { Highlight } from '../../lib/highlight';
import { DOC_LABEL } from '../../lib/labels';

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;

interface View {
  zoom: number;
  x: number;
  y: number;
}
const FIT: View = { zoom: 1, x: 0, y: 0 };

export function DocumentViewer({
  documents,
  activeId,
  onSelect,
  highlight,
}: {
  documents: CaseDocument[];
  activeId: string | null;
  onSelect: (id: string) => void;
  highlight: Highlight | null;
}) {
  const doc = documents.find((d) => d.id === activeId) ?? documents[0] ?? null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="tablist"
        aria-label="Documents"
        className="flex gap-2 overflow-x-auto border-b border-slate-200 bg-white px-3 pt-3"
      >
        {documents.map((d) => {
          const active = d.id === doc?.id;
          return (
            <button
              key={d.id}
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(d.id)}
              className={`group flex shrink-0 items-center gap-2 rounded-t-lg border border-b-0 px-2.5 py-2 text-left text-sm transition ${
                active
                  ? 'border-slate-200 bg-slate-50 font-semibold text-navy-900'
                  : 'border-transparent text-slate-500 hover:bg-slate-50 hover:text-navy-900'
              }`}
            >
              <img
                src={d.thumbUrl}
                alt=""
                className="h-9 w-9 rounded border border-slate-200 bg-white object-cover"
                loading="lazy"
              />
              <span className="flex flex-col leading-tight">
                <span>{d.detectedType ? DOC_LABEL[d.detectedType] : 'Unidentified'}</span>
                <span className="text-[11px] font-normal text-slate-400">
                  {d.state === 'FAILED'
                    ? 'needs manual review'
                    : d.typeSource === 'officer'
                      ? 'type set by officer'
                      : d.originalName}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {doc ? (
        <ImagePane
          key={doc.id}
          doc={doc}
          highlight={highlight?.documentId === doc.id ? highlight : null}
        />
      ) : (
        <div className="flex-1" />
      )}
    </div>
  );
}

export function ImagePane({ doc, highlight }: { doc: CaseDocument; highlight: Highlight | null }) {
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(FIT);
  const [broken, setBroken] = useState(false);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  const field = highlight?.field ? doc.extraction?.fields[highlight.field] : undefined;
  const bbox = field?.bbox ?? null;
  const missingLocation = Boolean(highlight?.field) && !bbox;

  const clamp = useCallback(
    (v: View): View => {
      const el = box.current;
      if (!el) return v;
      const w = el.clientWidth;
      const h = (w * doc.height) / Math.max(1, doc.width);
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom));
      const minX = Math.min(0, w - w * zoom);
      const minY = Math.min(0, el.clientHeight - h * zoom);
      return { zoom, x: Math.min(0, Math.max(minX, v.x)), y: Math.min(0, Math.max(minY, v.y)) };
    },
    [doc.width, doc.height],
  );

  // Clicking a flag/field zooms to its box and centres it.
  useEffect(() => {
    const el = box.current;
    if (!el || highlight?.mode !== 'click' || !bbox) return;
    const w = el.clientWidth;
    const scale = w / doc.width;
    const [x1, y1, x2, y2] = bbox;
    const zoom = Math.min(3, Math.max(1.4, (w * 0.55) / Math.max(1, (x2 - x1) * scale)));
    const cx = ((x1 + x2) / 2) * scale * zoom;
    const cy = ((y1 + y2) / 2) * scale * zoom;
    setView(clamp({ zoom, x: w / 2 - cx, y: el.clientHeight / 2 - cy }));
  }, [highlight, bbox, doc.width, clamp]);

  const zoomAt = (factor: number, px?: number, py?: number) => {
    const el = box.current;
    if (!el) return;
    const ox = px ?? el.clientWidth / 2;
    const oy = py ?? el.clientHeight / 2;
    setView((v) => {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
      const k = zoom / v.zoom;
      return clamp({ zoom, x: ox - (ox - v.x) * k, y: oy - (oy - v.y) * k });
    });
  };

  const onWheel = (e: WheelEvent) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - rect.left, e.clientY - rect.top);
  };
  const onPointerDown = (e: PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setView((v) => clamp({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-slate-50">
      <div
        ref={box}
        data-testid="image-viewport"
        className={`relative min-h-0 flex-1 touch-none overflow-hidden ${view.zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={() => setView(FIT)}
      >
        {broken || doc.width === 0 ? (
          <div className="flex h-full items-center justify-center p-8 text-center text-slate-500">
            <div>
              <p className="font-semibold text-navy-900">This image could not be opened</p>
              <p className="mt-1 text-sm">
                {doc.error ?? 'Check the paper document — manual review.'}
              </p>
            </div>
          </div>
        ) : (
          <div
            className="absolute left-0 top-0 w-full origin-top-left transition-transform duration-300 ease-out"
            style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
          >
            <img
              src={doc.imageUrl}
              alt={`${doc.detectedType ? DOC_LABEL[doc.detectedType] : 'Document'} (${doc.originalName})`}
              className="block w-full select-none shadow-sm"
              draggable={false}
              onError={() => setBroken(true)}
            />
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full"
              viewBox={`0 0 ${doc.width} ${doc.height}`}
              preserveAspectRatio="none"
              aria-hidden={!bbox}
            >
              {bbox && (
                <rect
                  data-testid="bbox-highlight"
                  x={bbox[0] - 6}
                  y={bbox[1] - 6}
                  width={bbox[2] - bbox[0] + 12}
                  height={bbox[3] - bbox[1] + 12}
                  rx={6}
                  fill="rgb(15 158 142 / 0.16)"
                  stroke="#0f9e8e"
                  strokeWidth={3}
                  vectorEffect="non-scaling-stroke"
                  className="animate-pulse-ring"
                />
              )}
            </svg>
          </div>
        )}

        {doc.redaction !== 'none' && (
          <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-navy-900/90 px-3 py-1 text-xs font-semibold text-white shadow">
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
              <path d="M10 2 4 4.5v4.8c0 4 2.6 7.3 6 8.7 3.4-1.4 6-4.7 6-8.7V4.5L10 2Z" />
            </svg>
            {doc.redaction === 'bbox'
              ? 'Aadhaar number redacted on server'
              : 'Aadhaar masked — number location unknown'}
          </div>
        )}
        {missingLocation && (
          <div
            data-testid="no-location"
            className="pointer-events-none absolute bottom-14 left-3 rounded-md bg-white/95 px-2.5 py-1 text-xs text-slate-500 shadow"
          >
            Location not available for this field
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-white px-3 py-2 text-sm">
        <span className="truncate text-slate-500">
          {doc.originalName}
          {doc.extraction?.legibility === 'poor' && (
            <span className="ml-2 rounded bg-amber-100 px-1.5 text-xs font-semibold text-amber-900">
              poor legibility
            </span>
          )}
        </span>
        <div className="flex items-center gap-1">
          <ZoomButton label="Zoom out" onClick={() => zoomAt(1 / 1.3)}>
            −
          </ZoomButton>
          <span className="w-12 text-center tabular-nums text-slate-600">
            {Math.round(view.zoom * 100)}%
          </span>
          <ZoomButton label="Zoom in" onClick={() => zoomAt(1.3)}>
            +
          </ZoomButton>
          <button
            onClick={() => setView(FIT)}
            className="ml-1 rounded-md px-2 py-1 font-medium text-slate-600 hover:bg-slate-100"
          >
            Fit
          </button>
        </div>
      </div>
    </div>
  );
}

function ZoomButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className="h-8 w-8 rounded-md text-lg font-semibold text-slate-600 hover:bg-slate-100"
    >
      {children}
    </button>
  );
}
