import { describe, expect, it } from 'vitest'
import { createGenerator } from '../../../vendor/core/index.js'

import { colorOpacityRules } from '../index'

async function generate(className: string) {
  const uno = await createGenerator({ rules: colorOpacityRules })
  const { css } = await uno.generate(className)
  return css
}

describe('colorOpacityRules', () => {
  it('bg-[var(…)]/NN эмитит color-mix с процентом', async () => {
    const css = await generate('bg-[var(--gr-bg)]/30')
    expect(css).toContain('color-mix(in srgb, var(--gr-bg) 30%, transparent)')
  })

  it('/150 клампится до 100%, а не переполняет color-mix', async () => {
    const css = await generate('bg-[var(--gr-bg)]/150')
    expect(css).toContain('color-mix(in srgb, var(--gr-bg) 100%, transparent)')
  })

  it('отрицательная opacity (/-10) не матчит правило вовсе', async () => {
    const css = await generate('bg-[var(--gr-bg)]/-10')
    expect(css).not.toContain('color-mix')
  })

  it('border-[color]/NN эмитит border-color через color-mix', async () => {
    const css = await generate('border-[var(--brd)]/50')
    expect(css).toContain('border-color:color-mix(in srgb, var(--brd) 50%, transparent)')
  })

  it('bg-[color:red]/NN снимает префикс color: перед color-mix', async () => {
    const css = await generate('bg-[color:red]/40')
    expect(css).toContain('color-mix(in srgb, red 40%, transparent)')
  })

  it('bg-[color:]/NN (пустое значение после префикса) не матчит', async () => {
    const css = await generate('bg-[color:]/40')
    expect(css).not.toContain('color-mix')
  })

  it('border-[color:]/NN (пустое значение после префикса) не матчит', async () => {
    const css = await generate('border-[color:]/40')
    expect(css).not.toContain('color-mix')
  })
})

describe('colorOpacityRules: значение нормализуется как в wind3', () => {
  it('[--x] — сокращение var(--x)', async () => {
    expect(await generate('bg-[--x]/50')).toContain('color-mix(in srgb, var(--x) 50%, transparent)')
  })

  it('подчёркивание — пробел внутри цветовой функции, которую wind3 не разбирает', async () => {
    expect(await generate('bg-[color-mix(in_srgb,red,blue)]/50')).toContain('color-mix(in srgb, color-mix(in srgb,red,blue) 50%, transparent)')
  })
})

describe('colorOpacityRules: где правило уступает wind3 или не берёт значение', () => {
  // Цвет, который wind3 разбирает сам, он и раскрашивает: `rgb(0 0 0 / 0.5)`,
  // `oklch(… / 0.5)` — без перевода в srgb, который обрезал бы гамму.
  it('hex и цветовые функции, которые wind3 разбирает, правило не берёт', async () => {
    for (const cls of ['bg-[#0ea5e9]/30', 'bg-[rgb(0_0_0)]/50', 'bg-[oklch(0.5_0.1_200)]/50', 'border-[hsl(0_0%_0%)]/50', 'bg-[rgb(var(--r)_0_0)]/50'])
      expect(await generate(cls)).not.toContain('color-mix')
  })

  it('не цвет — не цвет: длина, тип-хинт, url и градиент правило не берёт', async () => {
    for (const cls of ['border-[2px]/50', 'bg-[length:10px_10px]/50', 'bg-[url(x.png)]/50', 'bg-[linear-gradient(red,blue)]/50', 'bg-[none]/50'])
      expect(await generate(cls)).not.toContain('color-mix')
  })
})

describe('colorOpacityRules: границы значения opacity', () => {
  it('дробная opacity (/12.5) доезжает до color-mix, а не отбрасывается', async () => {
    const css = await generate('bg-[red]/12.5')
    expect(css).toContain('color-mix(in srgb, red 12.5%, transparent)')
  })

  // Ноль — единственное валидное значение, которое ложно при проверке на
  // truthy. Правило сравнивает с `null`, и этот тест держит это явным:
  // замена на `if (!opacity)` тихо выкинула бы `/0` из CSS.
  it('нулевая opacity (/0) эмитит color-mix, а не выпадает как falsy', async () => {
    const css = await generate('bg-[red]/0')
    expect(css).toContain('color-mix(in srgb, red 0%, transparent)')
  })

  // Граница семейства: правил ровно два, `bg-` и `border-`. Цветовые утилиты
  // presetMini с `/NN` работают сами, а bracket-цвет — только для этих двух.
  it('text-[color]/NN не поддерживается — правила такого нет', async () => {
    expect(await generate('text-[red]/50')).not.toContain('color-mix')
  })
})
