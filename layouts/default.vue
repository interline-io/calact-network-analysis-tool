<template>
  <div class="outer">
    <tlnav />

    <div class="main">
      <div class="container">
        <tl-breadcrumbs
          :boxed="false"
        />

        <slot />
      </div>
    </div>
    <tlfooter />
  </div>
</template>

<script setup>
useHead({
  titleTemplate: (titleChunk) => {
    return titleChunk ? `Playground • ${titleChunk}` : 'Playground'
  }
})
</script>

<style scoped>
.main {
  flex:1;
}
.footer {
  padding:20px;
}

.outer {
  display:flex;
  min-height:100vh;
  flex-direction:column;
}

.main {
  flex:1;
}

.main {
  flex:1;
  padding-top: 20px;
  padding-left:20px;
  padding-right:20px;
  padding-bottom:20px;
}
</style>
