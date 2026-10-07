import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { FlagsPanel } from '../FlagsPanel';
import { DocumentViewer } from '../DocumentViewer';
import { highlightForEvidence, wireField, type Highlight } from '../../../lib/highlight';
import type { CaseFlag } from '../../../lib/api';
import { AADHAAR, DOB_FLAG, FORM } from '../../../test/fixtures';

const DOCS = [FORM, AADHAAR];

/** Same wiring as CasePage: selecting a flag sets the viewer's highlight + active document. */
function Harness({ flags }: { flags: CaseFlag[] }) {
  const [hl, setHl] = useState<Highlight | null>(null);
  const [active, setActive] = useState<string | null>(null);
  return (
    <>
      <FlagsPanel
        flags={flags}
        selectedId={null}
        onSelect={(f) => {
          const h = highlightForEvidence(f.evidence, DOCS);
          setHl(h);
          if (h) setActive(h.documentId);
        }}
        onResolve={vi.fn()}
        canResolve
        readOnlyReason={null}
        reasons={[]}
      />
      <DocumentViewer documents={DOCS} activeId={active} onSelect={setActive} highlight={hl} />
    </>
  );
}

describe('flag → bounding-box highlight', () => {
  it('maps rules-engine evidence to extraction fields', () => {
    expect(wireField({ document: 'form', field: 'dob' })).toBe('date_of_birth');
    expect(wireField({ document: 'aadhaar', field: 'last4' })).toBe('aadhaar_number');
    expect(wireField({ document: 'passbook', field: 'accountHolderName' })).toBe(
      'account_holder_name',
    );
    expect(wireField({ document: 'form', field: 'document' })).toBeNull();
  });

  it('prefers the evidence that has a bbox (form DOB has none → Aadhaar DOB)', () => {
    expect(highlightForEvidence(DOB_FLAG.evidence, DOCS)).toEqual({
      documentId: 'd-aadhaar',
      field: 'dob_or_yob',
      mode: 'click',
    });
  });

  it('clicking a flag switches to the right document and draws its box', () => {
    render(<Harness flags={[DOB_FLAG]} />);
    expect(screen.queryByTestId('bbox-highlight')).toBeNull();
    fireEvent.click(screen.getByTestId('flag'));
    expect(screen.getByRole('tab', { selected: true }).textContent).toContain('Aadhaar');
    const rect = screen.getByTestId('bbox-highlight');
    // bbox [300,210,420,240] drawn with 6px padding, in image coordinates
    expect([
      rect.getAttribute('x'),
      rect.getAttribute('y'),
      rect.getAttribute('width'),
      rect.getAttribute('height'),
    ]).toEqual(['294', '204', '132', '42']);
  });

  it('shows "location not available" when the field has no bbox', () => {
    render(
      <DocumentViewer
        documents={DOCS}
        activeId="d-form"
        onSelect={() => {}}
        highlight={{ documentId: 'd-form', field: 'date_of_birth', mode: 'hover' }}
      />,
    );
    expect(screen.queryByTestId('bbox-highlight')).toBeNull();
    expect(screen.getByTestId('no-location').textContent).toMatch(/Location not available/);
  });

  it('labels server-side Aadhaar redaction on the image', () => {
    render(
      <DocumentViewer documents={DOCS} activeId="d-aadhaar" onSelect={() => {}} highlight={null} />,
    );
    expect(screen.getByText('Aadhaar number redacted on server')).toBeTruthy();
  });

  it('evidence values are shown side by side', () => {
    render(
      <FlagsPanel
        flags={[DOB_FLAG]}
        selectedId={null}
        onSelect={() => {}}
        onResolve={vi.fn()}
        canResolve
        readOnlyReason={null}
        reasons={[]}
      />,
    );
    expect(screen.getByTestId('evidence').textContent).toBe('Form:“15-03-1958”Aadhaar:“1958”');
  });

  it('keyboard: J selects the next flag, A accepts it', () => {
    const onSelect = vi.fn();
    const onResolve = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <FlagsPanel
        flags={[DOB_FLAG]}
        selectedId={null}
        onSelect={onSelect}
        onResolve={onResolve}
        canResolve
        readOnlyReason={null}
        reasons={[]}
      />,
    );
    fireEvent.keyDown(window, { key: 'j' });
    expect(onSelect).toHaveBeenCalledWith(DOB_FLAG);
    rerender(
      <FlagsPanel
        flags={[DOB_FLAG]}
        selectedId="f-dob"
        onSelect={onSelect}
        onResolve={onResolve}
        canResolve
        readOnlyReason={null}
        reasons={[]}
      />,
    );
    fireEvent.keyDown(window, { key: 'a' });
    expect(onResolve).toHaveBeenCalledWith(DOB_FLAG, 'accept');
  });
});
