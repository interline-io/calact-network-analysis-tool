<template>
  <cat-button icon-left="download" :disabled="disabled" :fullwidth="fullwidth" @click="saveFile">
    {{ buttonText }}
  </cat-button>
</template>

<script>
import { useDownload } from '@interline-io/catenary'
import { csvString } from '~/utils/download'

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
      useDownload().download({ filename: this.filename + '.csv', data: csvString(this.data), mimeType: 'text/csv' })
    }
  }
}
</script>
