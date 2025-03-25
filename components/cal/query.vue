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
            <o-tooltip multiline label="By default, the end date is one week after the start date.">
              End date
              <o-icon icon="information" />
            </o-tooltip>
          </template>
          <o-datepicker v-if="!selectSingleDay" v-model="endDate" />
          <o-button @click="toggleSelectSingleDay()">
            {{ selectSingleDay ? 'Set an end date' : 'Remove end date' }}
          </o-button>
        </o-field>
      </tl-msg-box>

      <tl-msg-box variant="text" title="Geographic Bounds">
        <div class="columns">
          <div class="column is-half">
            <o-field>
              <template #label>
                <o-tooltip multiline label="Specify the area of interest for your query. In the future, there will be additional options including selection of Census geographies. The area is used to query for transit stops, as well as the routes that serve those stops. Note that routes that traverse the area without any designated stops will not be identified.">
                  Select geography by
                  <o-icon icon="information" />
                </o-tooltip>
              </template>
              <o-select v-model="geomSource">
                <option value="mapExtent" selected>
                  Covering extent of map
                </option>
                <option value="bbox">
                  Dragging bounding box
                </option>
              </o-select>

              <tl-msg-warning class="mt-4" style="width:400px">
                Debug: use predefined bbox<br>
                <o-select v-model="cannedBbox">
                  <option v-for="cannedBboxName of cannedBboxes.keys()" :key="cannedBboxName" :value="cannedBboxName">
                    {{ cannedBboxName }}
                  </option>
                </o-select>
              </tl-msg-warning>

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
import { type Bbox, parseBbox } from '../geom'
import { cannedBboxes } from '../constants'
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
const cannedBbox = ref('')
const selectSingleDay = ref(true)
const toggleSelectSingleDay = useToggle(selectSingleDay)

watch(() => cannedBbox.value, (cannedBboxName) => {
  if (cannedBboxName) {
    emit('setBbox', parseBbox(cannedBboxes.get(cannedBboxName)))
  }
})

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
