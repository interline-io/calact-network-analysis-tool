<template>
  <div class="cal-vehicle-player box" :style="{ left: playerLeft }">
    <div class="cal-vehicle-player-controls">
      <cat-button
        icon="stop"
        v-bind="{ ariaLabel: 'Stop', title: 'Stop and return to midnight' }"
        @click="stop"
      />
      <cat-button
        icon="rewind"
        v-bind="{ ariaLabel: 'Rewind', title: 'Play backward', ariaPressed: direction === -1 }"
        @click="play(-1)"
      />
      <cat-button
        icon="step-backward"
        v-bind="{ ariaLabel: 'Step back', title: 'Back one minute' }"
        @click="step(-STEP_SECONDS)"
      />
      <cat-button
        :icon="direction === 1 ? 'pause' : 'play'"
        v-bind="{ ariaLabel: direction === 1 ? 'Pause' : 'Play' }"
        @click="direction === 1 ? pause() : play(1)"
      />
      <cat-button
        icon="step-forward"
        v-bind="{ ariaLabel: 'Step forward', title: 'Forward one minute' }"
        @click="step(STEP_SECONDS)"
      />
      <cat-select v-model="speed" v-bind="{ ariaLabel: 'Playback speed' }">
        <option v-for="s of SPEEDS" :key="s" :value="String(s)">
          {{ s }}×
        </option>
      </cat-select>
      <cat-select v-model="trailOption" v-bind="{ ariaLabel: 'Trail length' }">
        <option v-for="m of TRAIL_MINUTES" :key="m" :value="String(m)">
          {{ m === 0 ? 'No trail' : `${m} min trail` }}
        </option>
      </cat-select>
      <span class="cal-vehicle-player-clock">
        {{ formatGtfsTime(Math.floor(time)) }}
      </span>
      <span v-if="date">{{ fmtDate(date, 'EEE, MMM d, yyyy') }}</span>
    </div>
    <cat-slider
      v-model="time"
      :min="0"
      :max="SECONDS_PER_DAY"
      :step="STEP_SECONDS"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { fmtDate, formatGtfsTime } from '~~/src/core'

const SECONDS_PER_DAY = 86400
const STEP_SECONDS = 60
// Playback seconds per real second.
const SPEEDS = [1, 10, 60, 300, 900]
// How far back a vehicle's trail reaches, in schedule minutes.
const TRAIL_MINUTES = [0, 2, 5, 10, 20, 30, 60]

const props = defineProps<{
  // The vehicles' service day, for the label.
  date?: Date
  // Pixels of the map's left side covered by an open panel.
  panelWidth?: number
}>()

// Centered on the part of the map the panel leaves uncovered.
const playerLeft = computed(() => {
  const inset = props.panelWidth ?? 0
  return `calc(${inset}px + (100% - ${inset}px) / 2)`
})

// Seconds from midnight of the day.
const time = defineModel<number>('time', { default: 0 })
// Schedule seconds a trail takes to fade out; 0 draws none.
const trailSeconds = defineModel<number>('trailSeconds', { default: 0 })
// In minutes and as a string, as cat-select models its options.
const trailOption = computed({
  get: () => String(trailSeconds.value / 60),
  set: (v: string) => { trailSeconds.value = Number(v) * 60 },
})

// 1 plays forward, -1 backward, 0 is paused.
const direction = ref<-1 | 0 | 1>(0)
// A string, as cat-select models its options.
const speed = ref('60')

function play (d: -1 | 1) {
  // At the end of the day, playing forward starts again from midnight; at
  // midnight, rewinding starts from the end.
  if (d === 1 && time.value >= SECONDS_PER_DAY) {
    time.value = 0
  }
  if (d === -1 && time.value <= 0) {
    time.value = SECONDS_PER_DAY
  }
  direction.value = d
}

function pause () {
  direction.value = 0
}

function stop () {
  direction.value = 0
  time.value = 0
}

function step (seconds: number) {
  direction.value = 0
  time.value = Math.min(SECONDS_PER_DAY, Math.max(0, time.value + seconds))
}

// The playback clock advances with real time between animation frames.
let frame: number | undefined
let lastFrameAt: number | undefined

function tick (now: number) {
  if (lastFrameAt !== undefined) {
    const next = time.value + direction.value * Number(speed.value) * (now - lastFrameAt) / 1000
    time.value = Math.min(SECONDS_PER_DAY, Math.max(0, next))
    if (next <= 0 || next >= SECONDS_PER_DAY) {
      pause()
      return
    }
  }
  lastFrameAt = now
  frame = requestAnimationFrame(tick)
}

function stopTicking () {
  if (frame !== undefined) {
    cancelAnimationFrame(frame)
  }
  frame = undefined
  lastFrameAt = undefined
}

watch(direction, (d) => {
  stopTicking()
  if (d !== 0) {
    frame = requestAnimationFrame(tick)
  }
})

onBeforeUnmount(stopTicking)
</script>

<style scoped lang="scss">
.cal-vehicle-player {
  position: absolute;
  bottom: 12px;
  transform: translateX(-50%);
  z-index: 9;
  margin-bottom: 0;
}

.cal-vehicle-player-controls {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.cal-vehicle-player-clock {
  font-variant-numeric: tabular-nums;
  margin-left: auto;
}
</style>
