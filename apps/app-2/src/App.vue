<script setup lang="ts">
import { XTestStyled } from '@granum-fixtures/simple/components/XTestStyled'
</script>

<template>
  <main class="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10 text-slate-900">
    <XTestStyled class="p-6 shadow-sm">
      XTestStyled: все классы — из строки в рантайме
    </XTestStyled>

    <!-- Визуализация токенов, созданных приложением через tokenOverrides.light:
         рамка красится в --brd, текст — в --card-fg. -->
    <div class="rounded-lg border-2 border-[var(--brd)] p-4 text-[var(--card-fg)]">
      Те же токены утилитами приложения: рамка <code>--brd</code>, текст <code>--card-fg</code>
    </div>
  </main>
</template>
