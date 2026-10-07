import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { auditLog } from '../src/db/schema.js';
import type { ExtractableType } from '../src/extraction/schemas.js';
import { FakeVision, makeImage, packetVision, PACKET, wireDoc } from './helpers.js';
import { setupApp, type TestApp } from './setup.js';

let t: TestApp;
afterEach(() => t?.cleanup());

const DSWO = 'dswo-imphal-west';
const DA = 'da-imphal-west';
let seed = 0;

/** One fake Claude per app; `current` holds the packet the next upload should "contain". */
let current: Partial<Record<ExtractableType, Record<string, string | null>>> = {};
function fakeClaude() {
  return new FakeVision((req) => {
    const label = req.label ?? '';
    const type: ExtractableType = label.includes('form')
      ? 'application_form'
      : label.includes('aadhaar')
        ? 'aadhaar'
        : 'bank_passbook';
    if (req.stage === 'classify')
      return { document_type: type, confidence: 'high', legibility: 'good', reason: 't' };
    return wireDoc(type, { ...PACKET[type], ...(current[type] ?? {}) });
  });
}

async function screened(
  overrides: Partial<Record<ExtractableType, Record<string, string | null>>> = {},
  existing?: TestApp,
) {
  current = overrides;
  const vision = existing ? (existing as TestApp & { vision: FakeVision }).vision : fakeClaude();
  if (!existing) {
    t = setupApp(vision);
    (t as TestApp & { vision: FakeVision }).vision = vision;
  }
  let req = request(t.app).post('/api/cases');
  seed += 1;
  for (const [name, type] of [
    ['form.jpg', 'application_form'],
    ['aadhaar.jpg', 'aadhaar'],
    ['passbook.jpg', 'bank_passbook'],
  ] as const) {
    req = req
      .field('types', type)
      .attach('files', await makeImage('#f5f5f5', 600, 400, `${seed}${name}`), {
        filename: name,
        contentType: 'image/jpeg',
      });
  }
  const res = await req;
  await t.pipeline.whenIdle();
  return { id: res.body.caseId as string, vision };
}

const as = (officer: string | null) => (r: request.Test) =>
  officer ? r.set('X-Officer-Id', officer) : r;
const flagOf = (detail: { flags: { id: string; code: string }[] }, code: string) =>
  detail.flags.find((f) => f.code === code)!;

