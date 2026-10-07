import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { IdentityCard, VerdictPill } from '../IdentityCard';
import { IDENTITY } from '../../../test/fixtures';

describe('IdentityCard', () => {
  it('shows each name exactly as written on its document', () => {
    render(<IdentityCard identity={IDENTITY} />);
    expect(screen.getAllByTestId('name-as-written').map((n) => n.textContent)).toEqual([
      '“Kh. Loken Singh”',
      '“Khuraijam Loken Singh”',
      '“KHURAIJAM LOKEN SINGH”',
    ]);
  });

  it('renders a verdict pill with score for every pair', () => {
    render(<IdentityCard identity={IDENTITY} />);
    const pairs = screen.getAllByTestId('identity-pair');
    expect(pairs).toHaveLength(3);
    expect(within(pairs[0]!).getByText('Application form', { exact: false })).toBeTruthy();
    const pills = pairs.map((p) => p.querySelector('[data-verdict]')!);
    expect(pills.map((p) => p.getAttribute('data-verdict'))).toEqual([
      'AMBIGUOUS',
      'AMBIGUOUS',
      'SAME',
    ]);
    expect(pills[0]!.textContent).toBe('Ambiguous74');
    expect(pills[2]!.textContent).toBe('Same100');
  });

  it('summarises with the worst verdict', () => {
    render(<IdentityCard identity={IDENTITY} />);
    expect(screen.getByText('2 comparisons need an officer’s confirmation.')).toBeTruthy();
    const header = screen
      .getByRole('heading', { name: 'Identity across documents' })
      .closest('header')!;
    expect(header.querySelector('[data-verdict]')!.getAttribute('data-verdict')).toBe('AMBIGUOUS');
  });

  it('opens AMBIGUOUS pairs by default with candidate yumnak chips and reasons; SAME pairs on demand', () => {
    render(<IdentityCard identity={IDENTITY} />);
    const [ambiguous, , same] = screen.getAllByTestId('identity-pair');
    const chips = within(ambiguous!).getByLabelText('Candidate yumnaks');
    expect(within(chips).getByText('Khuraijam')).toBeTruthy();
    expect(within(chips).getByText('Khwairakpam')).toBeTruthy();
    expect(within(ambiguous!).getByText(/Officer to confirm the yumnak/)).toBeTruthy();
    expect(within(same!).queryByText('All name parts match.')).toBeNull();
    fireEvent.click(within(same!).getByRole('button'));
    expect(within(same!).getByText('All name parts match.')).toBeTruthy();
  });

  it('hovering a name reports its document and field (for the image highlight)', () => {
    const onHover = vi.fn();
    render(<IdentityCard identity={IDENTITY} onHover={onHover} />);
    fireEvent.mouseEnter(screen.getAllByTestId('name-as-written')[1]!.closest('li')!);
    expect(onHover).toHaveBeenLastCalledWith({ documentId: 'd-aadhaar', field: 'name' });
  });

  it('pill colours differ per verdict', () => {
    const { container } = render(
      <>
        <VerdictPill verdict="SAME" />
        <VerdictPill verdict="DIFFERENT" />
      </>,
    );
    const [same, diff] = Array.from(container.querySelectorAll('[data-verdict]'));
    expect(same!.className).toContain('emerald');
    expect(diff!.className).toContain('rose');
  });
});
