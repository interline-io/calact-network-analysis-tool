<template>
  <aside class="menu">
    <cat-fieldset label="Units of measurement">
      <ul>
        <li>
          <cat-radio
            v-model="unitSystem"
            native-value="us"
          >
            🇺🇸 USA
          </cat-radio>
        </li>
        <li>
          <cat-radio
            v-model="unitSystem"
            native-value="eu"
          >
            🇪🇺 Metric
          </cat-radio>
        </li>
      </ul>
    </cat-fieldset>
  </aside>
</template>

<script setup lang="ts">
const { unitSystem } = useScenarioDisplay()
</script>
