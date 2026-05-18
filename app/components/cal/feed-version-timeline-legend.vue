<template>
  <div class="cal-fv-legend" role="group" aria-label="Timeline legend">
    <div class="cal-fv-legend-item">
      <span class="swatch swatch-coverage" />
      <span>Feed version coverage</span>
    </div>
    <div class="cal-fv-legend-item">
      <span class="swatch swatch-service-low" />
      <span class="swatch swatch-service-mid" />
      <span class="swatch swatch-service-high" />
      <span>Daily service</span>
    </div>
    <div class="cal-fv-legend-item">
      <span class="swatch swatch-no-service" />
      <span>No scheduled service</span>
    </div>
    <div class="cal-fv-legend-item">
      <span class="swatch swatch-window" />
      <span>Analysis window</span>
    </div>
    <div class="cal-fv-legend-item">
      <span class="swatch swatch-feedinfo-outside" />
      <span>Outside feed_info dates</span>
    </div>
  </div>
</template>

<style scoped>
.cal-fv-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 16px 20px;
  align-items: center;
  padding: 8px 12px;
  margin: 8px 0 12px;
  border: 1px solid var(--bulma-border, #e0e0e0);
  border-radius: 4px;
  background: #fafafa;
  font-size: 0.85rem;
  color: #444;
}
.cal-fv-legend-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.swatch {
  display: inline-block;
  width: 14px;
  height: 14px;
  border-radius: 2px;
  vertical-align: middle;
}
.swatch-coverage {
  background: rgba(29, 111, 184, 0.06);
  border: 1px solid rgba(29, 111, 184, 0.4);
}
.swatch-service-low  { background: rgba(29, 111, 184, 0.2); }
.swatch-service-mid  { background: rgba(29, 111, 184, 0.6); }
.swatch-service-high { background: rgba(29, 111, 184, 1.0); }
.swatch-no-service {
  background: rgba(29, 111, 184, 0.08);
}
.swatch-window {
  background: transparent;
  border: 2px solid #d8b440;
}
.swatch-feedinfo-outside {
  /* 0% bucket background so the hatch reads cleanly, not muddled by tint. */
  background-color: rgba(29, 111, 184, 0.08);
  background-image: repeating-linear-gradient(
    45deg,
    rgba(0, 0, 0, 0.18) 0,
    rgba(0, 0, 0, 0.18) 1px,
    transparent 1px,
    transparent 4px
  );
}
</style>
