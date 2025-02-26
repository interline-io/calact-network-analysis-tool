<template>
  <div class="cal-query">
    <tl-title title="Home">
      Transit Network Explorer
    </tl-title>

    <tl-msg-info>
      Specify your desired date range and geographic bounds. Then click <em>Run Query</em>.
    </tl-msg-info>

    <div class="cal-body">
      <tl-msg-box variant="text" title="Date range">
        <o-field>
        <template #label>
          <o-tooltip multiline label="The start date is used to define which week is used to calculate the days-of-week on which a route runs or a stop is served.">
            Start date
            <o-icon icon="information" />
          </o-tooltip>
        </template>
        <o-datepicker v-model="startDate" />
      </o-field>
      <o-field addons>
        <template #label>
          <o-tooltip multiline label="The end date is not currently used. In the future, it will be used to define the end of date-bound queries.">
            End date
            <o-icon icon="information" />
          </o-tooltip>
        </template>
        <o-datepicker v-model="endDate" v-if="!selectSingleDay" />
        <o-button @click="toggleSelectSingleDay()" title="In the future, you will be able to specify an end date for date-bound queries.">
          {{ selectSingleDay ? 'Set an end date' : 'Remove end date' }}
        </o-button>
      </o-field>
    </tl-msg-box>

      <tl-msg-box variant="text" title="Geographic Bounds">
        <div class="columns">
          <div class="column is-half">
            <o-field>
              <template #label>
                <o-tooltip multiline label="Specify the area of interest for your query. In the future, there will be additional options including selection of Census geographies.">
                  Select geography by
                  <o-icon icon="information" />
                </o-tooltip>
              </template>
              <o-select v-model="geomSource">
                <option value="mapExtent" selected>
                  Current extent of map
                </option>
                <option value="bbox">
                  Bounding box on map
                </option>
              </o-select>
              <!-- <div class="cal-bbox-info">
                <div style="text-align:center">
                  <o-button icon-left="pin">
                    Select on map
                  </o-button>
                </div>
                <o-field label="SW Corner">
                  <o-input type="text" :value="ptString(props.bbox.sw)" />
                </o-field>
                <o-field label="NE Corner">
                  <o-input type="text" :value="ptString(props.bbox.ne)" />
                </o-field>
              </div> -->
            </o-field>
          </div>
        </div>
      </tl-msg-box>
      <o-button variant="primary" :disabled="!validQueryParams" class="is-fullwidth is-large" @click="emit('explore')">
        Run Query
      </o-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { type Bbox, ptString, } from '../geom'
import { useToggle } from '@vueuse/core'

const props = defineProps<{
  bbox: Bbox
}>()

const emit = defineEmits([
  'setBbox',
  'explore'
])

const startDate = defineModel<Date>('startDate')
const endDate = defineModel<Date>('endDate')
const geomSource = defineModel<string>('geomSource')
const selectSingleDay = ref(true)
const toggleSelectSingleDay = useToggle(selectSingleDay)

const validQueryParams = computed(() => {
  return startDate.value && props.bbox?.valid
})

</script>

<style scoped lang="scss">
.cal-query {
  display:flex;
  flex-direction:column;
  background: var(--bulma-scheme-main);
  height:100%;
  padding-left:20px;
  padding-right:20px;
  > .cal-body {
      > div, > article
       {
      margin-bottom:10px;
    }

    }
  }

  .cal-bbox-info {
    background:#ccc;
    margin-top:10px;
    padding:10px;
  }
  </style>
