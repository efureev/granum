<script setup lang="ts">
import { XTokenized } from '@granum-fixtures/simple/components/XTokenized'
import { ref } from 'vue'
import { themes } from './theme'

const current = ref(themes.get())
themes.subscribe(name => (current.value = name))
</script>

<template>
  <main class="mx-auto flex max-w-2xl flex-col gap-6 p-8">
    <header class="flex items-center gap-3">
      <span class="font-bold">Тема:</span>
      <button
        v-for="name in themes.list()"
        :key="name"
        type="button"
        class="rounded border px-3 py-1"
        :class="name === current ? 'font-bold' : 'op-60'"
        @click="themes.set(name)"
      >
        {{ name }}
      </button>
      <button type="button" class="ml-auto rounded border px-3 py-1" @click="themes.cycle()">
        cycle
      </button>
    </header>
    <XTokenized>
      XTokenized — цвет приходит из токена активной темы
    </XTokenized>
  </main>
</template>
