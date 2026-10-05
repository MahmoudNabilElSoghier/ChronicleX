/** Release a blob URL on the next frame + delay (Safari-safe). */
function deferredRevoke(url: string): void {
  requestAnimationFrame(() => setTimeout(() => URL.revokeObjectURL(url), 1000));
}

/** Trigger a browser download and release everything afterwards. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  deferredRevoke(url);
}

/** Open a blob in a new tab and release the URL shortly after. */
export function openBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  deferredRevoke(url);
}
