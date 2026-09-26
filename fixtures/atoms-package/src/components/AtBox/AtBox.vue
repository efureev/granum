<script setup lang="ts">
/**
 * Три класса встроенного словаря и один из правил самого пакета (`atom-frame`).
 * На нём видно расхождение диалектов: у чужого движка правила для `atom-*` нет
 * вовсе, и классы уезжают в `unmatched`.
 */
</script>

<template>
  <div class="atom-stack atom-gap-2 atom-frame atom-bg-[var(--at-bg)]">
    <slot />
  </div>
</template>
