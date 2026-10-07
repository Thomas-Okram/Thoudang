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
import { DOC_LABEL, prettyField } from '../../lib/labels';
import { Icon, type IconName } from '../ui/Icon';

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
        className="flex gap-2 overflow-x-auto border-b border-line bg-white px-3 py-2.5"
      >
        {documents.map((d) => {
          const active = d.id === doc?.id;
          return (
            <button
              key={d.id}
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(d.id)}
              className={`group flex shrink-0 items-center gap-2.5 rounded-xl border py-1.5 pl-1.5 pr-3 text-left text-sm transition ${
                active
                  ? 'border-navy-900 bg-navy-900 font-semibold text-white shadow-raised'
                  : 'border-line bg-white text-ink-soft hover:border-navy-300 hover:text-navy-900'
              }`}
            >
              <img
                src={d.thumbUrl}
                alt=""
                className={`h-10 w-10 rounded-lg border object-cover ${active ? 'border-white/30' : 'border-line'} bg-white`}
                loading="lazy"
              />
              <span className="flex flex-col leading-tight">
                <span>{d.detectedType ? DOC_LABEL[d.detectedType] : 'Unidentified'}</span>
                <span
                  className={`text-[11px] font-normal ${active ? 'text-slate-300' : 'text-ink-muted'} ${d.state === 'FAILED' || d.typeSource === 'officer' ? '' : 'dev-noise'}`}
                >
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
    <div className="relative flex min-h-0 flex-1 flex-col bg-[#e7ebf1] bg-[radial-gradient(#d3dae4_1px,transparent_1px)] [background-size:18px_18px]">
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
              className="block w-full select-none shadow-[0_8px_30px_-8px_rgb(10_27_51/0.35)]"
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
                <>
                  <defs>
                    <mask id={`spot-${doc.id}`}>
                      <rect width={doc.width} height={doc.height} fill="white" />
                      <rect
                        x={bbox[0] - 6}
                        y={bbox[1] - 6}
                        width={bbox[2] - bbox[0] + 12}
                        height={bbox[3] - bbox[1] + 12}
                        rx={6}
                        fill="black"
                      />
                    </mask>
                  </defs>
                  {/* Spotlight: dim everything except the field, so it reads from the back row. */}
                  <rect
                    width={doc.width}
                    height={doc.height}
                    fill="#0a1b33"
                    fillOpacity={highlight?.mode === 'click' ? 0.5 : 0.28}
                    mask={`url(#spot-${doc.id})`}
                    className="animate-fade"
                  />
                  <rect
                    x={bbox[0] - 6}
                    y={bbox[1] - 6}
                    width={bbox[2] - bbox[0] + 12}
                    height={bbox[3] - bbox[1] + 12}
                    rx={6}
                    fill="none"
                    stroke="#2dd4bf"
                    strokeOpacity={0.45}
                    strokeWidth={14}
                    vectorEffect="non-scaling-stroke"
                    className="animate-pulse-ring"
                  />
                  <rect
                    data-testid="bbox-highlight"
                    x={bbox[0] - 6}
                    y={bbox[1] - 6}
                    width={bbox[2] - bbox[0] + 12}
                    height={bbox[3] - bbox[1] + 12}
                    rx={6}
                    fill="rgb(45 212 191 / 0.12)"
                    stroke="#14b8a6"
                    strokeWidth={4}
                    vectorEffect="non-scaling-stroke"
                  />
                </>
              )}
            </svg>
            {bbox && highlight?.field && (
              <div
                className="pointer-events-none absolute"
                style={{
                  left: `${((bbox[0] - 6) / doc.width) * 100}%`,
                  top: `${((bbox[1] - 6) / doc.height) * 100}%`,
                }}
              >
                <span
                  className="absolute bottom-1.5 left-0 block origin-bottom-left"
                  style={{ transform: `scale(${1 / view.zoom})` }}
                >
                  <span className="flex origin-bottom-left animate-pop items-center gap-1.5 whitespace-nowrap rounded-lg bg-teal-deep px-3 py-1 text-base font-bold text-white shadow-raised">
                    <Icon name="eye" size={14} strokeWidth={2.4} />
                    {prettyField(highlight.field)}
                  </span>
                </span>
              </div>
            )}
          </div>
        )}

        {doc.redaction !== 'none' && (
          <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-navy-900/90 px-3 py-1.5 text-xs font-semibold text-white shadow-raised backdrop-blur">
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 text-teal-soft" fill="currentColor" aria-hidden>
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
            className="pointer-events-none absolute bottom-4 left-3 flex items-center gap-1.5 rounded-lg bg-white/95 px-3 py-1.5 text-sm font-medium text-ink-soft shadow-raised"
          >
            Location not available for this field
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-line bg-white px-3 py-2 text-sm">
        <span className="flex min-w-0 items-center truncate text-ink-muted">
          <span className="dev-noise truncate">{doc.originalName}</span>
          {doc.extraction?.legibility === 'poor' && (
            <span className="ml-2 rounded-full bg-warm-100 px-2 py-0.5 text-xs font-semibold text-warm-900">
              poor legibility
            </span>
          )}
        </span>
        <div className="flex items-center gap-1 rounded-xl border border-line bg-slate-50 p-0.5">
          <ZoomButton label="Zoom out" icon="zoomOut" onClick={() => zoomAt(1 / 1.3)} />
          <span className="w-12 text-center text-[0.85rem] font-semibold tabular-nums text-ink-soft">
            {Math.round(view.zoom * 100)}%
          </span>
          <ZoomButton label="Zoom in" icon="zoomIn" onClick={() => zoomAt(1.3)} />
          <button
            onClick={() => setView(FIT)}
            className="ml-0.5 flex h-8 items-center gap-1 rounded-lg px-2 font-semibold text-ink-soft hover:bg-white hover:text-navy-900"
          >
            <Icon name="fit" size={15} />
            Fit
          </button>
        </div>
      </div>
    </div>
  );
}

function ZoomButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: IconName;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft hover:bg-white hover:text-navy-900"
    >
      <Icon name={icon} size={17} />
    </button>
  );
}
