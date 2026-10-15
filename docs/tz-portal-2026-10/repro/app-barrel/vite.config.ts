import { defineConfig } from 'vite'
import Vue from '@vitejs/plugin-vue'
import { granum } from '@feugene/granum/vite'
import granumConfig from './granum.config.mjs'

export default defineConfig({ plugins: [Vue(), granum(granumConfig)], cacheDir: '.vite-cache' })
