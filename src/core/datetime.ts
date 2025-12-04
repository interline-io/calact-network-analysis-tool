import { parse, format } from 'date-fns'

const dateFmt = 'yyyy-MM-dd'
const timeFmt = 'HH:mm:ss'

export function parseDate (d: string): Date | undefined {
  if (d) {
    return parse(d, dateFmt, getLocalDateNoTime())
  }
  return undefined
}

export function fmtDate (d: Date | undefined, fmt: string = dateFmt): string {
  if (!d) {
    return ''
  }
  return format(d, fmt)
}

export function parseTime (d: string): Date | undefined {
  if (d) {
    return parse(d, timeFmt, getLocalDateNoTime())
  }
  return undefined
}

export function fmtTime (d: Date | undefined, fmt: string = timeFmt): string {
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
    return Number.parseInt(s)
  })
  if (a.length !== 3 || a.some(Number.isNaN)) {
    return -1
  }
  return a[0]! * 3600 + a[1]! * 60 + a[2]!
}

/**
 * Convert a Date object (representing a time) to seconds since midnight
 * @param time - Date object representing a time of day
 * @returns Seconds since midnight (0-86399)
 */
export function dateToSeconds (time: Date | undefined): number {
  if (!time) return 0
  return time.getHours() * 3600 + time.getMinutes() * 60 + time.getSeconds()
}

/**
 * Get current date in YYYY-MM-DD format
 */
export function getCurrentDate (): string {
  return fmtDate(getLocalDateNoTime())
}

/**
 * Get date one week from now in YYYY-MM-DD format
 */
export function getDateOneWeekLater (): string {
  const date = getLocalDateNoTime()
  date.setDate(date.getDate() + 7)
  return fmtDate(date)
}
