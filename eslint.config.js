import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig(
  { ignores: ['**/out/', '**/release/'] },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    files: ['apps/desktop/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
  {
    files: [
      '*.{js,ts}',
      'apps/server/**',
      'apps/desktop/electron/**',
      'apps/desktop/test/**',
      'apps/desktop/*.ts',
      'packages/**',
    ],
    languageOptions: { globals: globals.node },
  },
  {
    rules: { 'no-console': ['error', { allow: ['error'] }] },
  },
)
