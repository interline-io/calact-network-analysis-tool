<template>
  <t-button icon-left="download" :disabled="disabled" @click="saveFile">
    {{ buttonText }}
  </t-button>
</template>

<script>
import stringify from '@aitodotai/json-stringify-pretty-compact'

function dataToBlob (features) {
  const geojson = {
    type: 'FeatureCollection',
    features: features
  }
  const blob = new Blob([stringify(geojson, { maxLength: 100 })], { type: 'application/geo+json' })
  return blob
}

export default {
  props: {
    buttonText: { type: String, default () { return 'Download as GeoJSON' } },
    disabled: { type: Boolean, default: false },
    filename: { type: String, default: 'export' },
    data: { type: Array, default () { return [] } },
  },
  methods: {
    async saveFile () {
      const blob = await dataToBlob(this.data)
      const e = document.createEvent('MouseEvents')
      const a = document.createElement('a')
      a.download = this.$filters.sanitizeFilename(this.filename + '.geojson')
      a.href = window.URL.createObjectURL(blob)
      a.dataset.downloadurl = ['application/geo+json', a.download, a.href].join(':')
      e.initEvent('click', true, false, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null)
      a.dispatchEvent(e)
    }
  }
}
</script>
