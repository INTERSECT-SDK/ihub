/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    'postcss-import': {},
    'postcss-preset-mantine': {},
    tailwindcss: {},
    autoprefixer: {},
    'tailwindcss/nesting': {},
  },
}

export default config
