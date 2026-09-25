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
         правила есть, но ничего не эмитят — проверять было бы нечего. -->
    <section class="divide-y divide-slate-300">
      <div class="flex items-center gap-3 p-4">
        <span class="h-4 w-4 animate-spin rounded-full border-2 border-slate-400" />
        <span>спиннер → animationRules + animationPreflights</span>
      </div>

      <div class="bg-[#0ea5e9]/30 border border-[#0ea5e9]/60 p-4">
        bracket-цвет с opacity → colorOpacityRules
      </div>

      <div class="p-4 blur-1 saturate-150 backdrop-blur-md">
        композиция blur / saturate / backdrop → filterRules
      </div>

      <!-- object-fit виден только на замещаемом элементе с заданными размерами
           и содержимым другой пропорции — отсюда бокс 24×16 и картинка 3:1. -->
      <div class="flex items-center gap-3 p-4">
        <img :src="stripe" alt="" class="h-16 w-24 object-cover">
        <img :src="stripe" alt="" class="h-16 w-24 object-contain">
        <img :src="stripe" alt="" class="h-16 w-24 object-cover object-left">
        <img :src="stripe" alt="" class="h-16 w-24 object-cover object-[50%_20%]">
        <span>кадрирование / вписывание / позиция → objectRules</span>
      </div>

      <!-- tabular-nums собирается из переменных, чтобы ordinal и slashed-zero
           задавали другие аспекты того же свойства и пережили его. -->
      <div class="flex items-center gap-6 p-4">
        <span class="tabular-nums">1 234 567,89</span>
        <span class="tabular-nums ordinal slashed-zero">1st 0</span>
        <span class="diagonal-fractions">1/2</span>
        <span class="normal-nums">1 234 567,89</span>
        <span>цифры фиксированной ширины → numericRules + numericPreflights</span>
      </div>

      <div class="p-4">
        <a href="#main" class="sr-only focus:not-sr-only">перейти к содержимому</a>
        <span>скрытая от глаз ссылка → accessibilityRules</span>
      </div>
    </section>

    <section class="flex space-x-4">
      <span>первый</span>
      <span>второй → spacingRules + spacingVariants</span>
    </section>
  </main>
</template>
