import { parse, format } from 'date-fns'

const dateFmt = 'yyyy-MM-dd'
const timeFmt = 'HH:mm:ss'

export function parseDate (d: string): Date | null {
  if (d) {
    return parse(d, dateFmt, getLocalDateNoTime())
  }
  return null
}

export function fmtDate (d: Date | null, fmt: string = dateFmt): string {
  if (!d) {
    return ''
  }
  return format(d, fmt)
}

export function parseTime (d: string): Date | null {
  if (d) {
    return parse(d, timeFmt, getLocalDateNoTime())
  }
  return null
}

export function fmtTime (d: Date | null, fmt: string = timeFmt): string {
  if (!d) {
    return ''
  }
  return format(d, fmt)
}

export function getLocalDateNoTime (): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

export function getUTCDateNoTime (): Date {
  const now = new Date()
  return new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
}

export function parseHMS (value: string): number {
  const a = (value || '').split(':').map((s) => {
    return parseInt(s)
  })
  if (a.length !== 3) {
    return -1
  }
  return a[0] * 3600 + a[1] * 60 + a[2]
}
