import { describe, it, expect, vi, type Mock } from 'vitest'
import type { ScenarioConfig } from './scenario'
import { ScenarioFetcher } from './scenario'
import { parseDate, type Bbox, type GraphQLClient, SCENARIO_DEFAULTS } from '~~/src/core'
import type { FeedGql, FlexLocationGql } from '~~/src/tl'

/**
 * Mock GraphQL client for testing without real API calls
 */
export class MockGraphQLClient implements GraphQLClient {
  public mockQuery: Mock

  constructor () {
    this.mockQuery = vi.fn()
  }

  async query<T = any>(query: any, variables?: any): Promise<{ data?: T }> {
    return this.mockQuery(query, variables)
  }
}

describe('ScenarioFetcher', () => {
  const mockClient: MockGraphQLClient = new MockGraphQLClient()
  const config: ScenarioConfig = {
    reportName: 'Test Scenario',
    bbox: {
      sw: { lat: 45.4, lon: -122.8 },
      ne: { lat: 45.7, lon: -122.5 },
      valid: true
    } as Bbox,
    startDate: parseDate('2024-07-03'),
    endDate: parseDate('2024-07-10'),
    geographyIds: [],
    geoDatasetName: SCENARIO_DEFAULTS.geoDatasetName,
  }

  function makeFeedGql (id: string): FeedGql {
    return {
      id,
      onestop_id: `f-${id}`,
      feed_state: {
        feed_version: {
          id,
          sha1: `sha${id}`,
          feed: { id: parseInt(id, 10), onestop_id: `f-${id}` }
        }
      }
    }
  }

  it('should handle GraphQL errors', async () => {
    const mockError = new Error('GraphQL Error')
    mockClient.mockQuery.mockRejectedValue(mockError)

    const errorCallback = vi.fn()
    const fetcher = new ScenarioFetcher(config, mockClient, {
      onError: errorCallback
    })

    await expect(fetcher.fetch()).rejects.toThrow('GraphQL Error')
    expect(errorCallback).toHaveBeenCalledWith(mockError)
  })

  describe('feed version pagination', () => {
    const paginationConfig: ScenarioConfig = { ...config, includeFixedRoute: false, includeFlexAreas: false }

    it('makes a single query when fewer than 100 feeds are returned', async () => {
      const client = new MockGraphQLClient()
      const feeds = Array.from({ length: 5 }, (_, i) => makeFeedGql(String(i + 1)))
      client.mockQuery.mockResolvedValue({ data: { feeds } })

      const fetcher = new ScenarioFetcher(paginationConfig, client)
      await fetcher.fetch()

      expect(client.mockQuery).toHaveBeenCalledTimes(1)
    })

    it('paginates when the first page is full (100 feeds)', async () => {
      const client = new MockGraphQLClient()
      const page1 = Array.from({ length: 100 }, (_, i) => makeFeedGql(String(i + 1)))
      const page2 = Array.from({ length: 3 }, (_, i) => makeFeedGql(String(101 + i)))
      client.mockQuery
        .mockResolvedValueOnce({ data: { feeds: page1 } })
        .mockResolvedValueOnce({ data: { feeds: page2 } })

      const progressCb = vi.fn()
      const fetcher = new ScenarioFetcher(paginationConfig, client, { onProgress: progressCb })
      await fetcher.fetch()

      expect(client.mockQuery).toHaveBeenCalledTimes(2)
      expect(client.mockQuery.mock.calls[1][1]).toMatchObject({ after: 100 })
      const allFvSha1s = progressCb.mock.calls
        .flatMap(([p]) => (p.partialData?.feedVersions ?? []).map((fv: { sha1: string }) => fv.sha1))
      expect(allFvSha1s).toHaveLength(103)
    })

    it('throws on a non-integer pagination cursor', async () => {
      const client = new MockGraphQLClient()
      const page = [
        ...Array.from({ length: 99 }, (_, i) => makeFeedGql(String(i + 1))),
        makeFeedGql('not-a-number'),
      ]
      client.mockQuery.mockResolvedValue({ data: { feeds: page } })

      const fetcher = new ScenarioFetcher(paginationConfig, client)
      await expect(fetcher.fetch()).rejects.toThrow('Invalid pagination cursor')
    })
  })

  describe('concurrent flex fetching', () => {
    function makeFlexLocationGql (): FlexLocationGql {
      return {
        id: 1,
        location_id: 'loc-1',
        feed_onestop_id: 'f-test',
        geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
        stop_times: [{
          pickup_type: 0,
          drop_off_type: 0,
          trip: {
            trip_id: 'trip-1',
            route: {
              route_id: 'route-1',
              route_type: 3,
              agency: { agency_id: 'agency-1', agency_name: 'Test Agency' }
            }
          }
        }]
      }
    }

    const flexConfig: ScenarioConfig = { ...config, includeFixedRoute: false, includeFlexAreas: true }

    const threeFeedsResponse = { data: { feeds: [makeFeedGql('1'), makeFeedGql('2'), makeFeedGql('3')] } }

    function flexResponse (withLocations: boolean) {
      return {
        data: {
          feed_versions: [{
            id: 1,
            sha1: 'sha1',
            feed: { id: 1, onestop_id: 'f-test' },
            locations: withLocations ? [makeFlexLocationGql()] : []
          }]
        }
      }
    }

    it('streams flex areas per feed, skipping feeds with no active locations', async () => {
      const client = new MockGraphQLClient()
      client.mockQuery
        .mockResolvedValueOnce(threeFeedsResponse) // feed versions
        .mockResolvedValueOnce(flexResponse(true)) // fv1: has flex areas
        .mockResolvedValueOnce(flexResponse(false)) // fv2: no locations
        .mockResolvedValueOnce(flexResponse(true)) // fv3: has flex areas

      const progressCb = vi.fn()
      const fetcher = new ScenarioFetcher(flexConfig, client, { onProgress: progressCb })
      await fetcher.fetch()

      const flexProgressCalls = progressCb.mock.calls.filter(([p]) => p.partialData?.flexAreas?.length > 0)
      expect(flexProgressCalls).toHaveLength(2)
    })

    it('reports per-feed errors but completes processing of remaining feeds', async () => {
      const client = new MockGraphQLClient()
      client.mockQuery
        .mockResolvedValueOnce(threeFeedsResponse) // feed versions
        .mockResolvedValueOnce(flexResponse(true)) // fv1: success
        .mockRejectedValueOnce(new Error('network timeout')) // fv2: error
        .mockResolvedValueOnce(flexResponse(true)) // fv3: success

      const errorCb = vi.fn()
      const progressCb = vi.fn()
      const fetcher = new ScenarioFetcher(flexConfig, client, { onError: errorCb, onProgress: progressCb })
      await fetcher.fetch()

      expect(errorCb).toHaveBeenCalledTimes(1)
      expect(errorCb).toHaveBeenCalledWith(expect.any(Error))
      const flexProgressCalls = progressCb.mock.calls.filter(([p]) => p.partialData?.flexAreas?.length > 0)
      expect(flexProgressCalls).toHaveLength(2)
    })
  })

  it('should call progress callback during fetch', async () => {
    // Mock first call returns one stop, second call returns empty to end recursion
    mockClient.mockQuery
      .mockResolvedValueOnce({ data: { stops: [
        {
          id: 1,
          stop_id: 'stop_1',
          stop_name: 'Test Stop',
          location_type: 0,
          geometry: { type: 'Point', coordinates: [-122.6, 45.5] },
          census_geographies: [],
          route_stops: []
        }
      ] } })
      .mockResolvedValue({ data: { stops: [] } }) // All subsequent calls return empty

    const progressCallback = vi.fn()
    const fetcher = new ScenarioFetcher(config, mockClient, {
      onProgress: progressCallback
    })

    await fetcher.fetch()

    // Should be called at least twice (start loading, stop loading)
    expect(progressCallback).toHaveBeenCalledWith(
      expect.objectContaining({ isLoading: true })
    )
    expect(progressCallback).toHaveBeenCalledWith(
      expect.objectContaining({ isLoading: false })
    )
  })
})
