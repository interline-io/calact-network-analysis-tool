import { describe, it, expect } from 'vitest'
import {
  normalizeDate,
  normalizeTime,
  parseDate,
  fmtDate,
  parseTime,
  fmtTime,
  asDate,
  asTime,
  asDateString,
  asTimeString,
  getLocalDateNoTime,
  getUTCDateNoTime,
  parseHMS,
  dateToSeconds
} from './datetime'

describe('normalizeDate', () => {
  it('strips time components from a valid date', () => {
    const d = new Date(2024, 6, 15, 14, 30, 45, 123)
    const result = normalizeDate(d)!
    expect(result.getFullYear()).toBe(2024)
    expect(result.getMonth()).toBe(6)
    expect(result.getDate()).toBe(15)
    expect(result.getHours()).toBe(0)
    expect(result.getMinutes()).toBe(0)
    expect(result.getSeconds()).toBe(0)
    expect(result.getMilliseconds()).toBe(0)
  })

  it('returns undefined for undefined input', () => {
    expect(normalizeDate(undefined)).toBeUndefined()
  })

  it('returns undefined for an invalid date', () => {
    expect(normalizeDate(new Date('not-a-date'))).toBeUndefined()
  })
})

describe('normalizeTime', () => {
  it('normalizes date component to 2020-01-01 and keeps time', () => {
    const d = new Date(2024, 6, 15, 14, 30, 45, 123)
    const result = normalizeTime(d)!
    expect(result.getFullYear()).toBe(2020)
    expect(result.getMonth()).toBe(0) // January
    expect(result.getHours()).toBe(14)
    expect(result.getMinutes()).toBe(30)
    expect(result.getSeconds()).toBe(45)
    expect(result.getMilliseconds()).toBe(0)
  })

  it('returns undefined for undefined input', () => {
    expect(normalizeTime(undefined)).toBeUndefined()
  })

  it('returns undefined for an invalid date', () => {
    expect(normalizeTime(new Date('invalid'))).toBeUndefined()
  })
})

describe('parseDate', () => {
  it('parses a valid yyyy-MM-dd string', () => {
    const result = parseDate('2024-07-15')!
    expect(result.getFullYear()).toBe(2024)
    expect(result.getMonth()).toBe(6) // July = 6 (0-indexed)
    expect(result.getDate()).toBe(15)
    expect(result.getHours()).toBe(0)
  })

  it('returns undefined for undefined input', () => {
    expect(parseDate(undefined)).toBeUndefined()
  })

  it('returns undefined for empty string', () => {
    expect(parseDate('')).toBeUndefined()
  })

  it('returns undefined for an invalid date string', () => {
    expect(parseDate('not-a-date')).toBeUndefined()
  })

  it('parses boundary dates', () => {
    const jan1 = parseDate('2020-01-01')!
    expect(jan1.getFullYear()).toBe(2020)
    expect(jan1.getMonth()).toBe(0)
    expect(jan1.getDate()).toBe(1)

    const dec31 = parseDate('2024-12-31')!
    expect(dec31.getFullYear()).toBe(2024)
    expect(dec31.getMonth()).toBe(11)
    expect(dec31.getDate()).toBe(31)
  })

  // Out-of-range dates: date-fns parse rejects these (unlike JS Date constructor)
  it('returns undefined for January 32', () => {
    expect(parseDate('2024-01-32')).toBeUndefined()
  })

  it('returns undefined for January 0', () => {
    expect(parseDate('2024-01-00')).toBeUndefined()
  })

  it('returns undefined for February 30', () => {
    expect(parseDate('2024-02-30')).toBeUndefined()
  })

  it('returns undefined for February 29 in non-leap year', () => {
    expect(parseDate('2023-02-29')).toBeUndefined()
  })

  it('parses February 29 in leap year', () => {
    const result = parseDate('2024-02-29')!
    expect(result).toBeDefined()
    expect(result.getMonth()).toBe(1)
    expect(result.getDate()).toBe(29)
  })

  it('returns undefined for month 13', () => {
    expect(parseDate('2024-13-01')).toBeUndefined()
  })

  it('returns undefined for month 00', () => {
    expect(parseDate('2024-00-01')).toBeUndefined()
  })

  it('returns undefined for negative day', () => {
    expect(parseDate('2024-01--1')).toBeUndefined()
  })
})

