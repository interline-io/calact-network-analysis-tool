import { computed, type ComputedRef } from 'vue'
import { useRoute, navigateTo } from '#imports'
import { fmtDate, parseDate, fmtTime, parseTime } from '~/src/datetime'
import { bboxString, parseBbox, type Bbox } from '~/src/geom'

export interface QueryParamConfig<T> {
  defaultValue: T
  serialize?: (value: T) => string | undefined
  deserialize?: (value: string | undefined) => T
}

export function useQueryParams () {
  const route = useRoute()

  async function setQuery (params: Record<string, any>) {
    await navigateTo({ replace: true, query: removeEmpty({ ...route.query, ...params }) })
  }

  function removeEmpty (v: Record<string, any>): Record<string, any> {
    const r: Record<string, any> = {}
    for (const k in v) {
      if (v[k] || k === 'selectedDays') { // selectedDays is special case
        r[k] = v[k]
      }
    }
    return r
  }

  function createQueryParam<T> (
    key: string,
    config: QueryParamConfig<T>
  ): ComputedRef<T> {
    return computed({
      get (): T {
        const rawValue = route.query[key]?.toString()
        if (config.deserialize) {
          return config.deserialize(rawValue)
        }
        return rawValue as T ?? config.defaultValue
      },
      set (value: T) {
        const serialized = config.serialize ? config.serialize(value) : String(value)
        setQuery({ [key]: serialized })
      }
    })
  }

  // String parameter
  function stringParam (key: string, defaultValue: string = ''): ComputedRef<string> {
    return createQueryParam(key, {
      defaultValue,
      serialize: value => value || undefined,
      deserialize: value => value || defaultValue
    })
  }

  // Boolean parameter
  function booleanParam (key: string, defaultValue: boolean = false): ComputedRef<boolean> {
    return createQueryParam(key, {
      defaultValue,
      serialize: value => value ? 'true' : undefined,
      deserialize: value => value === 'true'
    })
  }

  // Number parameter
  function numberParam (key: string, defaultValue: number = 0): ComputedRef<number> {
    return createQueryParam(key, {
      defaultValue,
      serialize: value => value.toString(),
      deserialize: value => parseInt(value || '') || defaultValue
    })
  }

  // Array parameter
  function arrayParam<T = string> (
    key: string,
    defaultValue: T[] = [],
    itemDeserialize?: (item: string) => T
  ): ComputedRef<T[]> {
    return createQueryParam<T[]>(key, {
      defaultValue,
      serialize: value => value.length > 0 ? value.map(String).join(',') : undefined,
      deserialize: (value) => {
        if (!value) return defaultValue
        const items = value.split(',').filter(Boolean)
        return itemDeserialize
          ? items.map(itemDeserialize)
          : items as T[]
      }
    })
  }

  // Date parameter
  function dateParam (key: string, defaultValue: Date): ComputedRef<Date> {
    return createQueryParam(key, {
      defaultValue,
      serialize: value => fmtDate(value),
      deserialize: value => parseDate(value || '') || defaultValue
    })
  }

  // Time parameter
  function timeParam (key: string, defaultValue: Date): ComputedRef<Date> {
    return createQueryParam(key, {
      defaultValue,
      serialize: value => fmtTime(value),
      deserialize: value => parseTime(value || '') || defaultValue
    })
  }

  // Bbox parameter
  function bboxParam (key: string, defaultValue: string): ComputedRef<Bbox> {
    return createQueryParam(key, {
      defaultValue: parseBbox(defaultValue),
      serialize: value => bboxString(value),
      deserialize: value => parseBbox(value ?? defaultValue)
    })
  }

  return {
    setQuery,
    removeEmpty,
    createQueryParam,
    stringParam,
    booleanParam,
    numberParam,
    arrayParam,
    dateParam,
    timeParam,
    bboxParam
  }
}
