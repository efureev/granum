<script setup lang="ts">
import { XhPanel } from '@granum-fixtures/heavy/components/XhPanel'
</script>

<template>
  <!--
    Ни одного СОБСТВЕННОГО класса — намеренно. Всё, что окажется в слое
    utilities, пришло из компонента, и только поэтому его можно приписать
    библиотеке. Первая же утилита здесь ломает атрибуцию.

    Имя утилиты в этом комментарии не пишется — тоже намеренно: экстрактор
    читает текст файла, а не разметку.
  -->
  <main>
    <XhPanel>
      <template #title>bench-pruned</template>
      <template #note>Подопытный стенд: один компонент поверх полного фундамента.</template>
      <template #action>Действие</template>
      <template #hint>Подсказка</template>
      Содержимое карточки.
    </XhPanel>
  </main>
</template>
