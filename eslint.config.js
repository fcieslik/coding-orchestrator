import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/"],
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["plugins/**/*.mjs"],
    languageOptions: {
      globals: {
        clearInterval: "readonly",
        process: "readonly",
        setInterval: "readonly",
      },
    },
    rules: {
      "no-control-regex": "off",
    },
  },
);
