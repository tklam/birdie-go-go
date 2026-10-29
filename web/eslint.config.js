import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  { ignores: ['dist/', 'public/', 'src/core/types.gen.ts'] },
  js.configs.recommended,
  tseslint.configs.recommended,
);
