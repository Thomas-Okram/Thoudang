import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Button } from '../Button';
import { Badge } from '../Badge';
import { StatTile } from '../StatTile';
import { Tabs } from '../Tabs';
import { Dialog } from '../Dialog';
import { Drawer } from '../Drawer';
import { Toast } from '../Toast';
import { EmptyState } from '../EmptyState';
import { ProgressSteps } from '../ProgressSteps';
import { PresentationProvider, PresentationToggle } from '../../../lib/presentation';

describe('Button', () => {
  it('renders the variant and passes clicks through', () => {
    const onClick = vi.fn();
    render(
      <Button variant="primary" onClick={onClick}>
        Screen application
      </Button>,
    );
    const b = screen.getByRole('button', { name: 'Screen application' });
    expect(b.dataset.variant).toBe('primary');
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('loading → disabled, aria-busy, shows the loading label', () => {
    render(
      <Button loading loadingLabel="Submitting…">
        Submit
      </Button>,
    );
    const b = screen.getByRole('button');
    expect(b.textContent).toContain('Submitting…');
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect((b as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Badge', () => {
  it('renders its tone as a data attribute', () => {
    render(<Badge tone="warn">Pending review</Badge>);
    expect(
      screen.getByText('Pending review').closest('[data-tone]')!.getAttribute('data-tone'),
    ).toBe('warn');
  });
});

describe('StatTile', () => {
  it('shows value, label and hint', () => {
    render(<StatTile label="Screened today" value="12" hint="since 9:00" />);
    const tile = screen.getByTestId('stat-tile');
    expect(tile.textContent).toContain('12');
    expect(tile.textContent).toContain('Screened today');
    expect(tile.textContent).toContain('since 9:00');
  });
});

describe('Tabs', () => {
  function Harness() {
    const [v, setV] = useState('a');
    return (
      <Tabs
        label="View"
        value={v}
        onChange={setV}
        items={[
          { value: 'a', label: 'Chart' },
          { value: 'b', label: 'Table' },
        ]}
      />
    );
  }
  it('is a tablist; click and arrow keys move the selection', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist', { name: 'View' })).toBeTruthy();
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Chart');
    fireEvent.click(screen.getByRole('tab', { name: 'Table' }));
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Table');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Table' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { selected: true }).textContent).toBe('Chart');
  });
});

describe('Dialog & Drawer', () => {
  it('Dialog is modal, labelled, and closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <Dialog title="Reset the demo?" onClose={onClose}>
        <button>Inside</button>
      </Dialog>,
    );
    const d = screen.getByRole('dialog', { name: 'Reset the demo?' });
    expect(d.getAttribute('aria-modal')).toBe('true');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('Drawer closes on Escape and on the close button', () => {
    const onClose = vi.fn();
    render(
      <Drawer title="Audit trail" onClose={onClose}>
        <p>entries</p>
      </Drawer>,
    );
    expect(screen.getByRole('dialog', { name: 'Audit trail' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('Toast & EmptyState', () => {
  it('Toast announces politely', () => {
    render(<Toast tone="ok">Saved</Toast>);
    expect(screen.getByRole('status').textContent).toContain('Saved');
  });
  it('EmptyState shows heading and body', () => {
    render(<EmptyState heading="No case selected" body="Pick one in the queue." />);
    expect(screen.getByRole('heading', { name: 'No case selected' })).toBeTruthy();
  });
});

describe('ProgressSteps', () => {
  const steps = [
    { key: 'uploaded', label: 'Uploaded' },
    { key: 'classifying', label: 'Identifying' },
    { key: 'extracting', label: 'Reading' },
    { key: 'screening', label: 'Checking' },
    { key: 'done', label: 'Sorted' },
  ];
  it('marks done / current / upcoming steps', () => {
    render(<ProgressSteps steps={steps} current={2} />);
    const items = screen.getAllByRole('listitem');
    expect(items.map((i) => i.getAttribute('data-state'))).toEqual([
      'done',
      'done',
      'active',
      'pending',
      'pending',
    ]);
    expect(items[2]!.getAttribute('aria-current')).toBe('step');
  });
  it('complete → every step done', () => {
    render(<ProgressSteps steps={steps} current={4} complete />);
    expect(
      screen.getAllByRole('listitem').every((i) => i.getAttribute('data-state') === 'done'),
    ).toBe(true);
  });
});

describe('Presentation mode', () => {
  afterEach(() => {
    document.documentElement.classList.remove('presentation');
    localStorage.clear();
  });
  it('toggles the html class and remembers the choice', () => {
    const { unmount } = render(
      <PresentationProvider>
        <PresentationToggle />
      </PresentationProvider>,
    );
    const toggle = screen.getByRole('switch', { name: /Presentation mode/ });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(document.documentElement.classList.contains('presentation')).toBe(true);
    unmount();
    render(
      <PresentationProvider>
        <PresentationToggle />
      </PresentationProvider>,
    );
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  });
});
