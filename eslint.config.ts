import type { ResolvableFlatConfig } from 'eslint-flat-config-utils'
import { eslintRules } from 'tlv2-ui/config'
import withNuxt from './.nuxt/eslint.config.mjs'

// @ts-expect-error Yes it's ironic that we need to ignore linting rules in the lint config.
const rulesCopy: ResolvableFlatConfig = { rules: { ...eslintRules } }
export default withNuxt(
  rulesCopy
)
