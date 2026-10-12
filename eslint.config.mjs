import antfu from '@antfu/eslint-config'

export default antfu(
  {},
  {
    rules: {
      'node/no-deprecated-api': 'off',
      'n/no-deprecated-api': 'off',
      'unicorn/prefer-node-protocol': 'off',
      'n/prefer-node-protocol': 'off',
    },
  },
  {
    // The clipboard wrapper runs in the page's own world. Anything it imports
    // runs there too, where the polyfill throws and the page can read it, so it
    // may name the channel and nothing else - and the channel may import nothing.
    files: ['src/contentScripts/clipboard-main.ts', 'src/logic/clipboard-signal.ts'],
    rules: {
      // Not there in the page's world, and an auto-import of the polyfill is not
      // an import statement, so the rule below would never see it
      'no-restricted-globals': ['error', 'browser', 'chrome'],
      'no-restricted-imports': ['error', {
        patterns: [{
          regex: '^(?!~/logic/clipboard-signal$)',
          message: 'The page-world clipboard wrapper may import only ~/logic/clipboard-signal. See src/contentScripts/clipboard-main.ts.',
        }],
      }],
    },
  },
)
