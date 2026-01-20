import { gql } from 'graphql-tag'
import type { GraphQLClient } from '~~/src/core'

/**
 * NTD Data Fetcher - A flexible utility for fetching and filtering NTD data
 *
 * This module provides server-side filtering of NTD census data to minimize
 * data transfer to clients. While the Transitland API doesn't support filtering
 * by fields within the values JSON, this fetcher handles pagination and applies
 * filters server-side before returning results.
 */

// GraphQL query to fetch NTD census values with cursor pagination
const ntdValuesQuery = gql`
query($first: Int, $after: String, $dataset: String!, $table: String) {
  census_datasets(where: {name: $dataset}) {
    values: values_relay(first: $first, after: $after, where: {
      table: $table
    }) {
      edges {
        node {
          geoid
          dataset_name
          values
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
}
`

interface NTDValuesResponse {
  census_datasets: {
    values: {
      edges: {
        node: NTDRawValue
        cursor: string
      }[]
      pageInfo: {
        hasNextPage: boolean
        endCursor: string
      }
    }
  }[]
}

/**
 * Raw NTD value from GraphQL response
 */
export interface NTDRawValue {
  geoid: string
  dataset_name: string
  values: Record<string, any>
}

/**
 * Configuration for NTD data fetching
 */
export interface NTDFetchConfig {
  /** NTD dataset name (default: 'ntd-annual-2024') */
  dataset?: string
  /** Table name within the dataset */
  table: string
  /** Page size for pagination (default: 5000) */
  pageSize?: number
}

/**
 * Filter configuration for NTD data
 * All filters are optional and applied server-side
 */
export interface NTDFilterConfig {
  /** Filter by state abbreviation (e.g., 'WA', 'CA') */
  state?: string
  /** Filter by report year */
  year?: number
  /** Filter by multiple years */
  years?: number[]
  /** Filter by NTD mode codes (e.g., ['MB', 'DR']) */
  modes?: string[]
  /** Filter by type of service (e.g., 'DO', 'PT') */
  typeOfService?: string[]
  /** Exclude non-UZA (rural) records */
  excludeNonUZA?: boolean
  /** Custom filter function for additional filtering */
  customFilter?: (value: NTDRawValue) => boolean
}

/**
 * Field name mappings for NTD data
 * Allows customization of field names for different tables
 */
export interface NTDFieldMappings {
  state?: string
  reportYear?: string
  mode?: string
  typeOfService?: string
  uzaName?: string
}

const DEFAULT_FIELD_MAPPINGS: Required<NTDFieldMappings> = {
  state: 'state',
  reportYear: 'report_year',
  mode: 'mode',
  typeOfService: 'type_of_service',
  uzaName: 'primary_uza_name',
}

/**
 * Progress callback for NTD fetching
 */
export type NTDProgressCallback = (info: {
  stage: 'fetching' | 'filtering' | 'complete'
  fetchedCount: number
  filteredCount: number
  hasMore: boolean
}) => void

/**
 * Fetch and filter NTD data from the Transitland API
 *
 * This function handles pagination automatically and applies filters
 * server-side to minimize data transfer. It's designed to be flexible
 * enough to support various NTD-based analyses.
 *
 * @param client - GraphQL client instance
 * @param fetchConfig - Configuration for data fetching
 * @param filterConfig - Filters to apply to the data
 * @param fieldMappings - Custom field name mappings
 * @param onProgress - Progress callback
 * @returns Filtered NTD values
 */
export async function fetchNTDData (
  client: GraphQLClient,
  fetchConfig: NTDFetchConfig,
  filterConfig: NTDFilterConfig = {},
  fieldMappings: NTDFieldMappings = {},
  onProgress?: NTDProgressCallback
): Promise<NTDRawValue[]> {
  const dataset = fetchConfig.dataset ?? 'ntd-annual-2024'
  const pageSize = fetchConfig.pageSize ?? 5000
  const fields = { ...DEFAULT_FIELD_MAPPINGS, ...fieldMappings }

  const filteredValues: NTDRawValue[] = []
  let hasNextPage = true
  let afterCursor: string | null = null
  let totalFetched = 0

  // Pre-compute filter values for efficiency
  const stateUpper = filterConfig.state?.toUpperCase()
  const yearSet = filterConfig.years
    ? new Set(filterConfig.years)
    : filterConfig.year
      ? new Set([filterConfig.year])
      : null
  const modeSet = filterConfig.modes ? new Set(filterConfig.modes) : null
  const tosSet = filterConfig.typeOfService ? new Set(filterConfig.typeOfService) : null

  while (hasNextPage) {
    const variables: Record<string, any> = {
      first: pageSize,
      dataset,
      table: fetchConfig.table,
    }
    if (afterCursor) {
      variables.after = afterCursor
    }

    onProgress?.({
      stage: 'fetching',
      fetchedCount: totalFetched,
      filteredCount: filteredValues.length,
      hasMore: true,
    })

    const result = await client.query<NTDValuesResponse>(ntdValuesQuery, variables)
    const resultDataset = result.data?.census_datasets?.[0]
    if (!resultDataset?.values?.edges) {
      break
    }

    // Apply filters to this batch
    for (const edge of resultDataset.values.edges) {
      const value = edge.node
      totalFetched++

      // Apply state filter
      if (stateUpper) {
        const valueState = String(value.values[fields.state] || '').toUpperCase()
        if (valueState !== stateUpper) {
          continue
        }
      }

      // Apply year filter
      if (yearSet) {
        const valueYear = parseInt(String(value.values[fields.reportYear] || 0), 10)
        if (!yearSet.has(valueYear)) {
          continue
        }
      }

      // Apply mode filter
      if (modeSet) {
        const valueMode = String(value.values[fields.mode] || '')
        if (!modeSet.has(valueMode)) {
          continue
        }
      }

      // Apply type of service filter
      if (tosSet) {
        const valueTos = String(value.values[fields.typeOfService] || '')
        if (!tosSet.has(valueTos)) {
          continue
        }
      }

      // Apply UZA filter
      if (filterConfig.excludeNonUZA) {
        const uzaName = String(value.values[fields.uzaName] || '')
        if (uzaName === '' || uzaName === 'N/A' || uzaName.includes('Non-UZA')) {
          continue
        }
      }

      // Apply custom filter
      if (filterConfig.customFilter && !filterConfig.customFilter(value)) {
        continue
      }

      filteredValues.push(value)
    }

    hasNextPage = resultDataset.values.pageInfo.hasNextPage
    afterCursor = resultDataset.values.pageInfo.endCursor

    onProgress?.({
      stage: 'filtering',
      fetchedCount: totalFetched,
      filteredCount: filteredValues.length,
      hasMore: hasNextPage,
    })
  }

  onProgress?.({
    stage: 'complete',
    fetchedCount: totalFetched,
    filteredCount: filteredValues.length,
    hasMore: false,
  })

  return filteredValues
}

/**
 * Get available years from the NTD dataset metadata
 */
export async function getNTDDatasetInfo (
  client: GraphQLClient,
  datasetName: string = 'ntd-annual-2024'
): Promise<{ yearMin: number | null, yearMax: number | null }> {
  const query = gql`
    query($name: String!) {
      census_datasets(where: {name: $name}) {
        year_min
        year_max
      }
    }
  `

  const result = await client.query<{
    census_datasets: { year_min: number | null, year_max: number | null }[]
  }>(query, { name: datasetName })

  const dataset = result.data?.census_datasets?.[0]
  return {
    yearMin: dataset?.year_min ?? null,
    yearMax: dataset?.year_max ?? null,
  }
}
