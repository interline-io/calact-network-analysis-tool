import { gql } from 'graphql-tag'

// Stop clustering: the only server-side step is the proximity test.
// `nearby_stops(radius)` resolves to a PostGIS ST_DWithin search, so "which
// stops are within X meters of which" is answered by the backend — the client
// never does geometry. Each scenario stop is returned with its agencies/routes
// (for the cross-agency rule) and its in-radius neighbor ids (the cluster edges).

export const stopClusterQuery = gql`
query StopClusters($limit: Int, $after: Int, $where: StopFilter, $radius: Float, $nearbyLimit: Int) {
  stops(limit: $limit, after: $after, where: $where) {
    id
    # For naming the cluster after what its members' feeds call the place.
    stop_name
    feed_version {
      feed {
        onestop_id
      }
    }
    # Without an explicit limit the backend returns 100; 1000 is its maximum.
    route_stops(limit: 1000) {
      route_id
      agency_id
    }
    nearby_stops(radius: $radius, limit: $nearbyLimit) {
      id
    }
  }
}`

// Raw GraphQL shape for one stop in the cluster query response.
export interface StopClusterStopResponse {
  id: number
  stop_name?: string | null
  feed_version?: {
    feed: {
      onestop_id: string
    }
  }
  route_stops: {
    route_id: number
    agency_id: number
  }[]
  nearby_stops: {
    id: number
  }[]
}

// The stops around each cluster's center, by name and feed, for saying what
// better-known place a cluster is near. One request for every cluster; the
// radius test is PostGIS's.
export const stopClusterNearQuery = gql`
query StopClusterNear($ids: [Int!], $radius: Float, $nearbyLimit: Int) {
  stops(ids: $ids) {
    id
    nearby_stops(radius: $radius, limit: $nearbyLimit) {
      id
      stop_name
      feed_version {
        feed {
          onestop_id
        }
      }
    }
  }
}`

export interface StopClusterNearResponse {
  id: number
  nearby_stops: {
    id: number
    stop_name?: string | null
    feed_version?: {
      feed: {
        onestop_id: string
      }
    }
  }[] | null
}
