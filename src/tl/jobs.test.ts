import { describe, expect, it } from 'vitest'
import { jobHeading, jobTiming, type JobStatus } from './jobs'

function status (overrides: Partial<JobStatus> = {}): JobStatus {
  return { state: 'running', job: { kind: 'feed-version-import' }, ...overrides }
}

describe('jobHeading', () => {
  it('labels import jobs with the feed version id when present', () => {
    const s = status({ job: { kind: 'feed-version-import', args: { feed_version_id: 1234 } } })
    expect(jobHeading('feed-version-import', s)).toBe('Importing feed version 1234')
  })

  it('labels unimport jobs with the feed version id when present', () => {
    const s = status({ job: { kind: 'feed-version-unimport', args: { feed_version_id: 99 } } })
    expect(jobHeading('feed-version-unimport', s)).toBe('Unimporting feed version 99')
  })

  it('falls back to a queue-only label before the status has landed', () => {
    expect(jobHeading('feed-version-import', null)).toBe('Importing feed version')
    expect(jobHeading('feed-version-unimport', undefined)).toBe('Unimporting feed version')
  })

  it('labels unknown queues generically', () => {
    expect(jobHeading('rt-fetch', status())).toBe('Job: rt-fetch')
    expect(jobHeading('', null)).toBe('Job status')
  })
})

describe('jobTiming', () => {
  const now = new Date('2026-06-09T12:00:00Z')

  it('returns empty for missing status or timestamps', () => {
    expect(jobTiming(null, now)).toBe('')
    expect(jobTiming(status(), now)).toBe('')
  })

  it('shows run duration when started and finished', () => {
    const s = status({
      started_at: '2026-06-09T11:59:00Z',
      finished_at: '2026-06-09T11:59:45Z',
    })
    expect(jobTiming(s, now)).toBe('Ran for 45 seconds')
  })

  it('falls back to finished-ago when finished precedes started', () => {
    const s = status({
      started_at: '2026-06-09T11:59:45Z',
      finished_at: '2026-06-09T11:59:00Z',
    })
    expect(jobTiming(s, now)).toMatch(/^Finished .* ago$/)
  })

  it('shows running duration relative to now', () => {
    const s = status({ started_at: '2026-06-09T11:59:42Z' })
    expect(jobTiming(s, now)).toBe('Running for 18 seconds')
  })

  it('clamps a started_at slightly ahead of the client clock', () => {
    const s = status({ started_at: '2026-06-09T12:00:02Z' })
    expect(jobTiming(s, now)).toBe('Running for 0 seconds')
  })

  it('shows submitted-ago when only submitted', () => {
    const s = status({ submitted_at: '2026-06-09T11:59:58Z' })
    expect(jobTiming(s, now)).toBe('Submitted 2 seconds ago')
  })

  it('ignores invalid timestamps', () => {
    const s = status({ submitted_at: 'not-a-date' })
    expect(jobTiming(s, now)).toBe('')
  })
})
