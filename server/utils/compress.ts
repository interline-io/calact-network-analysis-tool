// Origin-side gzip for streamed NDJSON responses, covering deployments with
// no compressing edge in front (local dev, plain Node hosting). Browsers
// decompress transparently, so stream consumers are unchanged. On the
// Cloudflare workers runtime this is skipped: the edge compresses instead,
// keyed off the content type set in phase-stream.ts.

import type { H3Event } from 'h3'
import { getRequestHeader, setHeader } from 'h3'

// The Cloudflare workers runtime owns response encoding ("automatic" body
// encoding): a Content-Encoding header set by the worker is stripped while
// the already-gzipped body passes through verbatim, so clients would receive
// gzip bytes with no header. Skip origin compression there — the edge
// compresses instead, keyed off the application/json content type.
function isWorkersRuntime (): boolean {
  return globalThis.navigator?.userAgent === 'Cloudflare-Workers'
}

export function compressStream (event: H3Event, stream: ReadableStream): ReadableStream {
  if (isWorkersRuntime()) {
    return stream
  }
  const acceptEncoding = (getRequestHeader(event, 'accept-encoding') || '').toLowerCase()
  // Encoding is negotiated per request, so caches must key on it.
  setHeader(event, 'vary', 'accept-encoding')
  if (!acceptEncoding.includes('gzip')) {
    return stream
  }
  setHeader(event, 'content-encoding', 'gzip')
  return stream.pipeThrough(new CompressionStream('gzip'))
}
