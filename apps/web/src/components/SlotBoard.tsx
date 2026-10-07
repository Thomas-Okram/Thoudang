import { useRef, useState, type DragEvent } from 'react';
import type { SlotType, UploadSession } from '../lib/api';
import { Icon, type IconName } from './ui/Icon';

export const SLOTS: {
  type: SlotType | null;
  label: string;
  hint: string;
  icon: IconName;
  required?: boolean;
}[] = [
  {
    type: 'application_form',
    label: 'Application form',
    hint: 'All pages of the MOAPS form',
    icon: 'template',
    required: true,
  },
  { type: 'aadhaar', label: 'Aadhaar', hint: 'Front (and back)', icon: 'user', required: true },
  {
    type: 'bank_passbook',
    label: 'Bank passbook',
    hint: 'First page / cancelled cheque',
    icon: 'building',
    required: true,
  },
  { type: 'epic', label: 'Voter ID', hint: 'Optional', icon: 'users' },
  { type: null, label: 'Other / unsorted', hint: 'The AI will identify these', icon: 'sparkle' },
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
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-5" data-testid="slot-board">
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
  const filled = files.length > 0;

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
      className={`relative flex min-h-56 flex-col rounded-2xl border-2 p-3.5 transition-all duration-200 ${
        over
          ? 'scale-[1.02] border-solid border-teal-accent bg-teal-wash shadow-raised'
          : filled
            ? 'border-solid border-teal-accent/50 bg-white shadow-card'
            : labelled
              ? 'border-dashed border-line-strong bg-white/70 hover:border-navy-300 hover:bg-white'
              : 'border-dashed border-navy-200 bg-navy-50/40 hover:border-navy-300'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
            filled ? 'bg-teal-deep text-white' : 'bg-navy-50 text-navy-600'
          }`}
        >
          <Icon name={filled ? 'check' : slot.icon} size={20} strokeWidth={filled ? 2.8 : 1.8} />
        </span>
        {slot.required && !filled && (
          <span className="rounded-full bg-warm-50 px-2 py-0.5 text-[0.66rem] font-bold uppercase tracking-wide text-warm-900 ring-1 ring-inset ring-warm-400/40">
            Required
          </span>
        )}
        {labelled && filled && (
          <span
            className="rounded-full bg-teal-wash px-2 py-0.5 text-[0.66rem] font-bold uppercase tracking-wide text-teal-darker ring-1 ring-inset ring-teal-accent/30"
            title="Classification skipped — faster"
          >
            fast lane
          </span>
        )}
      </div>
      <div className="mt-2.5 font-semibold leading-tight text-navy-900">{slot.label}</div>
      <div className="mt-0.5 text-xs leading-snug text-ink-muted">{slot.hint}</div>

      <ul className="mt-2.5 space-y-2">
        {files.map((f) => (
          <li
            key={f.id}
            draggable
            onDragStart={(e) => e.dataTransfer.setData(FILE_MIME, f.id)}
            className="group relative animate-pop cursor-grab overflow-hidden rounded-xl border border-line bg-white shadow-card active:cursor-grabbing"
          >
            <img
              src={f.thumbUrl}
              alt={f.originalName}
              className="h-24 w-full bg-slate-50 object-contain"
            />
            {f.docType !== 'bank_passbook' && f.docType !== 'epic' && (
              <span
                className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-navy-900/85 px-2 py-0.5 text-[10px] font-semibold text-white"
                title="Blurred until the Aadhaar number is located and masked"
              >
                <Icon name="lock" size={10} strokeWidth={2.4} />
                preview blurred
              </span>
            )}
            <div className="flex items-center justify-between gap-1 border-t border-line px-2 py-1 text-[11px]">
              <span className="truncate text-ink-muted">{f.originalName}</span>
              {f.from === 'phone' && (
                <span className="flex items-center gap-0.5 rounded bg-navy-900 px-1.5 font-semibold text-white">
                  <Icon name="phone" size={10} strokeWidth={2.2} />
                  phone
                </span>
              )}
            </div>
            <button
              onClick={() => onRemove(f.id)}
              className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-white/95 text-ink-muted shadow hover:bg-rose-50 hover:text-rose-700"
              aria-label={`Remove ${f.originalName}`}
            >
              <Icon name="x" size={14} strokeWidth={2.4} />
            </button>
          </li>
        ))}
      </ul>

      <button
        onClick={() => input.current?.click()}
        disabled={full || busy}
        className={`mt-auto flex items-center justify-center gap-1.5 rounded-xl border border-transparent py-2 text-sm font-semibold transition disabled:text-slate-400 ${
          filled
            ? 'text-teal-deep hover:bg-teal-wash'
            : 'mt-4 border-line bg-white text-navy-800 hover:border-navy-300 hover:bg-navy-50'
        }`}
      >
        <Icon name={filled ? 'plus' : 'upload'} size={16} />
        {files.length ? 'Add another' : 'Drop here or browse'}
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
