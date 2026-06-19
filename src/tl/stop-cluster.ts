import { gql } from 'graphql-tag'

// Stop clustering (#330): the only server-side step is the proximity test.
// `nearby_stops(radius)` resolves to a PostGIS ST_DWithin search, so "which
// stops are within X meters of which" is answered by the backend — the client
// never does geometry. Each scenario stop is returned with its agencies/routes
// (for the cross-agency rule) and its in-radius neighbor ids (the cluster edges).

export const stopClusterQuery = gql`
query ($limit: Int, $after: Int, $where: StopFilter, $radius: Float, $nearbyLimit: Int) {
  stops(limit: $limit, after: $after, where: $where) {
    id
    route_stops {
      route {
        id
        agency {
          id
        }
      }
    }
    nearby_stops(radius: $radius, limit: $nearbyLimit) {
      id
    }
  }
}`

// Raw GraphQL shape for one stop in the cluster query response.
export interface StopClusterStopResponse {
  id: number
  route_stops: {
    route: {
      id: number
      agency: {
        id: number
      }
    }
  }[]
  nearby_stops: {
    id: number
  }[]
}