describe('roles and approval', () => {
  it('only the DSWO can approve; the Dealing Assistant gets 403; no officer gets 401', async () => {
    const { id } = await screened();
    expect((await request(t.app).post(`/api/cases/${id}/approve`)).status).toBe(401);
    const da = await as(DA)(request(t.app).post(`/api/cases/${id}/approve`));
    expect(da.status).toBe(403);
    expect(da.body.error).toMatch(/Dealing Assistant is not allowed to approve/);
    const ok = await as(DSWO)(request(t.app).post(`/api/cases/${id}/approve`));
    expect(ok.status).toBe(200);
    expect(ok.body.case.status).toBe('APPROVED_BY_OFFICER');
    expect(
      t.handle.db
        .select()
        .from(auditLog)
        .all()
        .some((a) => a.action === 'OFFICER_APPROVE' && a.actor === `officer:${DSWO}`),
    ).toBe(true);
  });

  it('approval is blocked while a critical flag is open or accepted; an override unblocks it', async () => {
    const { id } = await screened({ bank_passbook: { ifsc: 'BAD' } });
    const detail = (await request(t.app).get(`/api/cases/${id}`).set('X-Officer-Id', DSWO)).body;
    expect(detail.actions.canApprove).toBe(false);
    const blocked = await as(DSWO)(request(t.app).post(`/api/cases/${id}/approve`));
    expect(blocked.status).toBe(409);
    expect(blocked.body.details.map((d: { code: string }) => d.code)).toContain('IFSC_INVALID');

    const ifsc = flagOf(detail, 'IFSC_INVALID');
    await as(DA)(
      request(t.app).post(`/api/cases/${id}/flags/${ifsc.id}/resolve`).send({ decision: 'accept' }),
    ).expect(200);
    expect((await as(DSWO)(request(t.app).post(`/api/cases/${id}/approve`))).status).toBe(409); // accepted = still real

    for (const f of detail.flags.filter((x: { severity: string }) => x.severity === 'critical')) {
      await as(DSWO)(
        request(t.app)
          .post(`/api/cases/${id}/flags/${f.id}/resolve`)
          .send({ decision: 'override', reasonCode: 'verified_original' }),
      ).expect(200);
    }
    expect((await as(DSWO)(request(t.app).post(`/api/cases/${id}/approve`))).status).toBe(200);
  });

  it('open warnings must be reviewed before approval (accept or override each)', async () => {
    const { id } = await screened({
      application_form: { applicant_name: 'Kh. Loken Singh', father_or_husband_name: null },
      aadhaar: { name: 'Khuraijam Loken Singh' },
      bank_passbook: { account_holder_name: 'Khuraijam Loken Singh' },
    });
    const d = (await request(t.app).get(`/api/cases/${id}`)).body;
    const warns = d.flags.filter((f: { severity: string }) => f.severity === 'warn');
    expect(warns.length).toBeGreaterThan(0);
    expect(d.actions.canApprove).toBe(false);
    const blocked = await as(DSWO)(request(t.app).post(`/api/cases/${id}/approve`));
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/review/i);
    for (const f of warns) {
      await as(DSWO)(
        request(t.app)
          .post(`/api/cases/${id}/flags/${f.id}/resolve`)
          .send({ decision: 'accept', reasonText: 'Khuraijam confirmed with applicant' }),
      ).expect(200);
    }
    expect((await as(DSWO)(request(t.app).post(`/api/cases/${id}/approve`))).status).toBe(200);
  });

  it('there is no reject endpoint', async () => {
    const { id } = await screened();
    expect((await as(DSWO)(request(t.app).post(`/api/cases/${id}/reject`))).status).toBe(404);
  });
});

describe('flag decisions', () => {
  it('override requires a reason; "other" requires an explanation', async () => {
    const { id } = await screened({ bank_passbook: { ifsc: 'BAD' } });
    const flag = flagOf((await request(t.app).get(`/api/cases/${id}`)).body, 'IFSC_INVALID');
    const url = `/api/cases/${id}/flags/${flag.id}/resolve`;
    expect((await as(DA)(request(t.app).post(url).send({ decision: 'override' }))).status).toBe(
      400,
    );
    expect(
      (await as(DA)(request(t.app).post(url).send({ decision: 'override', reasonCode: 'other' })))
        .status,
    ).toBe(400);
    const ok = await as(DA)(
      request(t.app).post(url).send({
        decision: 'override',
        reasonCode: 'other',
        reasonText: 'Bank confirmed IFSC by phone',
      }),
    );
    expect(ok.status).toBe(200);
    expect(flagOf(ok.body, 'IFSC_INVALID')).toMatchObject({
      resolution: 'OVERRIDDEN',
      resolutionReason: 'Bank confirmed IFSC by phone',
      resolvedByName: 'Dealing Assistant',
    });
    const summary = ok.body.audit.find(
      (a: { action: string }) => a.action === 'OFFICER_OVERRIDE',
    ).summary;
    expect(summary).toBe(
      'Dealing Assistant overrode “Invalid IFSC code” — reason: Bank confirmed IFSC by phone',
    );
  });

  it('overriding the only issue moves the case to READY; reopening moves it back', async () => {
    const { id } = await screened({
      application_form: { applicant_name: 'Kh. Loken Singh', father_or_husband_name: null },
      aadhaar: { name: 'Khuraijam Loken Singh' },
      bank_passbook: { account_holder_name: 'Khuraijam Loken Singh' },
    });
    let d = (await request(t.app).get(`/api/cases/${id}`)).body;
    expect(d.case.status).toBe('OFFICER_ATTENTION');
    for (const f of d.flags.filter((x: { code: string }) => x.code === 'NAME_AMBIGUOUS')) {
      d = (
        await as(DA)(
          request(t.app)
            .post(`/api/cases/${id}/flags/${f.id}/resolve`)
            .send({ decision: 'override', reasonCode: 'abbreviation_confirmed' }),
        )
      ).body;
    }
    expect(d.case.status).toBe('READY');
    const f = d.flags.find((x: { code: string }) => x.code === 'NAME_AMBIGUOUS');
    d = (
      await as(DA)(
        request(t.app).post(`/api/cases/${id}/flags/${f.id}/resolve`).send({ decision: 'reopen' }),
      )
    ).body;
    expect(d.case.status).toBe('OFFICER_ATTENTION');
  });
});

