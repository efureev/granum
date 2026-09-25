<script setup lang="ts">
/**
 * Бейдж: акцентная пара токенов, которой нет больше нигде. Если она доехала
 * до дистрибутива приложения без бейджа — обрезка чего-то не увидела.
 */
</script>

<template>
  <span class="inline-block px-[var(--xxx-space-1)] bg-[var(--xxx-accent)] text-[var(--xxx-accent-fg)]">
    <slot />
  </span>
</template>
