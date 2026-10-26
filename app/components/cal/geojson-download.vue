<template>
  <cat-button icon-left="download" :disabled="disabled" :variant="variant" :size="size" @click="saveFile">
    {{ buttonText }}
  </cat-button>
</template>

<script>
import stringify from '@aitodotai/json-stringify-pretty-compact'
import { useDownload } from '@interline-io/catenary'

export default {
  props: {
    buttonText: { type: String, default () { return 'Download as GeoJSON' } },
    disabled: { type: Boolean, default: false },
    filename: { type: String, default: 'export' },
    data: { type: Array, default () { return [] } },
    variant: { type: String, default: undefined },
    size: { type: String, default: undefined },
  },
  methods: {
    saveFile () {
      const geojson = { type: 'FeatureCollection', features: this.data }
      useDownload().download({ filename: this.filename + '.geojson', data: stringify(geojson, { maxLength: 100 }), mimeType: 'application/geo+json' })
    }
  }
}
</script>
