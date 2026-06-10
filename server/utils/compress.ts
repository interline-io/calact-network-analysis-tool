// Origin-side gzip for streamed NDJSON responses. `application/x-ndjson` is
// not on Cloudflare's default compressible content-type list, so without
// this the (highly repetitive) scenario streams cross the wire raw.
// Browsers decompress transparently, so stream consumers are unchanged.

import type { H3Event } from 'h3'
import { getRequestHeader, setHeader } from 'h3'

export function compressStream (event: H3Event, stream: ReadableStream): ReadableStream {
  const acceptEncoding = getRequestHeader(event, 'accept-encoding') || ''
  if (!acceptEncoding.includes('gzip')) {
    return stream
  }
  setHeader(event, 'content-encoding', 'gzip')
  return stream.pipeThrough(new CompressionStream('gzip'))
}
