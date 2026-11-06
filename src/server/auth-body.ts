// Limit bytes while streaming, before decoding or parsing; Content-Length alone
// cannot bound chunked requests or dishonest clients.
export async function authBody(request: Request): Promise<{ value?: unknown; tooLarge?: boolean }> {
  const maximum = 4096;
  if (Number(request.headers.get('content-length')) > maximum) return { tooLarge: true };
  const reader = request.body?.getReader();
  if (!reader) return { value: null };
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        void reader.cancel().catch(() => {});
        return { tooLarge: true };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { value: null };
  } finally {
    reader.releaseLock();
  }
}