describe('field edits', () => {
  it('re-screens instantly with NO AI call, audits before/after, and needs a reason', async () => {
    const { id, vision } = await screened({ bank_passbook: { ifsc: 'SBIN1001234' } });
    const calls = vision.calls.length;
    let d = (await request(t.app).get(`/api/cases/${id}`)).body;
    expect(d.case.status).toBe('NEEDS_CITIZEN_CORRECTION');
    const passbook = d.documents.find(
      (x: { detectedType: string }) => x.detectedType === 'bank_passbook',
    );

    const noReason = await as(DA)(
      request(t.app)
        .patch(`/api/cases/${id}/fields`)
        .send({ documentId: passbook.id, field: 'ifsc', value: 'SBIN0001234' }),
    );
    expect(noReason.status).toBe(400);

    const res = await as(DA)(
      request(t.app).patch(`/api/cases/${id}/fields`).send({
        documentId: passbook.id,
        field: 'ifsc',
        value: 'SBIN0001234',
        reasonCode: 'ai_misread',
      }),
    );
    expect(res.status).toBe(200);
    d = res.body;
    expect(vision.calls.length).toBe(calls); // no new Claude call
    expect(d.case.status).toBe('READY');
    expect(
      d.documents.find((x: { id: string }) => x.id === passbook.id).extraction.fields.ifsc,
    ).toMatchObject({ value: 'SBIN0001234', editedBy: 'Dealing Assistant', confidence: 'high' });

    const edit = t.handle.db
      .select()
      .from(auditLog)
      .all()
      .find((a) => a.action === 'FIELD_EDITED')!;
    expect(edit.before).toMatchObject({ value: 'SBIN1001234' });
    expect(edit.after).toMatchObject({ field: 'ifsc', value: 'SBIN0001234' });
    expect(edit.reason).toBe('AI misread — corrected from the image');
    expect(d.audit.at(-1).summary).toMatch(/^Rules checked after officer edit: 0 issues → Ready$/);
  });

  it('officer decisions survive a re-screen', async () => {
    const { id } = await screened({ bank_passbook: { ifsc: 'BAD' } });
    let d = (await request(t.app).get(`/api/cases/${id}`)).body;
    const ifsc = flagOf(d, 'IFSC_INVALID');
    await as(DA)(
      request(t.app)
        .post(`/api/cases/${id}/flags/${ifsc.id}/resolve`)
        .send({ decision: 'override', reasonCode: 'verified_original' }),
    ).expect(200);
    const form = d.documents.find(
      (x: { detectedType: string }) => x.detectedType === 'application_form',
    );
    d = (
      await as(DA)(
        request(t.app).patch(`/api/cases/${id}/fields`).send({
          documentId: form.id,
          field: 'district',
          value: 'Imphal West',
          reasonCode: 'applicant_confirmed',
        }),
      )
    ).body;
    expect(flagOf(d, 'IFSC_INVALID')).toMatchObject({ id: ifsc.id, resolution: 'OVERRIDDEN' });
  });

  it('the Aadhaar number cannot be edited', async () => {
    const { id } = await screened();
    const d = (await request(t.app).get(`/api/cases/${id}`)).body;
    const aadhaar = d.documents.find((x: { detectedType: string }) => x.detectedType === 'aadhaar');
    const res = await as(DA)(
      request(t.app).patch(`/api/cases/${id}/fields`).send({
        documentId: aadhaar.id,
        field: 'aadhaar_number',
        value: '1',
        reasonCode: 'ai_misread',
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('correction, forwarding, notes', () => {
  it('send-for-correction is refused while a duplicate is suspected', async () => {
    const first = await screened({ bank_passbook: { ifsc: 'BAD' } });
    const second = await screened({ bank_passbook: { ifsc: 'BAD' } }, t);
    const ok = await as(DA)(request(t.app).post(`/api/cases/${first.id}/send-for-correction`));
    expect(ok.status).toBe(200);
    const blocked = await as(DA)(
      request(t.app).post(`/api/cases/${second.id}/send-for-correction`),
    );
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/duplicate/);
    expect(
      (await request(t.app).get(`/api/cases/${second.id}`)).body.actions.canSendForCorrection,
    ).toBe(false);
  });

  it('bulk forward only forwards READY cases', async () => {
    const ready = await screened();
    const other = await screened(
      {
        bank_passbook: { ifsc: 'BAD' },
        aadhaar: { name: 'Okram Tombi Devi' },
        application_form: { applicant_name: 'Okram Tombi Devi' },
      },
      t,
    );
    const res = await as(DA)(
      request(t.app)
        .post('/api/cases/forward')
        .send({ caseIds: [ready.id, other.id, 'nope'] }),
    );
    expect(res.body.forwarded).toEqual([ready.id]);
    expect(res.body.skipped.map((s: { id: string }) => s.id).sort()).toEqual(
      [other.id, 'nope'].sort(),
    );
    expect(
      (await request(t.app).get(`/api/cases/${ready.id}`)).body.case.forwardedAt,
    ).not.toBeNull();
  });

  it('notes are audited with a readable summary', async () => {
    const { id } = await screened();
    const res = await as(DA)(
      request(t.app).post(`/api/cases/${id}/notes`).send({ text: 'Applicant visited office' }),
    );
    expect(res.status).toBe(201);
    expect(res.body.audit.at(-1).summary).toBe(
      'Dealing Assistant added a note: Applicant visited office',
    );
  });
});

describe('read model', () => {
  it('identity card data: names per document and pairwise verdicts with reasons', async () => {
    const { id } = await screened({
      application_form: { applicant_name: 'Kh. Loken Singh', father_or_husband_name: null },
      aadhaar: { name: 'Khuraijam Loken Singh' },
      bank_passbook: { account_holder_name: 'KHURAIJAM LOKEN SINGH' },
    });
    const d = (await request(t.app).get(`/api/cases/${id}`)).body;
    expect(
      d.identity.entries.map((e: { label: string; value: string }) => [e.label, e.value]),
    ).toEqual([
      ['Application form', 'Kh. Loken Singh'],
      ['Aadhaar card', 'Khuraijam Loken Singh'],
      ['Bank passbook', 'KHURAIJAM LOKEN SINGH'],
    ]);
    const formVsAadhaar = d.identity.pairs[0];
    expect(formVsAadhaar).toMatchObject({ verdict: 'AMBIGUOUS' });
    expect(formVsAadhaar.candidates).toEqual(expect.arrayContaining(['Khuraijam', 'Khwairakpam']));
    expect(d.identity.pairs[2]).toMatchObject({ verdict: 'SAME' });
  });

  it('audit trail is human-readable', async () => {
    const { id } = await screened();
    const lines = (await request(t.app).get(`/api/cases/${id}`)).body.audit.map(
      (a: { summary: string }) => a.summary,
    );
    expect(lines).toContain('Packet received (3 images, via api)');
    expect(lines).toContain(
      'Officer placed form.jpg in the Application form slot (AI classification skipped)',
    );
    expect(
      lines.some((l: string) =>
        /^AI extracted 18 fields from Application form \(Sonnet 5\.5, 1\.2s\)$/.test(l),
      ),
    ).toBe(true);
    expect(lines.at(-1)).toBe('Rules checked: 0 issues → Ready');
  });

  it('name search uses the name engine: "Thomas Okram" finds "O. Thomas Meitei"', async () => {
    await screened({
      application_form: { applicant_name: 'O. Thomas Meitei' },
      aadhaar: { name: 'O. Thomas Meitei' },
      bank_passbook: { account_holder_name: 'O. Thomas Meitei' },
    });
    await screened(
      {
        application_form: { applicant_name: 'Okram Tomba Singh' },
        aadhaar: { name: 'Okram Tomba Singh', aadhaar_number: '3456 7890 1238' },
        bank_passbook: { account_holder_name: 'Okram Tomba Singh' },
      },
      t,
    );
    const hits = (await request(t.app).get('/api/cases').query({ q: 'Thomas Okram' })).body.cases;
    expect(hits.map((c: { applicantName: string }) => c.applicantName)).toEqual([
      'O. Thomas Meitei',
    ]);
    expect(
      (await request(t.app).get('/api/cases').query({ q: 'tomba' })).body.cases.map(
        (c: { applicantName: string }) => c.applicantName,
      ),
    ).toEqual(['Okram Tomba Singh']);
  });

  it('queue summaries carry age, top flag and counts; stats aggregate', async () => {
    await screened();
    await screened(
      {
        bank_passbook: { ifsc: 'BAD' },
        aadhaar: { name: 'Okram Tombi Devi', aadhaar_number: '3456 7890 1238' },
        application_form: { applicant_name: 'Okram Tombi Devi' },
      },
      t,
    );
    const list = (await request(t.app).get('/api/cases')).body.cases;
    const bad = list.find((c: { applicantName: string }) => c.applicantName === 'Okram Tombi Devi');
    expect(bad).toMatchObject({ age: 78, topFlag: { severity: 'critical' }, scheme: 'MOAPS' });
    const stats = (await request(t.app).get('/api/stats')).body;
    expect(stats).toMatchObject({ total: 2, byStatus: { READY: 1, NEEDS_CITIZEN_CORRECTION: 1 } });
    expect(stats.flagsCaught).toBeGreaterThan(0);
    expect(stats.districts).toEqual(['Imphal East']);
    expect(typeof stats.avgScreeningMs).toBe('number');
  });

  it('Aadhaar and form images are served redacted, never raw', async () => {
    const { id } = await screened();
    const d = (await request(t.app).get(`/api/cases/${id}`)).body;
    for (const doc of d.documents) {
      const img = await request(t.app).get(doc.imageUrl).query({ variant: 'original' });
      expect(img.headers['x-redaction']).toBe(
        doc.detectedType === 'bank_passbook' ? 'none' : 'bbox',
      );
    }
    expect(d.documents.map((x: { redaction: string }) => x.redaction)).toEqual([
      'bbox',
      'bbox',
      'none',
    ]);
  });

  it('meta lists officers with roles and the reason dropdowns', async () => {
    t = setupApp(packetVision());
    const meta = (await request(t.app).get('/api/meta')).body;
    expect(meta.officers.map((o: { name: string; role: string }) => [o.name, o.role])).toEqual([
      ['DSWO Imphal West', 'DSWO'],
      ['Dealing Assistant', 'DEALING_ASSISTANT'],
    ]);
    expect(meta.officers[1].permissions).not.toContain('approve');
    expect(meta.overrideReasons.length).toBeGreaterThan(3);
  });
});
