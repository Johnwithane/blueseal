import pluginVue from "eslint-plugin-vue";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default [
  ...pluginVue.configs["flat/recommended"],
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    files: ["*.vue", "**/*.vue"],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
  },
  {
    rules: {
      "vue/multi-word-component-names": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    ignores: ["dist/", "node_modules/", "functions/lib/", "functions/node_modules/"],
  },
];
