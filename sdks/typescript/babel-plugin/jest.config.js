module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js'],
  collectCoverageFrom: ['dist/**/*.js'],
  coverageDirectory: 'coverage',
  verbose: true,
};
