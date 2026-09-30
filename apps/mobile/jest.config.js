/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  testMatch: ["<rootDir>/src/**/*.test.{ts,tsx}"],
  // The UI suites mount real FlatLists and wait out VirtualizedList's internal timers; under CPU load (CI,
  // parallel workers, a concurrent reviewer) a single test can exceed Jest's 5 s default without any defect.
  testTimeout: 20000,
};
