// The GeoJSON file uploaded on the Query tab (#477): the parsed file, the
// features chosen from it, and the cleaned-up query area. Kept for the session
// rather than in the URL, as the geometry is too large for a link; saving the
// upload is what makes it shareable. No fetching, so any component can use it.

import { markRaw } from 'vue'
import {
  DEFAULT_UPLOAD_PROCESS_OPTIONS,
  parseGeographyUpload,
  processUpload,
  UploadError,
  type ParsedUpload,
  type ProcessedUpload,
  type UploadProcessOptions,
} from '~~/src/core'

export interface UploadedGeography {
  filename: string
  parsed: ParsedUpload
  // Indexes of the chosen features
  selected: number[]
  options: UploadProcessOptions
  // The chosen features, cleaned up; null when none are chosen
  result: ProcessedUpload | null
}

export function useUploadedGeography () {
  // Geometry is held raw: deep reactivity over tens of thousands of positions
  // would cost more than the processing itself
  const upload = useState<UploadedGeography | null>('cal-uploaded-geography', () => null)
  const uploadError = useState<string>('cal-uploaded-geography-error', () => '')

  function reprocess (u: Omit<UploadedGeography, 'result'>) {
    const features = u.parsed.features.filter(f => u.selected.includes(f.index))
    const result = features.length > 0 ? markRaw(processUpload(features, u.options)) : null
    upload.value = { ...u, result }
  }

  // Reads a file's text; throws nothing, setting uploadError instead
  function loadFile (filename: string, text: string) {
    uploadError.value = ''
    try {
      const parsed = markRaw(parseGeographyUpload(text))
      reprocess({
        filename,
        parsed,
        selected: parsed.features.map(f => f.index),
        options: { ...DEFAULT_UPLOAD_PROCESS_OPTIONS },
      })
    } catch (e) {
      upload.value = null
      uploadError.value = e instanceof UploadError ? e.message : `Couldn't read this file: ${String(e)}`
    }
  }

  function setSelected (selected: number[]) {
    if (upload.value) {
      reprocess({ ...upload.value, selected })
    }
  }

  function setOptions (options: UploadProcessOptions) {
    if (upload.value) {
      reprocess({ ...upload.value, options })
    }
  }

  function clear () {
    upload.value = null
    uploadError.value = ''
  }

  return { upload, uploadError, loadFile, setSelected, setOptions, clear }
}
