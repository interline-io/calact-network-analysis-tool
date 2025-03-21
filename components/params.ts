import { fmtDate, fmtTime, parseDate, parseTime, getLocalDateNoTime } from './datetime'

interface ScenarioParams {
    geomSource: WritableComputedRef<string>
    startDate: WritableComputedRef<Date>
}

export const useScenarioParams = (): ScenarioParams => {
    const p = {
        geomSource: ref(''),
        startDate: ref(new Date())
    }
    const route = useRoute()
    const setQuery = async (params: Record<string, any>) => {
        await navigateTo({ replace: true, query: removeEmpty({ ...route.query, ...params }) })
    }

    return {
        geomSource: computed({
            get () {
              return route.query.geomSource?.toString() || 'bbox'
            },
            set (v: string) {
              setQuery({ ...route.query, geomSource: v })
            }
          }),
        startDate: computed({
            get () {
              return parseDate(route.query.startDate?.toString() || '') || getLocalDateNoTime()
            },
            set (v: Date) {
              setQuery({ ...route.query, startDate: fmtDate(v) })
            }
          })
    } as ScenarioParams
}

function removeEmpty (v: Record<string, any>): Record<string, any> {
    const r: Record<string, any> = {}
    for (const k in v) {
        r[k] = v[k]
    }
    return r
  }