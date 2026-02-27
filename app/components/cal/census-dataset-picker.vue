<template>
  <t-field>
    <template #label>
      <t-tooltip v-if="props.tooltip" :text="props.tooltip">
        {{ props.label }}
        <t-icon icon="information" />
      </t-tooltip>
      <template v-else>
        {{ props.label }}
      </template>
    </template>
    <t-select v-model="modelValue">
      <option v-if="loading && modelValue" :value="modelValue">
        {{ modelValue }}
      </option>
      <option
        v-for="ds of filteredDatasets"
        :key="ds.name"
        :value="ds.name"
      >
        {{ ds.description || ds.name }}
      </option>
    </t-select>
  </t-field>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useQuery } from '@vue/apollo-composable'
import { type CensusDataset, censusDatasetListQuery } from '~~/src/tl'

const props = defineProps<{
  label?: string
  tooltip?: string
  nameFilter?: string
}>()

const modelValue = defineModel<string>({ required: true })

const { result, loading } = useQuery<{ census_datasets: CensusDataset[] }>(censusDatasetListQuery)

const filteredDatasets = computed(() => {
  const datasets = result.value?.census_datasets || []
  if (!props.nameFilter) {
    return datasets
  }
  const prefix = props.nameFilter.toLowerCase()
  return datasets.filter(ds => ds.name.toLowerCase().startsWith(prefix))
})
</script>
