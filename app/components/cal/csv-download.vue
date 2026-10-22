<template>
  <cat-button icon-left="download" :disabled="disabled" :fullwidth="fullwidth" @click="saveFile">
    {{ buttonText }}
  </cat-button>
</template>

<script>
import { csvBlob, saveBlob } from '~/utils/download'

export default {
  props: {
    buttonText: { type: String, default () { return 'Download as CSV' } },
    disabled: { type: Boolean, default: false },
    fullwidth: { type: Boolean, default: false },
    filename: { type: String, default: 'export' },
    data: { type: Array, default () { return [] } }
  },
  methods: {
    saveFile () {
      saveBlob(csvBlob(this.data), this.filename + '.csv')
    }
  }
}
</script>
