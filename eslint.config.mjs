import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['out/**', 'release/**', 'dist/**', 'node_modules/**', 'coverage/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports', fixStyle: 'inline-type-imports' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }]
    }
  },
  {
    files: ['electron/**/*.ts', 'shared/**/*.ts', 'tests/unit/main/**/*.ts', 'tests/integration/**/*.ts', '*.config.ts'],
    languageOptions: { globals: globals.node }
  },
  {
    files: ['src/**/*.{ts,tsx}', 'tests/unit/renderer/**/*.{ts,tsx}', 'tests/setup-renderer.ts'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  },
  {
    files: ['scripts/**/*.mjs', '*.config.js'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' }
  }
)
