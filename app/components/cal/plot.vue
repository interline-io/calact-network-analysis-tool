<template>
  <figure ref="container" class="cal-plot" role="img" :aria-label="label" />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as Plot from '@observablehq/plot'

// An Observable Plot chart at its container's width, redrawn when the width
// or the options change. Assistive technology reads the chart as one image
// named by `label`, so give its data in a table beside the chart.
const props = defineProps<{
  // The chart's options for a given width, in pixels.
  options: (width: number) => Plot.PlotOptions
  label: string
}>()

const container = ref<HTMLElement>()
let width = 0

function draw () {
  const el = container.value
  if (!el || width <= 0) {
    return
  }
  const options = props.options(width)
  const chart = Plot.plot({
    ...options,
    width,
    // Text and rules in the page's font and the theme's text color, on a
    // transparent background.
    style: { background: 'transparent', color: 'var(--bulma-text)', font: 'inherit' },
  })
  chart.setAttribute('aria-hidden', 'true')
  el.replaceChildren(chart)
}

let observer: ResizeObserver | undefined
// One redraw per frame while the width is changing.
let frame: number | undefined
onMounted(() => {
  observer = new ResizeObserver((entries) => {
    const next = Math.floor(entries[0]?.contentRect.width ?? 0)
    if (next !== width) {
      width = next
      frame ??= requestAnimationFrame(() => {
        frame = undefined
        draw()
      })
    }
  })
  if (container.value) {
    observer.observe(container.value)
  }
})
onBeforeUnmount(() => {
  observer?.disconnect()
  if (frame !== undefined) {
    cancelAnimationFrame(frame)
  }
})

watch(() => props.options, draw)
</script>

<style scoped lang="scss">
.cal-plot {
  margin: 0 0 1rem;
  min-width: 0;
}
</style>
