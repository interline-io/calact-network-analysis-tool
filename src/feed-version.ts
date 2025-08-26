import { gql } from 'graphql-tag'

export interface FeedVersion {
  id: string
  sha1: string
  feed: {
    id: number
    onestop_id: string
  }
}

export const feedVersionQuery = gql`
query ($where: FeedFilter) {
  feeds(where: $where) {
    id
    onestop_id
    feed_state {
      feed_version {
        id
        sha1
        feed {
          id
          onestop_id
        }
      }
    }
  }
}`

export interface FeedGql {
  id: string
  onestop_id: string
  feed_state: {
    feed_version: FeedVersion
  }
}
