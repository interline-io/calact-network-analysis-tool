#!/bin/bash
export NUXT_GRAPHQL_APIKEY=$TRANSITLAND_API_KEY
export NUXT_GRAPHQL_SERVER_REFERER="http://localhost:3000"
export NUXT_PROXY_BASE="https://api.transit.land/api/v2"
export NUXT_PUBLIC_API_BASE=http://localhost:3000/api/v2
export NUXT_PUBLIC_AUTH0_AUDIENCE="https://api.transit.land"
export NUXT_PUBLIC_AUTH0_CLIENT_ID="GwwocjhHGFR9dfOv2kFgebRhx79GRh0B"
export NUXT_PUBLIC_AUTH0_DOMAIN="https://auth.interline.io"
export NUXT_PUBLIC_AUTH0_REDIRECT_URI="http://localhost:3000/"
export NUXT_PUBLIC_AUTH0_SCOPE="profile email openid"
export NUXT_PUBLIC_GRAPHQL_SERVER_REFERER="http://localhost:3000"
export NUXT_PUBLIC_LOGIN_GATE='true'
export NUXT_PUBLIC_PROTOMAPS_APIKEY=$PROTOMAPS_APIKEY
yarn install && yarn dev