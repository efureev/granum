<script setup lang="ts">
import { XNestedReverse } from '@granum-fixtures/simple/components/XNestedReverse'

// Широкая (3:1) картинка для демонстрации object-fit — см. комментарий в шаблоне.
const stripe = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 20">'
  + '<rect width="60" height="20" fill="#0ea5e9"/>'
  + '<circle cx="30" cy="10" r="8" fill="#f8fafc"/>'
  + '</svg>',
)}`
</script>

<template>
  <main class="p-6 space-y-6">
    <!-- 1. Вложенные SFC: text-7xl / tracking-widest приходят из XNestedHeader
         и XNestedFooter, которые бандлер провайдера положил в чанк
         XNestedReverse — сборка провайдера извлекла их в манифест. -->
    <XNestedReverse>
      body
    </XNestedReverse>

    <!-- 2. Дополнительные правила движка. Без разметки, которая их использует,
         правила есть, но ничего не эмитят — проверять было бы нечего. Слева
         образец, справа подпись: эффект не должен портить сам текст. -->
    <section class="divide-y divide-slate-300 rounded-xl border border-slate-300">
      <div class="flex items-center gap-4 p-4">
        <!-- Одна сторона прозрачная, иначе вращение кольца не видно. -->
        <span class="h-6 w-6 shrink-0 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
        <span>спиннер → animationRules + animationPreflights</span>
      </div>

      <div class="flex items-center gap-4 p-4">
        <span class="h-8 w-24 shrink-0 rounded bg-[#0ea5e9]/30 border border-[#0ea5e9]/60" />
        <span>bracket-цвет с opacity → colorOpacityRules</span>
      </div>

      <div class="flex items-center gap-4 p-4">
        <span class="shrink-0 rounded bg-sky-500 px-3 py-1 text-white blur-1 saturate-150 backdrop-blur-md">образец</span>
        <span>композиция blur / saturate / backdrop → filterRules</span>
      </div>

      <!-- object-fit виден только на замещаемом элементе с заданными размерами
           и содержимым другой пропорции — отсюда бокс 24×16 и картинка 3:1. -->
      <!-- Образцы шире узкого экрана: там они идут столбцом над подписью и
           переносятся сами, а с md подпись встаёт справа. -->
      <div class="flex flex-col gap-3 p-4 md:flex-row md:items-center md:gap-4">
        <div class="flex shrink-0 flex-wrap gap-3">
          <img :src="stripe" alt="" class="h-16 w-24 object-cover">
          <img :src="stripe" alt="" class="h-16 w-24 object-contain">
          <img :src="stripe" alt="" class="h-16 w-24 object-cover object-left">
          <img :src="stripe" alt="" class="h-16 w-24 object-cover object-[50%_20%]">
        </div>
        <span>кадрирование / вписывание / позиция → objectRules</span>
      </div>

      <!-- tabular-nums собирается из переменных, чтобы ordinal и slashed-zero
           задавали другие аспекты того же свойства и пережили его. -->
      <div class="flex flex-col gap-3 p-4 md:flex-row md:items-center md:gap-6">
        <div class="flex shrink-0 flex-wrap gap-x-6 gap-y-1">
          <span class="tabular-nums">1 234 567,89</span>
          <span class="tabular-nums ordinal slashed-zero">1st 0</span>
          <span class="diagonal-fractions">1/2</span>
          <span class="normal-nums">1 234 567,89</span>
        </div>
        <span>цифры фиксированной ширины → numericRules + numericPreflights</span>
      </div>

      <div class="p-4">
        <a href="#main" class="sr-only focus:not-sr-only">перейти к содержимому</a>
        <span>скрытая от глаз ссылка → accessibilityRules</span>
      </div>

      <div class="flex space-x-4 p-4">
        <span>первый</span>
        <span>второй → spacingRules + spacingVariants</span>
      </div>
    </section>
  </main>
</template>
