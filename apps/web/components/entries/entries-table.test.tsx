import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ar from '@/messages/ar.json';
import { EntriesTable } from '@/components/entries/entries-table';
import type { EntryListItem } from '@/lib/api/entries';

const noop = (): void => undefined;

function item(overrides: Partial<EntryListItem>): EntryListItem {
  return {
    id: 'e1',
    serial: '6200000000',
    typePrefix: '62',
    year: 2025,
    companyId: 'c1',
    projectId: 'p1',
    company: { code: 2000, nameAr: 'الشركة', nameEn: 'Co' },
    project: { code: 'R', nameAr: 'الرحاب', nameEn: 'Rehab' },
    fileName: '6200000000.pdf',
    fileSize: 1024,
    createdAt: '2025-01-01T00:00:00.000Z',
    deletedAt: null,
    uploadedBy: { id: 'u1', nameAr: 'مدير' },
    ...overrides,
  };
}

const actions = {
  onView: noop,
  onDownload: noop,
  onDelete: noop,
  onRestore: noop,
  canDelete: false,
  canRestore: false,
};

function renderTable(items: EntryListItem[]): void {
  render(
    <NextIntlClientProvider locale="ar" messages={ar}>
      <EntriesTable items={items} actions={actions} locale="ar" />
    </NextIntlClientProvider>,
  );
}

describe('EntriesTable resilience', () => {
  const widthDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  const heightDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');

  beforeAll(() => {
    // jsdom reports zero layout boxes, which starves the virtualizer.
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => 1024,
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => 600,
    });
  });

  afterAll(() => {
    if (widthDesc) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', widthDesc);
    if (heightDesc) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', heightDesc);
  });

  it('renders company and project names for a full item', () => {
    renderTable([item({})]);
    // header + cell each render the name; the cell copy proves the relation.
    expect(screen.getAllByText('الشركة').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('الرحاب').length).toBeGreaterThanOrEqual(1);
  });

  it('shows — instead of crashing when company is missing', () => {
    renderTable([item({ company: undefined as never, project: undefined as never })]);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });
});
