import { useState } from 'react';
import type { CaseDocument, ExtractedValue, Reason } from '../../lib/api';
import { DOC_LABEL, prettyField } from '../../lib/labels';
import { Icon } from '../ui/Icon';

const CONF_DOT: Record<ExtractedValue['confidence'], string> = {
  high: 'bg-emerald-500',
  medium: 'bg-warm-400',
  low: 'bg-rose-500',
};

export function FieldsTable({
  documents,
  canEdit,
  reasons,
  onHover,
  onFocusField,
  onEdit,
}: {
  documents: CaseDocument[];
  canEdit: boolean;
  reasons: Reason[];
  onHover: (target: { documentId: string; field: string } | null) => void;
  onFocusField: (target: { documentId: string; field: string }) => void;
  onEdit: (args: {
    documentId: string;
    field: string;
    value: string | null;
    reasonCode: string;
    reasonText?: string;
  }) => Promise<void>;
}) {
  const [editing, setEditing] = useState<{ documentId: string; field: string } | null>(null);
  const withFields = documents.filter((d) => d.extraction);

  return (
    <section
      aria-labelledby="fields-title"
      className="overflow-hidden rounded-card border border-line bg-surface shadow-card"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4">
        <h2 id="fields-title" className="flex items-center gap-2.5 text-lg font-bold text-navy-900">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-navy-50 text-navy-700">
            <Icon name="template" size={19} />
          </span>
          Extracted fields
        </h2>
        <span className="flex items-center gap-3 text-xs font-medium text-ink-muted">
          <span>AI confidence:</span>
          {(['high', 'medium', 'low'] as const).map((c) => (
            <span key={c} className="flex items-center gap-1">
              <span className={`h-2 w-2 rounded-full ${CONF_DOT[c]}`} /> {c}
            </span>
          ))}
        </span>
      </header>
      {!withFields.length && (
        <p className="px-6 py-4 text-sm text-ink-muted">
          No fields could be read from these documents — review the images manually.
        </p>
      )}
      {withFields.map((d) => (
        <div key={d.id} className="border-b border-line last:border-0">
          <h3 className="flex items-center justify-between gap-3 bg-slate-50 px-6 py-2 text-overline font-bold uppercase text-ink-muted">
            <span>
              {d.detectedType ? DOC_LABEL[d.detectedType] : d.originalName}
              {d.model?.startsWith('fixture') && (
                <span
                  className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 font-bold text-amber-900"
                  title="Seeded from truth.json by npm run dev:fixtures"
                >
                  Fixture data (no AI)
                </span>
              )}
            </span>
            {d.extraction?.notes && (
              <span
                className="max-w-[60%] truncate font-normal normal-case tracking-normal text-ink-muted"
                title={d.extraction.notes}
              >
                Note: {d.extraction.notes}
              </span>
            )}
          </h3>
          <table className="w-full text-[0.92rem]">
            <tbody>
              {Object.entries(d.extraction!.fields).map(([name, v]) => {
                const isEditing = editing?.documentId === d.id && editing.field === name;
                const low = v.confidence === 'low' || v.status === 'unreadable';
                return isEditing ? (
                  <EditRow
                    key={name}
                    field={name}
                    current={v.value}
                    reasons={reasons}
                    onCancel={() => setEditing(null)}
                    onSave={async (value, reasonCode, reasonText) => {
                      await onEdit({
                        documentId: d.id,
                        field: name,
                        value,
                        reasonCode,
                        reasonText,
                      });
                      setEditing(null);
                    }}
                  />
                ) : (
                  <tr
                    key={name}
                    data-testid={`field-${name}`}
                    className={`group cursor-pointer border-t border-line first:border-0 ${low ? 'bg-warm-50/70' : ''} transition-colors hover:bg-teal-wash`}
                    onMouseEnter={() => onHover({ documentId: d.id, field: name })}
                    onMouseLeave={() => onHover(null)}
                    onClick={() => onFocusField({ documentId: d.id, field: name })}
                  >
                    <td className="w-48 py-2 pl-6 pr-3 text-ink-muted">{prettyField(name)}</td>
                    <td className="py-2 pr-2 font-semibold text-navy-900">
                      {v.value ?? (
                        <span className="font-normal italic text-ink-muted">{v.status}</span>
                      )}
                      {v.editedBy && (
                        <span className="ml-2 rounded bg-navy-900/5 px-1.5 text-[11px] font-semibold text-navy-700">
                          edited by {v.editedBy}
                        </span>
                      )}
                    </td>
                    <td className="w-8 py-2">
                      <span
                        title={`${v.confidence} confidence`}
                        className={`inline-block h-2.5 w-2.5 rounded-full ${CONF_DOT[v.confidence]}`}
                      />
                    </td>
                    <td className="w-20 py-2 pr-5 text-right">
                      {name === 'aadhaar_number' ? (
                        <span
                          className="inline-flex items-center gap-1 text-xs text-ink-muted"
                          title="Only the masked number is stored"
                        >
                          masked
                        </span>
                      ) : (
                        canEdit && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditing({ documentId: d.id, field: name });
                            }}
                            className="rounded-md px-2 py-0.5 text-xs font-semibold text-teal-deep opacity-0 transition hover:bg-white group-hover:opacity-100 focus:opacity-100"
                          >
                            Edit
                          </button>
                        )
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}

function EditRow({
  field,
  current,
  reasons,
  onCancel,
  onSave,
}: {
  field: string;
  current: string | null;
  reasons: Reason[];
  onCancel: () => void;
  onSave: (value: string | null, reasonCode: string, reasonText?: string) => Promise<void>;
}) {
  const [value, setValue] = useState(current ?? '');
  const [code, setCode] = useState(reasons[0]?.code ?? '');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid =
    code && (code !== 'other' || text.trim().length >= 3) && value.trim() !== (current ?? '');

  return (
    <tr className="border-t border-teal-accent/40 bg-teal-wash">
      <td colSpan={4} className="px-6 py-4">
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!valid) return;
            setBusy(true);
            setError(null);
            try {
              await onSave(value.trim() || null, code, text.trim() || undefined);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not save');
              setBusy(false);
            }
          }}
        >
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            {prettyField(field)}
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && onCancel()}
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium normal-case tracking-normal text-navy-900 focus:outline-none focus:ring-2 focus:ring-teal-accent"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <select
              value={code}
              onChange={(e) => setCode(e.target.value)}
              aria-label="Reason"
              className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
            >
              {reasons.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </select>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={code === 'other' ? 'Explain (required)' : 'Note (optional)'}
              className="min-w-40 flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm"
            />
          </div>
          {error && <p className="text-sm text-rose-700">{error}</p>}
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-500">
              Saving re-runs every rule instantly — no new AI call.
            </span>
            <span className="flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-md px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!valid || busy}
                className="rounded-md bg-navy-900 px-3 py-1.5 text-sm font-semibold text-white hover:bg-navy-700 disabled:bg-slate-300 disabled:text-slate-600"
              >
                {busy ? 'Re-checking…' : 'Save & re-check'}
              </button>
            </span>
          </div>
        </form>
      </td>
    </tr>
  );
}
