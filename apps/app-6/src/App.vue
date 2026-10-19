<script setup lang="ts">
import { XTokenized } from '@granum-fixtures/simple/components/XTokenized'
import { ref } from 'vue'
import { themeLabel, themes } from './theme'

/** Значение токена на корне документа: контроллер зовёт подписчиков уже после применения режима. */
function tokenValue(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--x-tokenized').trim()
}

const current = ref(themes.mode)
const token = ref(tokenValue())
themes.subscribe((name) => {
  current.value = name
  token.value = tokenValue()
})
</script>

<template>
  <main class="bg-[var(--app-bg)] text-[var(--app-fg)]">
    <div class="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <header class="flex flex-wrap items-center gap-3">
        <span class="font-bold">Режим:</span>
        <!-- Активная кнопка — цвет фона темы на акценте: пара держит контраст 4.5:1 в каждой теме. -->
        <button
          v-for="name in themes.modes().map(mode => mode.name)"
          :key="name"
          type="button"
          class="rounded border px-3 py-1"
          :class="name === current
            ? 'border-[var(--app-accent)] bg-[var(--app-accent)] text-[var(--app-bg)] font-bold'
            : 'border-[var(--app-muted)]'"
          @click="themes.setMode(name)"
        >
          {{ themeLabel(name) }}
        </button>
      </header>
      <div class="flex items-center gap-4">
        <XTokenized class="h-16 w-24 shrink-0 rounded-lg" />
        <p>
          XTokenized — фон из токена компонента: <code>--x-tokenized: {{ token }}</code>
        </p>
      </div>
    </div>
  </main>
</template>
