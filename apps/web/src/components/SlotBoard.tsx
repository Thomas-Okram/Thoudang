import { useRef, useState, type DragEvent } from 'react';
import type { SlotType, UploadSession } from '../lib/api';

export const SLOTS: { type: SlotType | null; label: string; hint: string }[] = [
  { type: 'application_form', label: 'Application form', hint: 'All pages of the MOAPS form' },
  { type: 'aadhaar', label: 'Aadhaar', hint: 'Front (and back)' },
  { type: 'bank_passbook', label: 'Bank passbook', hint: 'First page / cancelled cheque' },
  { type: 'epic', label: 'Voter ID', hint: 'Optional' },
  { type: null, label: 'Other / unsorted', hint: 'The AI will identify these' },
];

const FILE_MIME = 'application/x-thoudang-file';
const isImage = (f: File) =>
  f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name);

export function SlotBoard({
  session,
  busy,
  onUpload,
  onMove,
  onRemove,
}: {
  session: UploadSession | null;
  busy: boolean;
  onUpload: (files: File[], type: SlotType | null) => void;
  onMove: (fileId: string, type: SlotType | null) => void;
  onRemove: (fileId: string) => void;
}) {
  const files = session?.files ?? [];
  const full = files.length >= (session?.maxFiles ?? 6);
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-5" data-testid="slot-board">
      {SLOTS.map((slot) => (
        <Slot
          key={slot.label}
          slot={slot}
          files={files.filter((f) => (f.docType ?? null) === slot.type)}
          full={full}
          busy={busy}
          onUpload={(list) => onUpload(list, slot.type)}
          onMoveHere={(id) => onMove(id, slot.type)}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}

function Slot({
  slot,
  files,
  full,
  busy,
  onUpload,
  onMoveHere,
  onRemove,
}: {
  slot: (typeof SLOTS)[number];
  files: UploadSession['files'];
  full: boolean;
  busy: boolean;
  onUpload: (files: File[]) => void;
  onMoveHere: (fileId: string) => void;
  onRemove: (fileId: string) => void;
}) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const labelled = slot.type !== null;

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const moved = e.dataTransfer.getData(FILE_MIME);
    if (moved) return onMoveHere(moved);
    const list = [...e.dataTransfer.files].filter(isImage);
    if (list.length) onUpload(list);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      data-testid={`slot-${slot.type ?? 'unsorted'}`}
      className={`flex min-h-48 flex-col rounded-xl border-2 border-dashed p-3 transition ${
        over
          ? 'border-teal-accent bg-teal-soft/40'
          : files.length
            ? 'border-teal-accent/40 bg-white'
            : 'border-slate-300 bg-slate-50/60'
      } ${labelled ? '' : 'xl:border-slate-400/70'}`}
    >
      <div className="flex items-start justify-between gap-1">
        <div>
          <div className="font-semibold text-navy-900">{slot.label}</div>
          <div className="text-xs text-slate-500">{slot.hint}</div>
        </div>
        {labelled && files.length > 0 && (
          <span
            className="rounded bg-teal-soft px-1.5 text-[10px] font-bold uppercase text-teal-deep"
            title="Classification skipped — faster"
          >
            fast
          </span>
        )}
      </div>

      <ul className="mt-2 space-y-2">
        {files.map((f) => (
          <li
            key={f.id}
            draggable
            onDragStart={(e) => e.dataTransfer.setData(FILE_MIME, f.id)}
            className="group relative cursor-grab overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm active:cursor-grabbing"
          >
            <img
              src={f.thumbUrl}
              alt={f.originalName}
              className="h-24 w-full bg-slate-50 object-contain"
            />
            <div className="flex items-center justify-between gap-1 border-t border-slate-100 px-2 py-1 text-[11px]">
              <span className="truncate text-slate-600">{f.originalName}</span>
              {f.from === 'phone' && (
                <span className="rounded bg-navy-900 px-1 font-semibold text-white">phone</span>
              )}
            </div>
            <button
              onClick={() => onRemove(f.id)}
              className="absolute right-1 top-1 rounded-full bg-white/95 px-1.5 text-sm font-bold leading-5 text-slate-500 shadow hover:text-rose-600"
              aria-label={`Remove ${f.originalName}`}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <button
        onClick={() => input.current?.click()}
        disabled={full || busy}
        className="mt-auto pt-3 text-left text-sm font-semibold text-teal-deep hover:underline disabled:text-slate-400 disabled:no-underline"
      >
        {files.length ? '+ Add another' : 'Drop here or browse'}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        hidden
        onChange={(e) => {
          const list = [...(e.target.files ?? [])].filter(isImage);
          if (list.length) onUpload(list);
          e.target.value = '';
        }}
      />
    </div>
  );
}
