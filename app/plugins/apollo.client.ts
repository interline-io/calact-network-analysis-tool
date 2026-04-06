import { ApolloClient, InMemoryCache, HttpLink } from '@apollo/client/core/index.js'
import { provideApolloClients } from '@vue/apollo-composable'
import { defineNuxtPlugin, useApiEndpoint } from '#imports'

export default defineNuxtPlugin((nuxtApp) => {
  const httpLink = new HttpLink({
    uri: useApiEndpoint('/query', 'default'),
  })

  const client = new ApolloClient({
    link: httpLink,
    cache: new InMemoryCache(),
  })

  nuxtApp.vueApp.runWithContext(() => {
    provideApolloClients({ default: client })
  })
})
