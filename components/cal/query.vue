<template>
  <div class="cal-query">
    <tl-title title="Home">
      Transit Network Explorer
    </tl-title>

    <tl-msg-info>
      Some information about this tool.
    </tl-msg-info>

    <div class="cal-body">
      <o-field grouped style="width:100%">
        <o-field label="Start date">
          <o-datepicker v-model="startDate" />
        </o-field>
        <o-field v-if="!selectSingleDay" label="End date">
          <o-datepicker v-model="endDate" />
        </o-field>
        <o-field label=".">
          <o-button @click="toggleSelectSingleDay()">
            {{ selectSingleDay ? 'Select start/end dates' : 'Select single day' }}
          </o-button>
        </o-field>
        <o-field label=".">
          <o-button variant="primary" @click="emit('explore')">
            Explore
          </o-button>
        </o-field>
      </o-field>

      <tl-msg-box variant="text" title="Geographic Bounds">
        <div class="columns">
          <div class="column is-one-third">
            <o-field label="Select geography by">
              <o-select v-model="geomSource">
                <option value="mapExtent" selected>
                  Map extent
                </option>
                <option value="bbox">
                  Bounding box
                </option>
              </o-select>
              <div class="cal-bbox-info">
                <div style="text-align:center">
                  <!-- <o-button icon-left="pin">
                    Select on map
                  </o-button> -->
                </div>
                <o-field label="SW Corner">
                  <o-input type="text" :value="ptString(props.bbox.sw)" />
                </o-field>
                <o-field label="NE Corner">
                  <o-input type="text" :value="ptString(props.bbox.ne)" />
                </o-field>
              </div>
            </o-field>
          </div>
        </div>
      </tl-msg-box>
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
const selectSingleDay = ref(false)
const toggleSelectSingleDay = useToggle(selectSingleDay)

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
