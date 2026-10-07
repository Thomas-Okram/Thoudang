import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { bengaliToMeeteiMayek, flagTitle } from '@thoudang/core';
import { fetchTemplates, patchTemplate, type TemplateEntry } from '../lib/api';
import { useOfficer } from '../lib/officer';
import { Page } from '../components/Page';
import { Badge, Icon, Skeleton } from '../components/ui';

const BLOCK_LABEL: Record<string, string> = {
  title: 'Title',
  greeting: 'Greeting',
  intro: 'Introduction',
  bring: 'Where and by when',
  not_rejection: '“This is not a rejection”',
  final_decision: 'Final decision rests with the department',
  helpline: 'Helpline',
  signoff: 'Sign-off',
};

export function TemplatesPage() {
  const { data, isPending } = useQuery({ queryKey: ['templates'], queryFn: fetchTemplates });
  const { officer, can } = useOfficer();
  const canEdit = Boolean(officer) && can('edit_templates');
  return (
    <Page
      title="Notice templates"
      eyebrow="Administration"
      width="max-w-[1320px]"
      subtitle="Review the citizen-facing wording in all three scripts. Every edit is audited and saved to the template file."
    >
      {data && (
        <div className="mb-5 flex flex-wrap items-center gap-4 rounded-card border border-line bg-white px-6 py-4 shadow-card">
          <div className="text-[2rem] font-bold leading-none tabular-nums text-navy-900">
            {data.summary.reviewed} / {data.summary.total}
          </div>
          <div className="text-sm text-ink-soft">
            entries reviewed by a native speaker · {data.summary.manualMeetei} with hand-written
            Meetei Mayek
          </div>
          <div className="h-2.5 min-w-48 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-teal-deep"
              style={{
                width: `${(data.summary.reviewed / Math.max(1, data.summary.total)) * 100}%`,
              }}
            />
          </div>
          {!canEdit && (
            <span className="flex items-center gap-1.5 text-sm font-medium text-warm-700">
              <Icon name="lock" size={15} />
              Choose an officer (top right) to edit.
            </span>
          )}
        </div>
      )}
      <p className="mb-5 text-[0.92rem] text-ink-soft">
        Placeholders such as <code>{'{document}'}</code>, <code>{'{value_a}'}</code>,{' '}
        <code>{'{office}'}</code> are filled from the case. Leave Meetei Mayek empty to use the
        automatic transliteration of the Bengali-script text.
      </p>
      {isPending && <Skeleton className="h-96" />}
      <div className="space-y-4">
        {data?.blocks.map((b) => (
          <TemplateRow
            key={`b-${b.id}`}
            kind="block"
            id={b.id}
            title={BLOCK_LABEL[b.id] ?? b.id}
            entry={b}
            canEdit={canEdit}
          />
        ))}
        {data?.templates.map((t) => (
          <TemplateRow
            key={`t-${t.code}`}
            kind="template"
            id={t.code}
            title={t.code === 'GENERIC' ? 'Any other correction (fallback)' : flagTitle(t.code)}
            entry={t}
            canEdit={canEdit}
          />
        ))}
      </div>
    </Page>
  );
}

function TemplateRow({
  kind,
  id,
  title,
  entry,
  canEdit,
}: {
  kind: 'template' | 'block';
  id: string;
  title: string;
  entry: TemplateEntry;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(entry);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const dirty =
    draft.en !== entry.en ||
    draft.mni_beng !== entry.mni_beng ||
    draft.mni_mtei !== entry.mni_mtei ||
    draft.reviewed !== entry.reviewed;
  const auto = bengaliToMeeteiMayek(draft.mni_beng);

  const save = async () => {
    setState('saving');
    try {
      await patchTemplate(kind, id, draft);
      setState('saved');
      void qc.invalidateQueries({ queryKey: ['templates'] });
      void qc.invalidateQueries({ queryKey: ['notice'] });
    } catch {
      setState('error');
    }
  };

  const area = (
    key: 'en' | 'mni_beng' | 'mni_mtei',
    label: string,
    className: string,
    placeholder?: string,
  ) => (
    <label className="block">
      <span className="text-overline font-bold uppercase text-ink-muted">{label}</span>
      <textarea
        value={draft[key]}
        readOnly={!canEdit}
        placeholder={placeholder}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        rows={4}
        className={`mt-1.5 w-full rounded-control border border-line-strong px-3 py-2 text-[15px] leading-relaxed focus:border-teal-accent focus:outline-none focus:ring-2 focus:ring-teal-accent/40 ${className} ${canEdit ? 'bg-white' : 'bg-slate-50 text-ink-soft'}`}
      />
    </label>
  );

  return (
    <section
      className={`rounded-card border border-l-4 bg-white p-5 shadow-card ${entry.reviewed ? 'border-line border-l-emerald-600' : 'border-line border-l-warm-400'}`}
      data-testid={`template-${id}`}
    >
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="font-bold text-navy-900">{title}</h2>
        <code className="dev-noise text-xs text-ink-muted">{id}</code>
        {entry.reviewed ? (
          <Badge tone="success" icon="check" size="sm">
            Reviewed
          </Badge>
        ) : (
          <Badge tone="warn" size="sm">
            Pending review
          </Badge>
        )}
        {!draft.mni_mtei.trim() && (
          <Badge tone="neutral" size="sm">
            Meetei Mayek: auto-transliterated
          </Badge>
        )}
        <label className="ml-auto flex items-center gap-2 text-sm font-semibold text-navy-900">
          <input
            type="checkbox"
            checked={draft.reviewed}
            disabled={!canEdit}
            onChange={(e) => setDraft({ ...draft, reviewed: e.target.checked })}
            className="h-4 w-4 accent-teal-deep"
          />
          Reviewed
        </label>
        <button
          onClick={() => void save()}
          disabled={!canEdit || !dirty || state === 'saving'}
          className="rounded-lg bg-navy-900 px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-navy-700 disabled:bg-slate-300 disabled:text-slate-600"
        >
          {state === 'saving' ? 'Saving…' : 'Save'}
        </button>
        {state === 'saved' && !dirty && (
          <span className="text-xs font-medium text-emerald-700">Saved · audited</span>
        )}
        {state === 'error' && <span className="text-xs text-rose-700">Could not save</span>}
      </header>
      <div className="grid gap-3 lg:grid-cols-3">
        {area('en', 'English', '')}
        {area('mni_mtei', 'Meetei Mayek', 'font-mtei', auto)}
        {area('mni_beng', 'Bengali script', 'font-beng')}
      </div>
    </section>
  );
}
