import { isValid, parse, format, set } from 'date-fns'

const dateFmt = 'yyyy-MM-dd'
const timeFmt = 'HH:mm:ss'

/**
 * Normalize a date by removing its time component (sets time to '00:00:00').
 * @param d - Date object to normalize as date only, no time
 * @returns Normalized date object, or undefined if the input is not a valid date
 */
export function normalizeDate (d: Date | undefined): Date | undefined {
  return isValid(d) ? set(d!, { hours: 0, minutes: 0, seconds: 0, milliseconds: 0 }) : undefined
}

/**
 * Normalize a time by removing its date component (sets date to '2020-01-01').
 * (removes any milliseconds too)
 * @param d - Date object to normalize as a time only, no date
 * @returns Normalized date object, or undefined if the input is not a valid date
 */
export function normalizeTime (d: Date | undefined): Date | undefined {
  return isValid(d) ? set(d!, { year: 2020, month: 1, date: 1, milliseconds: 0 }) : undefined
}

/**
 * Parse a date string in yyyy-MM-dd format to a Date object.
 * @param s - Date string in yyyy-MM-dd format
 * @returns Date object or undefined if parsing fails
 */
export function parseDate (s: string | undefined): Date | undefined {
  let d
  if (s) {
    d = parse(s, dateFmt, new Date())
  }
  return normalizeDate(d)
}

/**
 * Format a Date object to a string.
 * @param d - Date object to format
 * @param fmt - Format string (defaults to yyyy-MM-dd)
 * @returns Formatted date string or empty string if date is invalid
 */
export function fmtDate (d: Date | undefined, fmt: string = dateFmt): string {
  return isValid(d) ? format(d!, fmt) : ''
}

/**
 * Parse a time string in HH:mm:ss format to a Date object.
 * @param s - Time string in HH:mm:ss format
 * @returns Date object with time set or undefined if parsing fails
 */
export function parseTime (s: string | undefined): Date | undefined {
  let d
  if (s) {
    d = parse(s, timeFmt, new Date(2020, 1, 1))
  }
  return normalizeTime(d)
}

/**
 * Format a Date object to a time string.
 * @param d - Date object to format
 * @param fmt - Format string (defaults to HH:mm:ss)
 * @returns Formatted time string or empty string if date is invalid
 */
export function fmtTime (d: Date | undefined, fmt: string = timeFmt): string {
  return isValid(d) ? format(d!, fmt) : ''
}

/**
 * Try to convert the given unknown-typed value to a date.
 * @param val - value to treat as a date
 * @returns Date object or undefined if val is not a valid date
 */
export function asDate (val: unknown): Date | undefined {
  if (typeof val === 'string') {
    return parseDate(val)
  } else {
    return normalizeDate(val as Date)
  }
}

/**
 * Try to convert the given unknown-typed value to a time.
 * @param val - value to treat as a time
 * @returns Date object or undefined if val is not a valid time
 */
export function asTime (val: unknown): Date | undefined {
  if (typeof val === 'string') {
    return parseTime(val)
  } else {
    return normalizeTime(val as Date)
  }
}

/**
 * Try to convert the given unknown-typed value to a date string.
 * Basically, look for a valid date, then put it into our preferred date string format.
 * @param val - value to turn into a date string
 * @returns date string as 'yyyy-MM-dd', or undefined if val is not a valid date
 */
export function asDateString (val: unknown): string | undefined {
  return fmtDate(asDate(val)) || undefined
}

/**
 * Try to convert the given unknown-typed value to a time string.
 * Basically, look for a valid time, then put it into our preferred time string format.
 * @param val - value to turn into a time string
 * @returns time string as 'HH:mm:ss', or undefined if val is not a valid time
 */
export function asTimeString (val: unknown): string | undefined {
  return fmtTime(asTime(val)) || undefined
}

/**
 * Get current date in local timezone as a normalized date.
 * @returns Date object representing today at 00:00:00 local time
 */
export function getLocalDateNoTime (): Date {
  return normalizeDate(new Date()) as Date
}

/**
 * Get current date in UTC timezone with time set to midnight.
 * @returns Date object representing today at 00:00:00 UTC
 */
export function getUTCDateNoTime (): Date {
  const now = new Date()
  return new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
}

/**
 * Parse a time string in HH:mm:ss format to seconds since midnight
 * @param value - Time string in HH:mm:ss format
 * @returns Total seconds since midnight, or -1 if parsing fails
 */
export function parseHMS (value: string | undefined): number {
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
 * @returns Seconds since midnight (0-86399), or undefined if time is undefined
 */
export function dateToSeconds (time: Date | undefined): number | undefined {
  if (!time) { return undefined }
  return time.getHours() * 3600 + time.getMinutes() * 60 + time.getSeconds()
}
