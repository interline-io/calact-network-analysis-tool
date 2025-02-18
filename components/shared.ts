import { computed } from 'vue'
import { type Bbox, parseBbox, bboxString, parseDate, fmtDate } from '../components/geom'
import { navigateTo } from '#imports'

const defaultBbox = '-121.21911,43.99134,-121.40447,44.12326'

const route = useRoute()

export const startDate = computed(() => {
  return parseDate(route.query.startDate?.toString() || '') || new Date()
})

export const endDate = computed(() => {
  return parseDate(route.query.endDate?.toString() || '') || new Date()
})

export const bbox = computed(() => {
  const bbox = route.query.bbox?.toString() ?? defaultBbox
  return parseBbox(bbox)
})

export async function setStartDate (v: Date) {
  await navigateTo({ query: { ...route.query, startDate: fmtDate(v) } })
}

export async function setEndDate (v: Date) {
  await navigateTo({ query: { ...route.query, endDate: fmtDate(v) } })
}

export async function setBbox (v: Bbox) {
  console.log('setBbox', v)
  await navigateTo({ replace: true, query: { ...route.query, bbox: bboxString(v) } })
}