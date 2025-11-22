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
)
