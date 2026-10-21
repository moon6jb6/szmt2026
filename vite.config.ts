import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 相对 base：打包后放在「作品名_编号/01_作品及成果文件/」这类子目录也能直接起服务访问
  base: './',
})
