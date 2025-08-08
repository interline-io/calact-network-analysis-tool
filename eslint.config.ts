import type { ResolvableFlatConfig } from 'eslint-flat-config-utils'
import withNuxt from './.nuxt/eslint.config.mjs'
import { eslintRules } from './node_modules/tlv2-ui/dist/runtime/config/eslint.js'

// @ts-expect-error Yes it's ironic that we need to ignore linting rules in the lint config.
const rulesCopy: ResolvableFlatConfig = { rules: { ...eslintRules } }
export default withNuxt(
  rulesCopy
)
