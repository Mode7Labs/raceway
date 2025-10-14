export { CausewayTransformer, TransformOptions } from './transformer';
export { default as runtime } from './runtime';

// Loader for Node.js require hook
export function register() {
  const Module = require('module');
  const { CausewayTransformer } = require('./transformer');
  const transformer = new CausewayTransformer();

  const originalCompile = (Module.prototype as any)._compile;

  (Module.prototype as any)._compile = function(content: string, filename: string) {
    if (filename.endsWith('.ts') || filename.endsWith('.js')) {
      try {
        content = transformer.transform(content, filename);
      } catch (error) {
        console.error(`Failed to instrument ${filename}:`, error);
      }
    }

    return originalCompile.call(this, content, filename);
  };
}
