import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  containsFullAadhaar,
  defaultTemplateSet,
  noticeToPlainText,
  renderNotice,
  verhoeffCheckDigit,
} from '@thoudang/core';
import { NoticeDocument } from '../NoticeDocument';
import { AudioPlayer } from '../AudioPlayer';
import { StatusPage } from '../../../pages/StatusPage';
import type { Notice } from '../../../lib/api';

const FULL = (() => {
  const b = '23456789012';
  return b + verhoeffCheckDigit(b);
})();

function notice(): Notice {
  const rendered = renderNotice(defaultTemplateSet, {
    applicantName: 'Laishram Ningol Okram Ongbi Ibemcha Devi',
    reference: 'THD-2026-0003',
    date: '8 Oct 2026',
    district: 'Bishnupur',
    items: [
      {
        code: 'DOB_MISMATCH',
        documentA: 'form',
        documentB: 'aadhaar',
        field: 'dob',
        valueA: '15-03-1944',
        valueB: '1943',
        reason: 'x',
      },
      // a full number sneaking into a value must still never reach the page
      {
        code: 'AADHAAR_FORM_CARD_MISMATCH',
        documentA: 'form',
        documentB: 'aadhaar',
        valueA: FULL,
        valueB: '2341',
        reason: 'x',
      },
    ],
  });
  return {
    caseId: 'c1',
    reference: 'THD-2026-0003',
    applicantName: 'Laishram Ningol Okram Ongbi Ibemcha Devi',
    allowed: true,
    blockedReason: null,
    rendered,
    plainText: {
      en: noticeToPlainText(rendered, 'en'),
      mni_beng: noticeToPlainText(rendered, 'mni_beng'),
      mni_mtei: noticeToPlainText(rendered, 'mni_mtei'),
    },
    statusPath: '/s/THD-2026-0003?k=abcdef123456',
    noticeSentAt: null,
    date: '8 Oct 2026',
    audio: {
      available: false,
      cached: false,
      url: null,
      reason: 'Audio unavailable (no GEMINI_API_KEY and not pre-generated)',
    },
  };
}

describe('printable notice', () => {
  it('renders all three scripts stacked, with the SPECIMEN watermark, and no Aadhaar digits in the HTML', () => {
    const { container } = render(
      <NoticeDocument
        notice={notice()}
        mode="all"
        qrDataUrl="data:image/png;base64,AAAA"
        statusUrl="http://x/s/THD-2026-0003?k=abcdef123456"
      />,
    );
    const html = container.innerHTML;
    expect(containsFullAadhaar(html)).toBe(false);
    expect(html).not.toContain(FULL);
    expect(html).toMatch(/[ꯀ-꯿]/); // Meetei Mayek
    expect(html).toMatch(/[ঀ-৿]/); // Bengali script
    expect(screen.getByText('PROTOTYPE — SPECIMEN')).toBeTruthy();
    expect(screen.getByAltText('QR code for application status')).toBeTruthy();
    expect(screen.getByTestId('notice-items').querySelectorAll('li')).toHaveLength(2);
  });

  it('English-only mode shows one line per correction with the values as written', () => {
    render(<NoticeDocument notice={notice()} mode="en" qrDataUrl={null} statusUrl="http://x" />);
    const items = screen.getByTestId('notice-items');
    expect(items.textContent).toContain('application form (“15-03-1944”)');
    expect(items.textContent).not.toMatch(/[ঀ-৿ꯀ-꯿]/);
  });

  it('WhatsApp text carries no Aadhaar digits', () => {
    const n = notice();
    for (const text of Object.values(n.plainText!)) expect(containsFullAadhaar(text)).toBe(false);
  });
});

describe('audio fallback', () => {
  it('no audio → "Audio unavailable" and no play button', () => {
    render(<AudioPlayer caseId="c1" audio={notice().audio} />);
    expect(screen.getByTestId('audio-unavailable').textContent).toMatch(/^Audio unavailable/);
    expect(screen.queryByRole('button', { name: /Listen in Manipuri/ })).toBeNull();
  });

  it('pre-generated audio → a large "Listen in Manipuri" button', () => {
    render(
      <AudioPlayer
        caseId="c1"
        audio={{
          available: true,
          cached: true,
          url: '/api/cases/c1/notice/audio?h=1',
          reason: null,
        }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Listen in Manipuri' })).toBeTruthy();
  });
});

describe('citizen status page', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows only the first name, reference and status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            reference: 'THD-2026-0003',
            firstName: 'Ibemcha',
            status: 'Correction needed',
            updatedAt: '2026-10-08T06:00:00Z',
          }),
          { status: 200 },
        ),
      ),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/s/THD-2026-0003?k=abcdef123456']}>
          <Routes>
            <Route path="/s/:ref" element={<StatusPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const card = await screen.findByTestId('public-status');
    expect(card.textContent).toContain('Hello Ibemcha');
    expect(card.textContent).toContain('Correction needed');
    expect(card.textContent).toMatch(/not a rejection/);
    for (const secret of ['Laishram', 'Okram', 'Devi', '1944'])
      expect(card.textContent).not.toContain(secret);
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe(
      '/api/public/status/THD-2026-0003?k=abcdef123456',
    );
  });
});