describe('fmtDate', () => {
  it('formats a valid date with default format', () => {
    const d = new Date(2024, 6, 15)
    expect(fmtDate(d)).toBe('2024-07-15')
  })

  it('formats a valid date with custom format', () => {
    const d = new Date(2024, 6, 15)
    expect(fmtDate(d, 'MM/dd/yyyy')).toBe('07/15/2024')
  })

  it('formats with P (locale short date)', () => {
    const d = new Date(2024, 6, 15)
    // 'P' produces locale-dependent output, just check it's non-empty
    expect(fmtDate(d, 'P')).toBeTruthy()
  })

  it('returns empty string for undefined', () => {
    expect(fmtDate(undefined)).toBe('')
  })

  it('returns empty string for invalid date', () => {
    expect(fmtDate(new Date('invalid'))).toBe('')
  })

  it('returns empty string for NaN date', () => {
    expect(fmtDate(new Date(NaN))).toBe('')
  })
})

describe('parseTime', () => {
  it('parses a valid HH:mm:ss string', () => {
    const result = parseTime('14:30:45')!
    expect(result.getHours()).toBe(14)
    expect(result.getMinutes()).toBe(30)
    expect(result.getSeconds()).toBe(45)
    // Date component should be normalized to 2020-01-01
    expect(result.getFullYear()).toBe(2020)
    expect(result.getMonth()).toBe(0)
  })

  it('parses midnight', () => {
    const result = parseTime('00:00:00')!
    expect(result.getHours()).toBe(0)
    expect(result.getMinutes()).toBe(0)
    expect(result.getSeconds()).toBe(0)
  })

  it('parses end of day', () => {
    const result = parseTime('23:59:59')!
    expect(result.getHours()).toBe(23)
    expect(result.getMinutes()).toBe(59)
    expect(result.getSeconds()).toBe(59)
  })

  it('returns undefined for undefined input', () => {
    expect(parseTime(undefined)).toBeUndefined()
  })

  it('returns undefined for empty string', () => {
    expect(parseTime('')).toBeUndefined()
  })

  it('returns undefined for invalid time string', () => {
    expect(parseTime('not-a-time')).toBeUndefined()
  })

  // Out-of-range times: date-fns parse rejects these
  it('returns undefined for hour 25', () => {
    expect(parseTime('25:00:00')).toBeUndefined()
  })

  it('returns undefined for hour 24', () => {
    expect(parseTime('24:00:00')).toBeUndefined()
  })

  it('returns undefined for minute 60', () => {
    expect(parseTime('12:60:00')).toBeUndefined()
  })

  it('returns undefined for second 60', () => {
    expect(parseTime('12:00:60')).toBeUndefined()
  })

  it('returns undefined for negative hour', () => {
    expect(parseTime('-1:00:00')).toBeUndefined()
  })

  it('returns undefined for partial time (HH:mm only)', () => {
    expect(parseTime('12:30')).toBeUndefined()
  })
})

describe('fmtTime', () => {
  it('formats a valid time with default format', () => {
    const d = new Date(2020, 0, 1, 14, 30, 45)
    expect(fmtTime(d)).toBe('14:30:45')
  })

  it('formats a valid time with custom format', () => {
    const d = new Date(2020, 0, 1, 14, 30, 45)
    expect(fmtTime(d, 'h:mm a')).toBe('2:30 PM')
  })

  it('formats with p (locale short time)', () => {
    const d = new Date(2020, 0, 1, 14, 30, 0)
    expect(fmtTime(d, 'p')).toBeTruthy()
  })

  it('returns empty string for undefined', () => {
    expect(fmtTime(undefined)).toBe('')
  })

  it('returns empty string for invalid date', () => {
    expect(fmtTime(new Date('invalid'))).toBe('')
  })

  it('returns empty string for NaN date', () => {
    expect(fmtTime(new Date(NaN))).toBe('')
  })
})

