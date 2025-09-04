<template>
  <o-button
    :icon-left="isGenerating ? 'loading' : 'download'"
    :disabled="disabled || isGenerating"
    @click="saveFile"
  >
    {{ isGenerating ? 'Generating...' : buttonText }}
  </o-button>
</template>

<script>
import { GeoPackageAPI, DataTypes } from '@ngageoint/geopackage'

async function dataToGeoPackage (features, filename) {
  // Create a new GeoPackage
  const geoPackage = await GeoPackageAPI.create()

  if (features.length === 0) {
    throw new Error('No features to export')
  }

  // Determine the geometry type from the first feature
  const firstFeature = features[0]
  const geometryType = firstFeature.geometry.type

  // Create a feature table
  const tableName = filename || 'features'
  const columns = []

  // Add columns based on properties of the first feature
  const properties = firstFeature.properties || {}
  for (const [key, value] of Object.entries(properties)) {
    let dataType = DataTypes.TEXT
    if (typeof value === 'number') {
      dataType = Number.isInteger(value) ? DataTypes.INTEGER : DataTypes.REAL
    } else if (typeof value === 'boolean') {
      dataType = DataTypes.BOOLEAN
    }

    columns.push({
      name: key,
      dataType: dataType
    })
  }

  // Create the feature table
  await geoPackage.createFeatureTable(tableName, columns, geometryType)

  // Get the feature DAO
  const featureDao = geoPackage.getFeatureDao(tableName)

  // Insert features
  for (const feature of features) {
    const featureRow = featureDao.newRow()

    // Set geometry
    featureRow.setGeometry(feature.geometry)

    // Set properties
    if (feature.properties) {
      for (const [key, value] of Object.entries(feature.properties)) {
        featureRow.setValueWithColumnName(key, value)
      }
    }

    await featureDao.create(featureRow)
  }

  // Export to buffer
  const buffer = await GeoPackageAPI.export(geoPackage)
  return new Blob([buffer], { type: 'application/geopackage+sqlite3' })
}

export default {
  props: {
    buttonText: { type: String, default () { return 'Download as GeoPackage' } },
    disabled: { type: Boolean, default: false },
    filename: { type: String, default: 'export' },
    data: { type: Array, default () { return [] } },
  },
  data () {
    return {
      isGenerating: false
    }
  },
  methods: {
    async saveFile () {
      if (this.data.length === 0) {
        useToastNotification().showToast('No data to export', 'warning')
        return
      }

      this.isGenerating = true

      try {
        const blob = await dataToGeoPackage(this.data, this.filename)
        const e = document.createEvent('MouseEvents')
        const a = document.createElement('a')
        a.download = this.$filters.sanitizeFilename(this.filename + '.gpkg')
        a.href = window.URL.createObjectURL(blob)
        a.dataset.downloadurl = ['application/geopackage+sqlite3', a.download, a.href].join(':')
        e.initEvent('click', true, false, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null)
        a.dispatchEvent(e)

        useToastNotification().showToast('GeoPackage file generated successfully!')
      } catch (error) {
        console.error('Error generating GeoPackage:', error)
        useToastNotification().showToast('Error generating GeoPackage file: ' + error.message, 'error')
      } finally {
        this.isGenerating = false
      }
    }
  }
}
</script>
