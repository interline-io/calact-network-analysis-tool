// Origin-side gzip for streamed NDJSON responses. `application/x-ndjson` is
// not on Cloudflare's default compressible content-type list, so without
// this the (highly repetitive) scenario streams cross the wire raw.
// Browsers decompress transparently, so stream consumers are unchanged.

import type { H3Event } from 'h3'
import { getRequestHeader, setHeader } from 'h3'

// The Cloudflare workers runtime owns response encoding ("automatic" body
// encoding): a Content-Encoding header set by the worker is stripped while
// the already-gzipped body passes through verbatim, so clients would receive
// gzip bytes with no header. Skip origin compression there — edge
// compression for x-ndjson is the zone's job (Compression Rule).
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
