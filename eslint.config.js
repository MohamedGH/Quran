import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default [
  // Generated files, old copies and local temporary folders
  {
    ignores: [
      "dist/**",
      "build/**",
      "node_modules/**",
      "android/**",
      "ios/**",
      "doha/**",
      "other/**",
      "serverTimestamps/**",
      "time/**",
    ],
  },

  // JavaScript / JSX
  {
    files: ["**/*.{js,jsx,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        Capacitor: "readonly",
      },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      "no-unused-vars": "off",
      "no-undef": "error",
      "react/jsx-uses-react": "off",
      "react/jsx-uses-vars": "error",
      "react/react-in-jsx-scope": "off",
    },
  },

  // Service Worker
  {
    files: ["public/audio-sw.js"],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
        indexedDB: "readonly",
      },
    },
  },
];
