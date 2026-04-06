// @ts-check
import { createConfigForNuxt } from '@nuxt/eslint-config/flat'

// Inlined from @interline-io/tlv2-ui/lib/config (removing tlv2-ui dependency)
const stylisticConfig = {
  flat: true,
  indent: 2,
  quotes: 'single' as const,
  semi: false,
}

const ignoreFiles = {
  ignores: [
    '.nuxt/**',
    '.output/**',
    '**/.nuxt',
    'dist/**',
    'node_modules/**',
  ],
}

const eslintTypescriptRules = {
  'no-console': 'off',
  '@typescript-eslint/no-explicit-any': 'off',
  '@typescript-eslint/unified-signatures': 'off',
}

const eslintStylisticRules = {
  'vue/multi-word-component-names': 'off',
  'vue/max-attributes-per-line': ['error', {
    singleline: { max: 10 },
    multiline: { max: 1 },
  }],
  '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: true }],
  '@stylistic/space-before-function-paren': ['error', {
    anonymous: 'always',
    named: 'always',
    asyncArrow: 'always',
  }],
  '@stylistic/comma-dangle': 'off',
  '@stylistic/max-statements-per-line': ['error', { max: 3 }],
}

// Run `npx @eslint/config-inspector` to inspect the resolved config interactively
export default createConfigForNuxt({
  features: {
    // Rules for formatting
    stylistic: stylisticConfig,
    // Enable strict TypeScript rules
    typescript: {
      strict: true,
    },
  },
  dirs: {
  },
})
  .prepend(
    // Explicitly ignore node_modules and build outputs
    ignoreFiles,
  )
  .append(
    // your custom flat config here...
    {
      rules: {
        ...eslintTypescriptRules,
        ...eslintStylisticRules,
        // Require curly braces around all control statements
        curly: ['error', 'all'],
      },
    },
  )
