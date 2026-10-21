<script setup lang="ts">
import VdButton from '../VdButton/VdButton.vue'

defineProps<{ readonly items: readonly string[] }>()
</script>

<template>
  <div class="inline-flex gap-[var(--vd-group-gap)] p-1 border border-[var(--vd-accent)] rounded-[var(--vd-button-radius)] bg-[var(--vd-bg)]">
    <VdButton v-for="item in items" :key="item">
      {{ item }}
    </VdButton>
  </div>
</template>
