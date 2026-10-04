const base = require('../../packages/config/eslint.base.cjs');

module.exports = {
  ...base,
  extends: [...base.extends, 'next/core-web-vitals'],
};
