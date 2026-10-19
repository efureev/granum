<script setup lang="ts">
import { XTokenized } from '@granum-fixtures/simple/components/XTokenized'
import { ref } from 'vue'
import { themes } from './theme'

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
  <main class="mx-auto flex max-w-2xl flex-col gap-6 p-8">
    <header class="flex items-center gap-3">
      <span class="font-bold">Режим:</span>
      <button
        v-for="name in themes.modes().map(mode => mode.name)"
        :key="name"
        type="button"
        class="rounded border px-3 py-1"
        :class="name === current ? 'font-bold' : 'op-60'"
        @click="themes.setMode(name)"
      >
        {{ name }}
      </button>
      <button type="button" class="ml-auto rounded border px-3 py-1" @click="themes.cycle()">
        cycle
      </button>
    </header>
    <div class="flex items-center gap-4">
      <XTokenized class="h-16 w-24 shrink-0 rounded-lg" />
      <p>
        XTokenized — фон из токена активного режима: <code>--x-tokenized: {{ token }}</code>
      </p>
    </div>
  </main>
</template>
