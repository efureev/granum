<script setup lang="ts">
import { TdButton } from '@granum-fixtures/themed-ds/components/TdButton'
import { TdCard } from '@granum-fixtures/themed-ds/components/TdCard'
import { createThemeController } from '@feugene/granum/runtime'
import manifest from 'virtual:granum/themes'
import { ref } from 'vue'

// Лист `ink` грузится по адресу из манифеста, только когда тему включают.
const themes = createThemeController(manifest, { storage: null })
const current = ref(themes.theme.id)

async function toggle(): Promise<void> {
  await themes.setTheme(current.value === 'paper' ? 'ink' : 'paper')
  current.value = themes.theme.id
}
</script>

<template>
  <main class="mx-auto flex max-w-2xl flex-col gap-6 p-8">
    <TdCard>Карточка в теме <code>{{ current }}</code></TdCard>
    <TdButton @click="toggle">
      Переключить тему
    </TdButton>
  </main>
</template>
