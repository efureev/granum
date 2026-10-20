<script setup lang="ts">
import type { GranumThemeState } from '@feugene/granum/runtime'
import { loadThemeSheet, themeModeValue } from '@feugene/granum/runtime'
import { TdBadge } from '@granum-fixtures/themed-ds/components/TdBadge'
import { TdButton } from '@granum-fixtures/themed-ds/components/TdButton'
import { TdCard } from '@granum-fixtures/themed-ds/components/TdCard'
import { computed, onMounted, ref } from 'vue'
import { manifest, themes } from './theme'

// Состояние контроллера — в реактивную ссылку: подписка сообщает о смене темы и режима.
const state = ref<GranumThemeState>({ theme: themes.theme.id, mode: themes.mode })
themes.subscribe(next => (state.value = next))

const current = computed(() => manifest.themes.find(theme => theme.id === state.value.theme)!)
const pair = computed(() => themeModeValue(manifest, state.value.mode, state.value.theme))

// `setTheme` сначала грузит лист дополнительной темы и только потом ставит пару:
// до загрузки страница остаётся в прежней теме, а не в чужих значениях.
const loading = ref<string>()
const failure = ref<string>()
async function pickTheme(id: string): Promise<void> {
  loading.value = id
  failure.value = undefined
  try {
    await themes.setTheme(id)
  }
  catch (error) {
    failure.value = (error as Error).message
  }
  finally {
    loading.value = undefined
  }
}

// Острова — пара на поддереве: тема и режим на своём элементе, пока корень в своей.
// Лист дополнительной темы острову грузит `loadThemeSheet`, пару ставим после него.
const islands = [
  { theme: 'ink', mode: 'dim' },
  { theme: 'sand', mode: 'dark' },
  { theme: 'paper', mode: 'light' },
].map(island => ({ ...island, pair: themeModeValue(manifest, island.mode, island.theme)! }))
const loaded = ref<Record<string, boolean>>({})
onMounted(() => {
  for (const island of islands) {
    void loadThemeSheet(manifest, island.theme).then(() => {
      loaded.value = { ...loaded.value, [island.theme]: true }
    })
  }
})
</script>

<template>
  <main class="mx-auto flex max-w-3xl flex-col gap-6 p-8">
    <section class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-bold">Тема:</span>
        <TdButton
          v-for="theme in themes.themes()"
          :key="theme.id"
          :data-theme-option="theme.id"
          :class="theme.id === state.theme ? 'font-bold' : 'op-60'"
          @click="pickTheme(theme.id)"
        >
          {{ theme.title }}
        </TdButton>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-bold">Режим:</span>
        <TdButton
          v-for="mode in current.modes"
          :key="mode.name"
          :data-mode-option="mode.name"
          :class="mode.name === state.mode ? 'font-bold' : 'op-60'"
          @click="themes.setMode(mode.name)"
        >
          {{ mode.title ?? mode.name }}
        </TdButton>
      </div>
      <p data-state>
        Корень: <code>data-theme="{{ pair }}"</code>
        <span v-if="loading"> — загружается лист темы <code>{{ loading }}</code>…</span>
        <span v-if="failure"> — {{ failure }}</span>
      </p>
    </section>

    <TdCard>
      <p>Карточка и кнопки — в текущей теме: цвета режима, скругление и шрифт темы.</p>
      <p class="flex gap-2">
        <TdButton>Действие</TdButton>
        <TdBadge>значок</TdBadge>
      </p>
    </TdCard>

    <section class="grid grid-cols-3 gap-4">
      <div v-for="island in islands" :key="island.pair" :data-island="island.theme" :data-theme="island.theme === manifest.defaultTheme || loaded[island.theme] ? island.pair : undefined">
        <TdCard>
          <p>Остров <code>{{ island.pair }}</code></p>
          <TdButton>Кнопка</TdButton>
        </TdCard>
      </div>
    </section>
  </main>
</template>
