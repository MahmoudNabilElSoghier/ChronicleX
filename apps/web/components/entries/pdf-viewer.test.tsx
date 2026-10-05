import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import ar from '@/messages/ar.json';
import { PdfViewer } from '@/components/entries/pdf-viewer';
import { entriesApi } from '@/lib/api/entries';

vi.mock('@/lib/api/entries', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/api/entries')>();
  return { ...mod, entriesApi: { ...mod.entriesApi, download: vi.fn() } };
});

const downloadMock = vi.mocked(entriesApi.download);

describe('PdfViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:fake');
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  it('revokes the object URL on unmount', async () => {
    let resolveDownload!: (blob: Blob) => void;
    downloadMock.mockReturnValue(
      new Promise<Blob>((resolve) => {
        resolveDownload = resolve;
      }),
    );
    const { unmount } = render(
      <NextIntlClientProvider locale="ar" messages={ar}>
        <PdfViewer id="e1" fileName="6200000000.pdf" deleted={false} />
      </NextIntlClientProvider>,
    );
    resolveDownload(new Blob(['%PDF'], { type: 'application/pdf' }));
    await vi.waitFor(() => expect(globalThis.URL.createObjectURL).toHaveBeenCalled());
    unmount();
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });

  it('deleted entries render the tombstone without fetching', async () => {
    const { findByText } = render(
      <NextIntlClientProvider locale="ar" messages={ar}>
        <PdfViewer id="e9" fileName="6200000000.pdf" deleted />
      </NextIntlClientProvider>,
    );
    expect(await findByText('الملف محذوف')).toBeInTheDocument();
    expect(downloadMock).not.toHaveBeenCalled();
  });
});