describe('asDate', () => {
  it('converts a valid date string to a Date', () => {
    const result = asDate('2024-07-15')!
    expect(result.getFullYear()).toBe(2024)
    expect(result.getMonth()).toBe(6)
    expect(result.getDate()).toBe(15)
  })

  it('converts a Date object by normalizing it', () => {
    const input = new Date(2024, 6, 15, 10, 30, 0)
    const result = asDate(input)!
    expect(result.getFullYear()).toBe(2024)
    expect(result.getHours()).toBe(0) // time stripped
  })

  it('returns undefined for invalid string', () => {
    expect(asDate('garbage')).toBeUndefined()
  })

  it('returns undefined for undefined (cast as Date)', () => {
    expect(asDate(undefined)).toBeUndefined()
  })

  it('returns undefined for null (cast as Date)', () => {
    expect(asDate(null)).toBeUndefined()
  })

  it('returns undefined for a number', () => {
    expect(asDate(1234567890000)).toBeUndefined()
  })

  it('returns undefined for a boolean', () => {
    expect(asDate(true)).toBeUndefined()
  })
})

describe('asTime', () => {
  it('converts a valid time string to a Date', () => {
    const result = asTime('09:15:30')!
    expect(result.getHours()).toBe(9)
    expect(result.getMinutes()).toBe(15)
    expect(result.getSeconds()).toBe(30)
  })

  it('converts a Date object by normalizing it as a time', () => {
    const input = new Date(2024, 6, 15, 9, 15, 30)
    const result = asTime(input)!
    expect(result.getFullYear()).toBe(2020)
    expect(result.getHours()).toBe(9)
    expect(result.getMinutes()).toBe(15)
  })

  it('returns undefined for invalid string', () => {
    expect(asTime('nope')).toBeUndefined()
  })

  it('returns undefined for undefined', () => {
    expect(asTime(undefined)).toBeUndefined()
  })

  it('returns undefined for a number', () => {
    expect(asTime(1234567890000)).toBeUndefined()
  })

  it('returns undefined for null', () => {
    expect(asTime(null)).toBeUndefined()
  })
})

describe('asDateString', () => {
  it('converts a valid date string to canonical format', () => {
    expect(asDateString('2024-07-15')).toBe('2024-07-15')
  })

  it('converts a Date object to a date string', () => {
    const d = new Date(2024, 6, 15, 10, 30)
    expect(asDateString(d)).toBe('2024-07-15')
  })

  it('returns undefined for invalid input', () => {
    expect(asDateString('garbage')).toBeUndefined()
  })

  it('returns undefined for undefined', () => {
    expect(asDateString(undefined)).toBeUndefined()
  })

  it('returns undefined for null', () => {
    expect(asDateString(null)).toBeUndefined()
  })
})

describe('asTimeString', () => {
  it('converts a valid time string to canonical format', () => {
    expect(asTimeString('09:15:30')).toBe('09:15:30')
  })

  it('converts a Date object to a time string', () => {
    const d = new Date(2024, 6, 15, 9, 15, 30)
    expect(asTimeString(d)).toBe('09:15:30')
  })

  it('returns undefined for invalid input', () => {
    expect(asTimeString('garbage')).toBeUndefined()
  })

  it('returns undefined for undefined', () => {
    expect(asTimeString(undefined)).toBeUndefined()
  })
})

