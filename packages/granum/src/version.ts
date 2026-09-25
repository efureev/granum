/** Версия пакета из `package.json`; вне сборки — маркер dev-окружения. */
export const GRANUM_VERSION: string = typeof __GRANUM_VERSION__ === 'string' ? __GRANUM_VERSION__ : '0.0.0-dev'
