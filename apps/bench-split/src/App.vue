<script setup lang="ts">
import { XhPanel } from '@granum-fixtures/heavy/components/XhPanel'
</script>

<template>
  <!--
    Класс ниже — маркер стенда: `verify-split.mjs` подменяет его на другой,
    пересобирает и сверяет, что изменился ровно один ассет из пяти — слой
    utilities. Менять его вручную можно, но тогда поправьте и скрипт.
  -->
  <main class="p-4">
    <XhPanel>
      <template #title>bench-split</template>
      <template #note>Стенд разделения CSS по слоям.</template>
      <template #action>Действие</template>
      <template #hint>Подсказка</template>
      Содержимое карточки.
    </XhPanel>
  </main>
</template>
