import { computed, type Ref } from 'vue'
import { useElementSize } from '@vueuse/core'

// The page's text over a drawing that scales to its frame, in the drawing's
// units: the text's size, and the height of a row of labels.
//
// Labels laid over such a drawing keep the page's text size as the drawing
// scales, so they are laid out by these, which follow the frame's width.
export function useDrawingText (frame: Ref<HTMLElement | undefined>, viewWidth: number) {
  const { width } = useElementSize(frame)
  return computed(() => {
    // Drawing units per pixel, taken as one until the frame is measured.
    const scale = width.value > 0 ? viewWidth / width.value : 1
    const px = Number.parseFloat(getComputedStyle(frame.value ?? document.documentElement).fontSize)
    // A row holds a line of text at line-height 1, and a little space.
    return { size: px * scale, row: (px + 4) * scale }
  })
}
