/**
 * Integration test for babel-plugin-raceway
 *
 * Tests that the plugin correctly transforms code to add Raceway instrumentation
 */

const babel = require('@babel/core');
const plugin = require('../dist/index.js').default;

describe('babel-plugin-raceway', () => {
  function transform(code, options = {}) {
    const result = babel.transformSync(code, {
      plugins: [[plugin, options]],
      filename: 'test.js',
    });
    return result.code;
  }

  describe('imports', () => {
    it('should inject raceway runtime import at top of file', () => {
      const input = `
        const x = 1;
      `;
      const output = transform(input);
      expect(output).toContain('import __raceway from "@mode-7/raceway-node/runtime"');
    });

    it('should use custom raceway instance name', () => {
      const input = `
        const x = 1;
      `;
      const output = transform(input, { racewayInstance: 'myRaceway' });
      expect(output).toContain('import myRaceway from "@mode-7/raceway-node/runtime"');
    });
  });

  describe('function instrumentation', () => {
    it('should instrument function declarations', () => {
      const input = `
        function myFunction(a, b) {
          return a + b;
        }
      `;
      const output = transform(input);
      expect(output).toContain('captureFunctionCall');
      expect(output).toContain('"myFunction"');
    });

    it('should instrument function expressions', () => {
      const input = `
        const fn = function namedFn(x) {
          return x * 2;
        };
      `;
      const output = transform(input);
      expect(output).toContain('captureFunctionCall');
    });

    it('should instrument arrow functions', () => {
      const input = `
        const fn = (x, y) => {
          return x + y;
        };
      `;
      const output = transform(input);
      expect(output).toContain('captureFunctionCall');
    });

    it('should skip function instrumentation when disabled', () => {
      const input = `
        function myFunction() {
          return 42;
        }
      `;
      const output = transform(input, { instrumentFunctions: false });
      expect(output).not.toContain('captureFunctionCall');
    });
  });

  describe('assignment instrumentation', () => {
    it('should instrument property assignments with old value capture', () => {
      const input = `
        user.balance = 100;
      `;
      const output = transform(input);

      // Should capture old value
      expect(output).toMatch(/const _oldValue\d* = user\.balance/);

      // Should track state change
      expect(output).toContain('trackStateChange');
      expect(output).toContain('"user.balance"');
      expect(output).toContain('"Write"');
    });

    it('should instrument variable assignments', () => {
      const input = `
        let x = 10;
        x = 20;
      `;
      const output = transform(input);

      // Should track the reassignment
      expect(output).toContain('trackStateChange');
      expect(output).toContain('"x"');
    });

    it('should skip assignment instrumentation when disabled', () => {
      const input = `
        user.balance = 100;
      `;
      const output = transform(input, { instrumentAssignments: false });
      expect(output).not.toContain('trackStateChange');
    });
  });

  describe('read tracking', () => {
    it('should instrument property reads in variable declarations', () => {
      const input = `
        const balance = user.balance;
      `;
      const output = transform(input);

      expect(output).toContain('trackStateChange');
      expect(output).toContain('"user.balance"');
      expect(output).toContain('"Read"');
    });

    it('should instrument property reads in return statements', () => {
      const input = `
        function getBalance() {
          return user.balance;
        }
      `;
      const output = transform(input);

      expect(output).toContain('trackStateChange');
      expect(output).toContain('"Read"');
    });

    it('should not track method calls', () => {
      const input = `
        user.getBalance();
      `;
      const output = transform(input);

      // Should not track the method call as a property read
      const lines = output.split('\n');
      const trackCalls = lines.filter(line => line.includes('trackStateChange') && line.includes('getBalance'));
      expect(trackCalls.length).toBe(0);
    });
  });

  describe('async instrumentation', () => {
    it('should instrument await expressions', () => {
      const input = `
        async function test() {
          const result = await fetchData();
        }
      `;
      const output = transform(input);

      expect(output).toContain('captureCustom');
      expect(output).toContain('"await"');
    });

    it('should skip async instrumentation when disabled', () => {
      const input = `
        async function test() {
          await fetchData();
        }
      `;
      const output = transform(input, { instrumentAsync: false });
      expect(output).not.toContain('captureCustom');
    });
  });

  describe('edge cases', () => {
    it('should handle nested property access', () => {
      const input = `
        user.account.balance = 100;
      `;
      const output = transform(input);

      expect(output).toContain('trackStateChange');
    });

    it('should handle computed property access', () => {
      const input = `
        const key = 'balance';
        user[key] = 100;
      `;
      const output = transform(input);

      // This is a known limitation - computed properties are harder to track
      // Just verify it doesn't crash
      expect(output).toBeDefined();
    });

    it('should not instrument SDK calls', () => {
      const input = `
        __raceway.trackStateChange('x', 0, 1, 'Write');
      `;
      const output = transform(input);

      // Should not double-instrument SDK calls
      const trackCalls = (output.match(/trackStateChange/g) || []).length;
      expect(trackCalls).toBe(1); // Only the original call
    });
  });

  describe('complete example', () => {
    it('should correctly instrument a banking transfer function', () => {
      const input = `
        function transfer(from, to, amount) {
          const balance = accounts[from].balance;

          if (balance < amount) {
            return false;
          }

          accounts[from].balance -= amount;
          accounts[to].balance += amount;

          return true;
        }
      `;
      const output = transform(input);

      // Should have runtime import
      expect(output).toContain('import __raceway from "@mode-7/raceway-node/runtime"');

      // Should track function call
      expect(output).toContain('captureFunctionCall');
      expect(output).toContain('"transfer"');

      // Should track state changes (reads and writes)
      expect(output).toContain('trackStateChange');
      expect(output).toContain('"Read"');
      expect(output).toContain('"Write"');

      // Should capture old values for writes
      expect(output).toMatch(/_oldValue/);
    });
  });
});
