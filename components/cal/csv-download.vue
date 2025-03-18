<template>
  <div>
    <button :disabled="disabled" class="button" style="margin-right:10px" @click="saveFile">
      <o-icon icon="download" /> <span>{{ buttonText }}</span>
    </button>
  </div>
</template>

<script>
import { stringify } from 'csv-stringify/browser/esm/sync'

function dataToBlob (csvData) {
  const keys = {}
  if (csvData.length > 0) {
    for (const k of Object.keys(csvData[0])) {
      keys[k] = k
    }
  }
  const data = stringify(
    csvData,
    {
      header: true,
      columns: keys
    })
  const blob = new Blob([data], { type: 'application/csv' })
  return blob
}

export default {
  props: {
    buttonText: { type: String, default () { return 'Download as CSV' } },
    disabled: { type: Boolean, default: false },
    filename: { type: String, default: 'export' },
    data: { type: Array, default () { return [] } }
  },
  methods: {
    async saveFile () {
      const blob = await dataToBlob(this.data)
      const e = document.createEvent('MouseEvents')
      const a = document.createElement('a')
      a.download = this.$filters.sanitizeFilename(this.filename + '.csv')
      a.href = window.URL.createObjectURL(blob)
      a.dataset.downloadurl = ['text/csv', a.download, a.href].join(':')
      e.initEvent('click', true, false, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null)
      a.dispatchEvent(e)
    }
  }
}
</script>
