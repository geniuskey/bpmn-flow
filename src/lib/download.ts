export function downloadText(text: string, fileName: string, mime = 'application/xml'): void {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), fileName);
}

/** Downloads bytes unchanged (no re-encoding). */
export function downloadBytes(bytes: Uint8Array, fileName: string, mime = 'application/xml'): void {
  downloadBlob(new Blob([bytes as BlobPart], { type: mime }), fileName);
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
