<template>
  <button
    class="inline-flex items-center gap-[var(--vd-button-gap)] px-3 py-1 rounded-[var(--vd-button-radius)] bg-[var(--vd-button-bg)] text-[var(--vd-button-fg)] shadow-[var(--vd-button-shadow,none)]"
    :style="{ '--vd-button-gap': '6px' }"
  >
    <slot />
  </button>
</template>
