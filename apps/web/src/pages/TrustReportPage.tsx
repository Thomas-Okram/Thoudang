import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/Page';
import { Badge, EmptyState, Icon, Skeleton, Table, Td, Th, Tr } from '../components/ui';
import {
  fetchTrust,
  runLeakScan,
  type FairnessView,
  type Rate,
  type TrustReport,
} from '../lib/api';

const pct = (x: number | null | undefined, digits = 0) =>
  x === null || x === undefined ? '—' : `${(x * 100).toFixed(digits)}%`;

export function TrustReportPage() {
  const { data, isPending } = useQuery({ queryKey: ['trust'], queryFn: fetchTrust });
  return (
    <div className="mx-auto max-w-[1240px] px-7 py-8">
      <PageHeader
        eyebrow="Oversight"
        title="Trust report"
        subtitle="How accurate Thoudang is, whether it treats every community fairly, and the safeguards that keep the officer in charge. Numbers below are live."
        actions={
          <Badge tone="teal" icon="shield" size="lg">
            AI reads · code decides · officer approves
          </Badge>
        }
      />
      {isPending || !data ? (
        <div className="space-y-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <div className="space-y-6">
          <Accuracy e={data.evaluation} />
          <Fairness f={data.fairness} />
          <Safeguards s={data.safeguards} />
          <DataFlow />
          <Section n={5} title="Known limitations">
            <ul className="list-disc space-y-1.5 pl-5 text-ink-soft marker:text-navy-300">
              {data.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({
  n,
  title,
  children,
  aside,
}: {
  n: number;
  title: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section
      className="rounded-card border border-line bg-surface shadow-card"
      aria-labelledby={`s${n}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4">
        <h2 id={`s${n}`} className="flex items-center gap-3 text-xl font-bold tracking-tight text-navy-900">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-navy-900 text-base text-white">
            {n}
          </span>
          {title}
        </h2>
        {aside}
      </div>
      <div className="p-6">{children}</div>
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-slate-50/70 px-4 py-3.5">
      <div className="text-overline font-bold uppercase text-ink-muted">{label}</div>
      <div className="mt-1 text-[1.75rem] font-bold leading-tight tabular-nums text-navy-900">
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-ink-muted">{hint}</div>}
    </div>
  );
}

function RateBars({ rows, label }: { rows: Rate[]; label: string }) {
  return (
    <table className="w-full text-sm">
      <caption className="mb-2 text-left text-overline font-bold uppercase text-ink-muted">
        {label}
      </caption>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-t border-line">
            <td className="w-1/2 py-1.5 pr-3 text-ink-soft">{r.key.replace(/_/g, ' ')}</td>
            <td className="py-1">
              <div className="flex items-center gap-2">
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-teal-deep"
                    style={{ width: `${r.accuracy * 100}%` }}
                  />
                </div>
                <span className="w-12 text-right tabular-nums text-slate-700">
                  {pct(r.accuracy)}
                </span>
                <span className="w-12 text-right text-xs text-ink-muted">n={r.n}</span>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Accuracy({ e }: { e: TrustReport['evaluation'] }) {
  if (!e.available) {
    return (
      <Section n={1} title="Extraction accuracy">
        <EmptyState compact icon="scale" heading="No evaluation has been run yet" body={e.howTo} />
      </Section>
    );
  }
  return (
    <Section
      n={1}
      title="Extraction accuracy"
      aside={
        <span className="text-sm text-ink-muted">
          {e.packets} labelled packets · {e.model} ·{' '}
          {e.labelled ? 'labelled slots' : 'AI classification'} ·{' '}
          {new Date(e.generatedAt).toLocaleString('en-IN', {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat
          label="Field accuracy"
          value={pct(e.fieldAccuracy, 1)}
          hint={`${e.fieldsScored} fields`}
        />
        <Stat label="Document type" value={pct(e.classificationAccuracy)} />
        <Stat label="Status accuracy" value={pct(e.statusAccuracy)} />
        <Stat label="Name verdicts" value={pct(e.nameVerdictAccuracy)} />
        <Stat
          label="Per packet"
          value={`${(e.latency.avgPacketWallMs / 1000).toFixed(1)} s`}
          hint={`${(e.latency.avgApiCallMs / 1000).toFixed(1)} s per AI call`}
        />
        <Stat
          label="Cost / application"
          value={`₹${e.cost.perApplicationInr.toFixed(2)}`}
          hint={`$${e.cost.avgPerPacketUsd} at ₹${e.cost.usdToInr}/$`}
        />
      </div>
      <div className="mt-5 grid gap-6 lg:grid-cols-3">
        <RateBars rows={e.byDocType} label="By document type" />
        <RateBars rows={e.byConfidence} label="By the AI’s stated confidence" />
        <div className="max-h-72 overflow-y-auto">
          <RateBars rows={e.byField} label="By field" />
        </div>
      </div>
    </Section>
  );
}

function FairnessTable({ f }: { f: FairnessView }) {
  return (
    <div>
      <h3 className="text-lg font-semibold text-navy-900">
        {f.label} <span className="font-normal text-ink-muted">· {f.pairs} pairs</span>
      </h3>
      <p className="text-sm text-ink-muted">{f.description}</p>
      <div className="mt-3">
        <Table>
          <thead>
            <tr>
              <Th>Community</Th>
              <Th align="right">Pairs</Th>
              <Th align="right">Auto-decided</Th>
              <Th align="right">Accuracy</Th>
              <Th align="right">Referred to officer</Th>
              <Th align="right">False matches</Th>
              <Th align="right">False non-matches</Th>
            </tr>
          </thead>
          <tbody>
            {[...f.rows, f.overall].map((r) => (
              <Tr
                key={r.community}
                className={r.community === 'All' ? 'bg-slate-50 font-bold' : ''}
              >
                <Td className="font-semibold text-navy-900">{r.community}</Td>
                <Td align="right">{r.pairs}</Td>
                <Td align="right">{r.decided}</Td>
                <Td align="right">
                  <span className="inline-flex items-center gap-2">
                    <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-slate-100 sm:inline-block">
                      <span
                        className="block h-full rounded-full bg-emerald-600"
                        style={{ width: `${r.accuracy * 100}%` }}
                      />
                    </span>
                    {pct(r.accuracy)}
                  </span>
                </Td>
                <Td align="right">
                  {r.referred} ({pct(r.referralRate)})
                </Td>
                <Td align="right" className={r.falseMatches ? 'font-bold text-rose-700' : ''}>
                  {r.falseMatches}
                </Td>
                <Td align="right">{r.falseNonMatches}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  );
}

function Fairness({ f }: { f: TrustReport['fairness'] }) {
  return (
    <Section n={2} title="Name-engine fairness by community">
      <p className="mb-5 max-w-4xl text-[0.95rem] text-ink-soft">
        The name engine is deterministic code (no AI). A <em>false match</em> — two different people
        treated as one — is the dangerous error; ambiguous cases go to an officer instead of being
        guessed.
      </p>
      <div className="space-y-6">
        <FairnessTable f={f.dev} />
        {f.holdout ? (
          <FairnessTable f={f.holdout} />
        ) : (
          <p className="rounded-xl border border-warm-200 bg-warm-50 px-4 py-3 text-sm text-warm-900">
            No held-out set yet. Department staff can add one:{' '}
            <code>npm run fairness -- --holdout ./holdout-pairs.csv</code> (columns
            name_a,name_b,community,expected_same).
          </p>
        )}
      </div>
    </Section>
  );
}

function Check({
  ok,
  title,
  children,
}: {
  ok: boolean | null;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-4 rounded-xl border border-line p-4">
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${ok === null ? 'bg-slate-200 text-slate-700' : ok ? 'bg-emerald-700 text-white' : 'bg-rose-700 text-white'}`}
        role="img"
        aria-label={ok === null ? 'not run' : ok ? 'pass' : 'fail'}
      >
        <Icon name={ok === null ? 'question' : ok ? 'check' : 'alert'} size={18} strokeWidth={2.8} />
      </span>
      <div className="min-w-0">
        <div className="text-[1.02rem] font-semibold text-navy-900">{title}</div>
        <div className="mt-0.5 text-[0.92rem] leading-relaxed text-ink-soft">{children}</div>
      </div>
    </li>
  );
}

function Safeguards({ s }: { s: TrustReport['safeguards'] }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const scan = s.leakScan;
  const runScan = async () => {
    setBusy(true);
    try {
      await runLeakScan();
      await qc.invalidateQueries({ queryKey: ['trust'] });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section n={3} title="Safeguards — with live proof">
      <ul className="grid gap-3 lg:grid-cols-2">
        <Check ok={!s.rejectStatusExists} title="There is no “reject” status">
          The only statuses are {s.statuses.join(', ')}.{' '}
          <a
            href="/api/trust/statuses"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-teal-deep underline"
          >
            See the status list
          </a>
        </Check>
        <Check ok={scan ? scan.clean : null} title="Aadhaar numbers are masked everywhere">
          {scan ? (
            <>
              <strong>{scan.findings.length}</strong> full Aadhaar numbers found in{' '}
              {scan.scanned.dbRows.toLocaleString('en-IN')} database rows, {scan.scanned.logLines}{' '}
              log lines and {scan.scanned.apiResponses} API responses ·{' '}
              {new Date(scan.scannedAt).toLocaleTimeString('en-IN')}
              {scan.findings.length > 0 && (
                <span className="block text-rose-700">
                  Found at: {scan.findings.map((f) => `${f.where} (${f.location})`).join('; ')}
                </span>
              )}
            </>
          ) : (
            'Run the scanner to check the database, logs and live API responses right now.'
          )}
          <button
            onClick={() => void runScan()}
            disabled={busy}
            className="ml-2 mt-1 inline-flex items-center rounded-lg bg-navy-900 px-3 py-1 text-xs font-semibold text-white hover:bg-navy-700 disabled:bg-slate-400"
          >
            {busy ? 'Scanning…' : 'Run leak scan now'}
          </button>
        </Check>
        <Check ok title="Images are redacted on the server">
          {s.imagesRedacted} of {s.imagesTotal} document images carry an Aadhaar number and are only
          ever served with it boxed out (or blurred if its location is unknown). Intake previews are
          blurred until screening.
        </Check>
        <Check ok title="Append-only audit log">
          {s.auditEntries.toLocaleString('en-IN')} entries. The database itself refuses edits and
          deletions of the audit log.
        </Check>
        <Check ok={s.approvalsByDswoOnly} title="Only the DSWO can approve">
          {s.approvals
            ? `${s.approvals} approval${s.approvals === 1 ? '' : 's'} so far, ${s.approvalsByDswoOnly ? 'all by a DSWO' : 'NOT all by a DSWO'}.`
            : 'No approvals yet.'}{' '}
          The server refuses approval from any other role (HTTP 403) — enforced, not just hidden in
          the UI.
        </Check>
        <Check ok title="Officers can and do override the machine">
          {s.flagsDecidedByOfficers
            ? `${s.flagsDecidedByOfficers} flags decided by officers on live cases · override rate ${pct(s.overrideRate)}.`
            : 'No officer decisions on live cases yet.'}{' '}
          Every override needs a reason and is audited.
        </Check>
        <Check ok={s.notices.aiCalls === 0} title="AI never writes citizen-facing Manipuri">
          Notices are filled from {s.notices.templates} templates ({s.notices.reviewed} reviewed by
          a native speaker). 0 AI calls per notice. Meetei Mayek comes from a deterministic
          transliterator.
        </Check>
        <Check ok title="Synthetic data only">
          {s.syntheticOnly.liveCases} live SPECIMEN cases · {s.syntheticOnly.historicalSynthetic}{' '}
          synthetic historical cases for the dashboard. No real applicant data.
        </Check>
      </ul>
    </Section>
  );
}

function DataFlow() {
  const box = (
    x: number,
    y: number,
    w: number,
    title: string,
    sub: string,
    tone: 'navy' | 'teal' | 'slate',
  ) => {
    const fill = tone === 'navy' ? '#0a1b33' : tone === 'teal' ? '#0b7a6e' : '#f1f5f9';
    const ink = tone === 'slate' ? '#0a1b33' : '#ffffff';
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={w}
          height={74}
          rx={10}
          fill={fill}
          stroke={tone === 'slate' ? '#cbd5e1' : 'none'}
        />
        <text
          x={x + w / 2}
          y={y + 31}
          textAnchor="middle"
          fontSize={15}
          fontWeight={700}
          fill={ink}
        >
          {title}
        </text>
        <text x={x + w / 2} y={y + 53} textAnchor="middle" fontSize={12} fill={ink} opacity={0.85}>
          {sub}
        </text>
      </g>
    );
  };
  const arrow = (x1: number, x2: number, y: number, label?: string) => (
    <g>
      <line
        x1={x1}
        y1={y}
        x2={x2 - 6}
        y2={y}
        stroke="#64748b"
        strokeWidth={2}
        markerEnd="url(#arrow)"
      />
      {label && (
        <text x={(x1 + x2) / 2} y={y - 8} textAnchor="middle" fontSize={11} fill="#64748b">
          {label}
        </text>
      )}
    </g>
  );
  return (
    <Section n={4} title="Where the data goes">
      <svg
        viewBox="0 0 1180 260"
        className="w-full"
        role="img"
        aria-label="Data flow: phone or scanner to the Thoudang server, which sends images to Claude for extraction and receives masked text back; deterministic rules and the name engine run on the server; the officer decides; the notice is built from templates."
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="8"
            markerHeight="8"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="#64748b" />
          </marker>
        </defs>
        <rect
          x={150}
          y={14}
          width={830}
          height={150}
          rx={14}
          fill="none"
          stroke="#0f9e8e"
          strokeDasharray="6 5"
        />
        <text x={565} y={34} textAnchor="middle" fontSize={12} fontWeight={700} fill="#0b7a6e">
          Thoudang server — State Data Centre in production · officer’s laptop in this prototype
        </text>
        {box(10, 60, 120, 'Phone / scan', 'packet photos', 'slate')}
        {arrow(130, 170, 97)}
        {box(170, 60, 170, 'Store + redact', 'images stay on server', 'navy')}
        {arrow(340, 400, 97)}
        {box(400, 60, 220, 'Rules + name engine', 'deterministic · no AI', 'navy')}
        {arrow(620, 680, 97)}
        {box(680, 60, 130, 'Officer', 'decides · audited', 'teal')}
        {arrow(810, 850, 97)}
        {box(850, 60, 120, 'Notice', 'templates · 0 AI', 'navy')}
        {arrow(970, 1010, 97)}
        {box(1010, 60, 165, 'Citizen', 'print · WhatsApp · QR', 'slate')}
        {/* Claude extraction, outside the server */}
        <line
          x1={255}
          y1={134}
          x2={255}
          y2={192}
          stroke="#64748b"
          strokeWidth={2}
          markerEnd="url(#arrow)"
        />
        <line
          x1={300}
          y1={198}
          x2={300}
          y2={140}
          stroke="#64748b"
          strokeWidth={2}
          markerEnd="url(#arrow)"
        />
        <text x={248} y={156} textAnchor="end" fontSize={11} fill="#64748b">
          images only
        </text>
        <text x={312} y={184} fontSize={11} fill="#64748b">
          text, Aadhaar masked on arrival
        </text>
        {box(170, 186, 260, 'Claude extraction', 'reads the documents — never decides', 'teal')}
        <text x={450} y={214} fontSize={12} fill="#0a1b33">
          <tspan fontWeight={700}>Production:</tspan> Claude via Amazon Bedrock India region
          (Mumbai/Hyderabad) or an on-prem model.
        </text>
        <text x={450} y={234} fontSize={12} fill="#0a1b33">
          <tspan fontWeight={700}>Prototype:</tspan> Anthropic API with synthetic SPECIMEN data;
          results kept only in the local database.
        </text>
      </svg>
    </Section>
  );
}
