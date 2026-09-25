<script setup lang="ts">
import { XTokenized } from '@granum-fixtures/simple/components/XTokenized'
import { ref } from 'vue'
import { themeLabel, themes } from './theme'

const current = ref(themes.get())
themes.subscribe(name => (current.value = name))
</script>

<template>
  <main class="min-h-screen bg-[var(--app-bg)] text-[var(--app-fg)]">
    <div class="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <header class="flex flex-wrap items-center gap-3">
        <span class="font-bold">Тема:</span>
        <button
          v-for="name in themes.list()"
          :key="name"
          type="button"
          class="rounded border px-3 py-1"
          :style="{ borderColor: 'var(--app-muted)', background: name === current ? 'var(--app-accent)' : 'transparent' }"
          @click="themes.set(name)"
        >
          {{ themeLabel(name) }}
        </button>
      </header>
      <XTokenized>
        XTokenized — цвет приходит из токена активной темы
      </XTokenized>
    </div>
  </main>
</template>
