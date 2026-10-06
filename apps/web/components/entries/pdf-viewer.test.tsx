import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function renderViewer(deleted = false): void {
  render(
    <NextIntlClientProvider locale="ar" messages={ar}>
      <PdfViewer id="e1" fileName="6200000000.pdf" fileSize={693000} deleted={deleted} />
    </NextIntlClientProvider>,
  );
}

describe('PdfViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:fake');
    globalThis.URL.revokeObjectURL = vi.fn();
    vi.stubGlobal('open', vi.fn());
  });

  it('does not fetch on mount; fetches on Show file click', async () => {
    downloadMock.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
    renderViewer();
    expect(downloadMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /عرض الملف/ }));
    await waitFor(() => expect(downloadMock).toHaveBeenCalledWith('e1'));
    await waitFor(() => expect(document.querySelector('object')).not.toBeNull());
    expect((document.querySelector('object') as HTMLObjectElement).data).toBe('blob:fake');
  });

  it('revokes the object URL on unmount', async () => {
    downloadMock.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
    const { unmount } = render(
      <NextIntlClientProvider locale="ar" messages={ar}>
        <PdfViewer id="e1" fileName="6200000000.pdf" fileSize={693000} deleted={false} />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /عرض الملف/ }));
    await waitFor(() => expect(globalThis.URL.createObjectURL).toHaveBeenCalled());
    unmount();
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake');
  });

  it('shows the fallback on fetch error', async () => {
    downloadMock.mockRejectedValue(new Error('500'));
    renderViewer();
    fireEvent.click(screen.getByRole('button', { name: /عرض الملف/ }));
    await waitFor(() => expect(screen.getByText(/تعذر عرض الملف/)).toBeInTheDocument());
  });

  it('open-in-new-tab calls window.open without a download anchor', async () => {
    downloadMock.mockRejectedValueOnce(new Error('500'));
    downloadMock.mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
    renderViewer();
    fireEvent.click(screen.getByRole('button', { name: /عرض الملف/ }));
    await waitFor(() => expect(screen.getByText(/تعذر عرض الملف/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /فتح في تبويب جديد/ }));
    await waitFor(() => expect(globalThis.open).toHaveBeenCalledWith('blob:fake', '_blank'));
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('deleted entries render the tombstone without fetching', async () => {
    render(
      <NextIntlClientProvider locale="ar" messages={ar}>
        <PdfViewer id="e9" fileName="6200000000.pdf" fileSize={100} deleted />
      </NextIntlClientProvider>,
    );
    expect(await screen.findByText('الملف محذوف')).toBeInTheDocument();
    expect(downloadMock).not.toHaveBeenCalled();
  });
});
