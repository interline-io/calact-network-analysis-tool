import { defineVitestConfig } from '@nuxt/test-utils/config'

export default defineVitestConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '.nuxt'],
    reporters: [
      [
        'default',
        {
          summary: false,
        },
      ],
    ],
  },
})
