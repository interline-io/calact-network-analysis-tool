import { parse, format } from 'date-fns'

const dateFmt = 'yyyy-MM-dd'
const timeFmt = 'HH:mm:ss'


export function parseDate(d: string): Date | null {
    if (d) {
      return parse(d, dateFmt, getLocalDateNoTime())
    }
    return null
  }

export function fmtDate(d: Date | null): string {
    if (!d) {
        return ''
    }
    return format(d, dateFmt)
}

export function parseTime(d: string): Date | null {
    if (d) {
      return parse(d, timeFmt, getLocalDateNoTime())
    }
    return null
}

export function fmtTime(d: Date | null): string {
    if (!d) {
        return ''
    }
    return format(d, timeFmt)
}

export function getLocalDateNoTime(): Date {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function getUTCDateNoTime(): Date {
    const now = new Date()
    return new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}
