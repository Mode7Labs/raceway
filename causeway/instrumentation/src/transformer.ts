import * as parser from '@babel/parser';
import traverse, { NodePath } from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';

export interface TransformOptions {
  instrumentFunctions?: boolean;
  instrumentAsync?: boolean;
  instrumentStateChanges?: boolean;
  instrumentHttpCalls?: boolean;
  excludePatterns?: string[];
}

export class CausewayTransformer {
  private options: Required<TransformOptions>;

  constructor(options: TransformOptions = {}) {
    this.options = {
      instrumentFunctions: options.instrumentFunctions ?? true,
      instrumentAsync: options.instrumentAsync ?? true,
      instrumentStateChanges: options.instrumentStateChanges ?? true,
      instrumentHttpCalls: options.instrumentHttpCalls ?? true,
      excludePatterns: options.excludePatterns ?? ['node_modules'],
    };
  }

  /**
   * Transform source code to add instrumentation
   */
  transform(code: string, filename: string): string {
    // Skip excluded files
    if (this.shouldExclude(filename)) {
      return code;
    }

    const ast = parser.parse(code, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx', 'decorators-legacy'],
    });

    // Add import for Causeway runtime
    this.addImport(ast);

    traverse(ast, {
      // Instrument function calls
      FunctionDeclaration: (path) => {
        if (this.options.instrumentFunctions) {
          this.instrumentFunction(path, filename);
        }
      },

      FunctionExpression: (path) => {
        if (this.options.instrumentFunctions) {
          this.instrumentFunction(path, filename);
        }
      },

      ArrowFunctionExpression: (path) => {
        if (this.options.instrumentFunctions) {
          this.instrumentFunction(path, filename);
        }
      },

      // Instrument async/await
      AwaitExpression: (path) => {
        if (this.options.instrumentAsync) {
          this.instrumentAwait(path, filename);
        }
      },

      // Instrument variable assignments (state changes)
      AssignmentExpression: (path) => {
        if (this.options.instrumentStateChanges) {
          this.instrumentStateChange(path, filename);
        }
      },

      // Instrument HTTP calls (fetch, axios, etc.)
      CallExpression: (path) => {
        if (this.options.instrumentHttpCalls) {
          this.instrumentHttpCall(path, filename);
        }
      },
    });

    const output = generate(ast, {
      retainLines: true,
      compact: false,
    });

    return output.code;
  }

  private shouldExclude(filename: string): boolean {
    return this.options.excludePatterns.some(pattern =>
      filename.includes(pattern)
    );
  }

  private addImport(ast: t.File) {
    const importDeclaration = t.importDeclaration(
      [t.importDefaultSpecifier(t.identifier('__causeway'))],
      t.stringLiteral('@causeway/runtime')
    );

    ast.program.body.unshift(importDeclaration);
  }

  private instrumentFunction(
    path: NodePath<t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression>,
    filename: string
  ) {
    const node = path.node;
    const functionName = this.getFunctionName(node);
    const loc = node.loc;

    // Create instrumentation call at function entry
    const entryCall = t.expressionStatement(
      t.callExpression(
        t.memberExpression(t.identifier('__causeway'), t.identifier('enterFunction')),
        [
          t.stringLiteral(functionName),
          t.stringLiteral(filename),
          t.numericLiteral(loc?.start.line ?? 0),
          t.arrayExpression(
            node.params.map(param =>
              t.identifier(this.getParamName(param))
            )
          ),
        ]
      )
    );

    // Wrap function body
    if (t.isBlockStatement(node.body)) {
      node.body.body.unshift(entryCall);
    } else {
      // Arrow function with expression body
      const blockBody = t.blockStatement([
        entryCall,
        t.returnStatement(node.body),
      ]);
      (node as t.ArrowFunctionExpression).body = blockBody;
    }
  }

  private instrumentAwait(path: NodePath<t.AwaitExpression>, filename: string) {
    const loc = path.node.loc;

    // Wrap await with tracking
    const wrappedAwait = t.callExpression(
      t.memberExpression(t.identifier('__causeway'), t.identifier('trackAwait')),
      [
        path.node.argument,
        t.stringLiteral(filename),
        t.numericLiteral(loc?.start.line ?? 0),
      ]
    );

    path.replaceWith(t.awaitExpression(wrappedAwait));
  }

  private instrumentStateChange(path: NodePath<t.AssignmentExpression>, filename: string) {
    const left = path.node.left;
    const right = path.node.right;
    const loc = path.node.loc;

    if (t.isIdentifier(left) || t.isMemberExpression(left)) {
      const varName = this.getExpressionName(left);

      // Track state change
      const trackCall = t.callExpression(
        t.memberExpression(t.identifier('__causeway'), t.identifier('trackStateChange')),
        [
          t.stringLiteral(varName),
          left,
          right,
          t.stringLiteral(filename),
          t.numericLiteral(loc?.start.line ?? 0),
        ]
      );

      path.replaceWith(t.sequenceExpression([trackCall, path.node]));
    }
  }

  private instrumentHttpCall(path: NodePath<t.CallExpression>, filename: string) {
    const callee = path.node.callee;

    // Check if this is a fetch or axios call
    if (
      (t.isIdentifier(callee) && callee.name === 'fetch') ||
      (t.isMemberExpression(callee) &&
       t.isIdentifier(callee.object) &&
       ['axios', 'http', 'https'].includes(callee.object.name))
    ) {
      const loc = path.node.loc;

      // Wrap HTTP call with tracking
      const wrappedCall = t.callExpression(
        t.memberExpression(t.identifier('__causeway'), t.identifier('trackHttp')),
        [
          path.node,
          t.stringLiteral(filename),
          t.numericLiteral(loc?.start.line ?? 0),
        ]
      );

      path.replaceWith(wrappedCall);
    }
  }

  private getFunctionName(node: t.FunctionDeclaration | t.FunctionExpression | t.ArrowFunctionExpression): string {
    if (t.isFunctionDeclaration(node) && node.id) {
      return node.id.name;
    }
    if (t.isFunctionExpression(node) && node.id) {
      return node.id.name;
    }
    return '<anonymous>';
  }

  private getParamName(param: t.LVal): string {
    if (t.isIdentifier(param)) {
      return param.name;
    }
    if (t.isRestElement(param) && t.isIdentifier(param.argument)) {
      return `...${param.argument.name}`;
    }
    return '<param>';
  }

  private getExpressionName(node: t.LVal | t.Expression): string {
    if (t.isIdentifier(node)) {
      return node.name;
    }
    if (t.isMemberExpression(node)) {
      const obj = this.getExpressionName(node.object as any);
      const prop = t.isIdentifier(node.property) ? node.property.name : '<computed>';
      return `${obj}.${prop}`;
    }
    return '<expression>';
  }
}
