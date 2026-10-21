<script setup lang="ts">
import { VdCard } from '@granum-fixtures/valued-ds/components/VdCard'
import { VdGroup } from '@granum-fixtures/valued-ds/components/VdGroup'
</script>

<template>
  <main class="mx-auto flex max-w-3xl flex-col gap-6 p-8">
    <div data-theme="stale-light">
      <VdCard>
        <p>Остров устаревшей темы: зазор группы она не задаёт — его не было в 0.9.</p>
        <VdGroup :items="['Один', 'Два']" />
      </VdCard>
    </div>
  </main>
</template>
