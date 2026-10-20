<script setup lang="ts">
import { TdButton } from '@granum-fixtures/themed-ds/components/TdButton'
import { TdCard } from '@granum-fixtures/themed-ds/components/TdCard'
</script>

<template>
  <main class="mx-auto grid max-w-3xl grid-cols-2 gap-6 p-8">
    <section class="flex flex-col gap-3">
      <TdCard>Активная тема <code>paper</code></TdCard>
      <TdButton>Кнопка</TdButton>
    </section>
    <section data-theme="ink-light" class="flex flex-col gap-3">
      <TdCard>Превью <code>ink</code></TdCard>
      <TdButton>Кнопка</TdButton>
    </section>
  </main>
</template>