describe('getLocalDateNoTime', () => {
  it('returns today at midnight local time', () => {
    const now = new Date()
    const result = getLocalDateNoTime()
    expect(result.getFullYear()).toBe(now.getFullYear())
    expect(result.getMonth()).toBe(now.getMonth())
    expect(result.getDate()).toBe(now.getDate())
    expect(result.getHours()).toBe(0)
    expect(result.getMinutes()).toBe(0)
    expect(result.getSeconds()).toBe(0)
    expect(result.getMilliseconds()).toBe(0)
  })
})

describe('getUTCDateNoTime', () => {
  it('returns today at midnight UTC', () => {
    const now = new Date()
    const result = getUTCDateNoTime()
    expect(result.getUTCFullYear()).toBe(now.getUTCFullYear())
    expect(result.getUTCMonth()).toBe(now.getUTCMonth())
    expect(result.getUTCDate()).toBe(now.getUTCDate())
    // Time components should be 0 (constructed via local Date constructor with UTC values)
    expect(result.getHours()).toBe(0)
    expect(result.getMinutes()).toBe(0)
    expect(result.getSeconds()).toBe(0)
  })
})

describe('parseHMS', () => {
  it('parses a valid HH:mm:ss to seconds', () => {
    expect(parseHMS('01:00:00')).toBe(3600)
    expect(parseHMS('00:01:00')).toBe(60)
    expect(parseHMS('00:00:01')).toBe(1)
    expect(parseHMS('12:30:45')).toBe(12 * 3600 + 30 * 60 + 45)
  })

  it('parses midnight as 0', () => {
    expect(parseHMS('00:00:00')).toBe(0)
  })

  it('parses 23:59:59', () => {
    expect(parseHMS('23:59:59')).toBe(23 * 3600 + 59 * 60 + 59)
  })

  it('handles GTFS times beyond 24 hours', () => {
    // GTFS allows times like 25:00:00 for services past midnight
    expect(parseHMS('25:00:00')).toBe(25 * 3600)
  })

  it('returns -1 for undefined', () => {
    expect(parseHMS(undefined)).toBe(-1)
  })

  it('returns -1 for empty string', () => {
    expect(parseHMS('')).toBe(-1)
  })

  it('returns -1 for invalid format (too few parts)', () => {
    expect(parseHMS('12:30')).toBe(-1)
  })

  it('returns -1 for non-numeric parts', () => {
    expect(parseHMS('ab:cd:ef')).toBe(-1)
  })

  it('returns -1 for completely invalid string', () => {
    expect(parseHMS('not-a-time')).toBe(-1)
  })
})

describe('dateToSeconds', () => {
  it('converts a Date to seconds since midnight', () => {
    const d = new Date(2024, 6, 15, 14, 30, 45)
    expect(dateToSeconds(d)).toBe(14 * 3600 + 30 * 60 + 45)
  })

  it('returns 0 for midnight', () => {
    const d = new Date(2024, 6, 15, 0, 0, 0)
    expect(dateToSeconds(d)).toBe(0)
  })

  it('returns correct value for end of day', () => {
    const d = new Date(2024, 6, 15, 23, 59, 59)
    expect(dateToSeconds(d)).toBe(23 * 3600 + 59 * 60 + 59)
  })

  it('returns undefined for undefined', () => {
    expect(dateToSeconds(undefined)).toBeUndefined()
  })
})

describe('roundtrip consistency', () => {
  it('parseDate -> fmtDate roundtrips correctly', () => {
    const original = '2024-07-15'
    const parsed = parseDate(original)
    expect(fmtDate(parsed)).toBe(original)
  })

  it('parseTime -> fmtTime roundtrips correctly', () => {
    const original = '14:30:45'
    const parsed = parseTime(original)
    expect(fmtTime(parsed)).toBe(original)
  })

  it('asDateString roundtrips a date string', () => {
    expect(asDateString('2024-12-25')).toBe('2024-12-25')
  })

  it('asTimeString roundtrips a time string', () => {
    expect(asTimeString('08:00:00')).toBe('08:00:00')
  })
})
