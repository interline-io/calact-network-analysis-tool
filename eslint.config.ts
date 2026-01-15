// @ts-check
import { createConfigForNuxt } from '@nuxt/eslint-config/flat'
import { stylisticConfig, ignoreFiles, eslintStylisticRules, eslintTypescriptRules } from 'tlv2-ui/lib/config'

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
