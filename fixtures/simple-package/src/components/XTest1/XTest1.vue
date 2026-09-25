<script setup lang="ts">
</script>
<template>
  <div class="border border-[var(--brd)] p-4 x-sp-test">
    <slot />
  </div>
</template>
<style>
/* `@apply` раскрывается на сборке провайдера (B-11): в dist директивы нет. */
.x-sp-test {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  align-items: stretch;
  @apply text-lg font-bold text-red-500;
}
</style>
