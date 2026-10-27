<template>
  <div class="cal-geography-upload">
    <div
      class="cal-geography-upload-drop"
      :class="{ 'is-dragging': dragging }"
      @dragenter.prevent="dragging = true"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <cat-icon icon="cloud-upload" />
      <label class="button is-small">
        <input
          ref="fileInput"
          type="file"
          accept=".geojson,.json,application/geo+json,application/json"
          class="cal-geography-upload-input"
          @change="onFileInput"
        >
        {{ upload ? 'Choose another file' : 'Choose a file to upload' }}
      </label>
      <p class="help">
        or drag and drop a GeoJSON file here
      </p>
    </div>

    <p v-if="reading" class="help">
      <cat-icon icon="loading" size="small" />
      Checking {{ readingName }}…
    </p>
    <p v-if="uploadError" class="help is-danger" role="alert">
      {{ uploadError }}
    </p>

    <div v-if="upload" class="cal-geography-upload-summary">
      <p class="help">
        <strong>{{ upload.filename }}</strong>:
        {{ upload.parsed.features.length }} polygon {{ upload.parsed.features.length === 1 ? 'feature' : 'features' }}<span v-if="upload.parsed.skipped > 0">
          ({{ upload.parsed.skipped }} without polygons skipped)</span>
      </p>

      <cat-field v-if="upload.parsed.features.length > 1" label="Features to include">
        <div class="cal-geography-upload-actions">
          <cat-button variant="ghost" size="small" @click="setSelected(allIndexes)">
            Select all
          </cat-button>
          <cat-button variant="ghost" size="small" @click="setSelected([])">
            Select none
          </cat-button>
        </div>
        <ul class="cal-geography-upload-features">
          <li v-for="f of upload.parsed.features" :key="f.index">
            <cat-checkbox
              :model-value="upload.selected.includes(f.index)"
              @update:model-value="toggleFeature(f.index, !!$event)"
            >
              {{ f.name }}
            </cat-checkbox>
          </li>
        </ul>
      </cat-field>

      <template v-if="upload.result">
        <p class="help">
          {{ upload.result.vertexCount.toLocaleString() }} points<span v-if="upload.result.vertexCount !== upload.result.originalVertexCount">
            (from {{ upload.result.originalVertexCount.toLocaleString() }})</span>
        </p>
      </template>
      <p v-else class="help is-danger">
        Choose at least one feature.
      </p>

      <cat-msg title="Upload options" variant="light" expandable class="cal-geography-upload-options">
        <ul>
          <li>
            <cat-checkbox :model-value="upload.options.trimPrecision" @update:model-value="setOption('trimPrecision', !!$event)">
              Round coordinates to about 1 m
            </cat-checkbox>
          </li>
          <li>
            <cat-checkbox :model-value="upload.options.simplify" @update:model-value="setOption('simplify', !!$event)">
              Simplify outlines (details under about 15 m)
            </cat-checkbox>
          </li>
        </ul>
        <p class="help">
          Every request in a query carries the area, and finer detail than this rarely changes a transit analysis. Turn these off to use the file's outlines as they are.
        </p>
      </cat-msg>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { UPLOAD_MAX_FILE_BYTES, type UploadProcessOptions } from '~~/src/core'
import { useUploadedGeography } from '~/composables/useUploadedGeography'

const emit = defineEmits<{
  // A new file was read, for the parent to fit the map to it
  loaded: []
}>()

const { upload, uploadError, loadFile, setSelected, setOptions } = useUploadedGeography()

const dragging = ref(false)
const reading = ref(false)
const readingName = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

const allIndexes = computed(() => upload.value?.parsed.features.map(f => f.index) ?? [])

// Processing a large file holds the page for a second or so; this lets the
// "Checking" line paint first
function afterPaint (): Promise<void> {
  return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)))
}

async function busy (name: string, fn: () => void) {
  readingName.value = name
  reading.value = true
  await nextTick()
  await afterPaint()
  try {
    fn()
  } finally {
    reading.value = false
  }
}

async function readFile (file: File) {
  if (file.size > UPLOAD_MAX_FILE_BYTES) {
    uploadError.value = `This file is ${(file.size / 1024 / 1024).toFixed(0)} MB. Upload a GeoJSON file of at most ${UPLOAD_MAX_FILE_BYTES / 1024 / 1024} MB.`
    return
  }
  const text = await file.text()
  await busy(file.name, () => loadFile(file.name, text))
  if (upload.value) {
    emit('loaded')
  }
}

function onFileInput (e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) {
    void readFile(file)
  }
  // Choosing the same file again should read it again
  if (fileInput.value) {
    fileInput.value.value = ''
  }
}

function onDrop (e: DragEvent) {
  dragging.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file) {
    void readFile(file)
  }
}

function toggleFeature (index: number, on: boolean) {
  const selected = new Set(upload.value?.selected ?? [])
  if (on) {
    selected.add(index)
  } else {
    selected.delete(index)
  }
  void busy('the features', () => setSelected([...selected].sort((a, b) => a - b)))
}

function setOption (key: keyof UploadProcessOptions, value: boolean) {
  if (!upload.value) {
    return
  }
  const options = { ...upload.value.options, [key]: value }
  void busy('the outlines', () => setOptions(options))
}
</script>

<style scoped lang="scss">
.cal-geography-upload-drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.75rem;
  border: 2px dashed var(--bulma-border);
  border-radius: 6px;
  &.is-dragging {
    border-color: var(--bulma-link);
    background: var(--bulma-link-light, #eef3fc);
  }
}

// Hidden but still focusable through its label
.cal-geography-upload-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.cal-geography-upload-drop label:focus-within {
  outline: 2px solid var(--bulma-link);
  outline-offset: 2px;
}

.cal-geography-upload-summary {
  margin-top: 0.5rem;
}

.cal-geography-upload-actions {
  display: flex;
  gap: 0.25rem;
}

.cal-geography-upload-features {
  list-style: none;
  margin: 0;
  max-height: 12rem;
  overflow-y: auto;
}

.cal-geography-upload-options {
  margin-top: 0.5rem;
  ul {
    list-style: none;
    margin: 0;
  }
}
</style>
