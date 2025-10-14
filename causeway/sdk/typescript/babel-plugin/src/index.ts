import { declare } from '@babel/helper-plugin-utils';
import * as t from '@babel/types';
import type { NodePath } from '@babel/traverse';

interface PluginOptions {
  // Name of the causeway instance variable
  causewayInstance?: string;
  // Whether to instrument function calls
  instrumentFunctions?: boolean;
  // Whether to instrument variable assignments
  instrumentAssignments?: boolean;
  // Whether to instrument async operations
  instrumentAsync?: boolean;
  // Exclude patterns (file paths to skip)
  exclude?: string[];
}

/**
 * Babel plugin to automatically instrument code with Causeway events
 */
export default declare((api, options: PluginOptions) => {
  api.assertVersion(7);

  const causewayInstance = options.causewayInstance || '__causeway';
  const instrumentFunctions = options.instrumentFunctions !== false;
  const instrumentAssignments = options.instrumentAssignments !== false;
  const instrumentAsync = options.instrumentAsync !== false;

  return {
    name: 'babel-plugin-causeway',

    visitor: {
      Program(path: NodePath<t.Program>, state: any) {
        // Check if file should be excluded
        const filename = state.filename || '';
        if (options.exclude?.some(pattern => filename.includes(pattern))) {
          return;
        }

        // Inject causeway import at top of file
        const importDeclaration = t.importDeclaration(
          [t.importDefaultSpecifier(t.identifier(causewayInstance))],
          t.stringLiteral('causeway-sdk/runtime')
        );

        path.node.body.unshift(importDeclaration);
      },

      FunctionDeclaration(path: NodePath<t.FunctionDeclaration>) {
        if (!instrumentFunctions) return;

        const functionName = path.node.id?.name || 'anonymous';
        const params = path.node.params;

        // Build args object from parameters
        const argsProperties = params.map((param) => {
          if (t.isIdentifier(param)) {
            return t.objectProperty(
              t.identifier(param.name),
              t.identifier(param.name),
              false,
              true
            );
          }
          return null;
        }).filter(Boolean) as t.ObjectProperty[];

        // Create captureEvent call
        const captureCall = t.expressionStatement(
          t.callExpression(
            t.memberExpression(
              t.identifier(causewayInstance),
              t.identifier('captureFunctionCall')
            ),
            [
              t.stringLiteral(functionName),
              t.objectExpression(argsProperties),
              t.objectExpression([
                t.objectProperty(
                  t.identifier('file'),
                  t.stringLiteral('__filename')
                ),
                t.objectProperty(
                  t.identifier('line'),
                  t.numericLiteral(path.node.loc?.start.line || 0)
                ),
              ]),
            ]
          )
        );

        // Insert at beginning of function body
        if (t.isBlockStatement(path.node.body)) {
          path.node.body.body.unshift(captureCall);
        }
      },

      FunctionExpression(path: NodePath<t.FunctionExpression>) {
        if (!instrumentFunctions) return;

        const functionName = path.node.id?.name || 'anonymous';
        const params = path.node.params;

        const argsProperties = params.map((param) => {
          if (t.isIdentifier(param)) {
            return t.objectProperty(
              t.identifier(param.name),
              t.identifier(param.name),
              false,
              true
            );
          }
          return null;
        }).filter(Boolean) as t.ObjectProperty[];

        const captureCall = t.expressionStatement(
          t.callExpression(
            t.memberExpression(
              t.identifier(causewayInstance),
              t.identifier('captureFunctionCall')
            ),
            [
              t.stringLiteral(functionName),
              t.objectExpression(argsProperties),
              t.objectExpression([
                t.objectProperty(
                  t.identifier('file'),
                  t.stringLiteral('__filename')
                ),
                t.objectProperty(
                  t.identifier('line'),
                  t.numericLiteral(path.node.loc?.start.line || 0)
                ),
              ]),
            ]
          )
        );

        if (t.isBlockStatement(path.node.body)) {
          path.node.body.body.unshift(captureCall);
        }
      },

      ArrowFunctionExpression(path: NodePath<t.ArrowFunctionExpression>) {
        if (!instrumentFunctions) return;

        const params = path.node.params;

        const argsProperties = params.map((param) => {
          if (t.isIdentifier(param)) {
            return t.objectProperty(
              t.identifier(param.name),
              t.identifier(param.name),
              false,
              true
            );
          }
          return null;
        }).filter(Boolean) as t.ObjectProperty[];

        const captureCall = t.expressionStatement(
          t.callExpression(
            t.memberExpression(
              t.identifier(causewayInstance),
              t.identifier('captureFunctionCall')
            ),
            [
              t.stringLiteral('arrow'),
              t.objectExpression(argsProperties),
              t.objectExpression([
                t.objectProperty(
                  t.identifier('file'),
                  t.stringLiteral('__filename')
                ),
                t.objectProperty(
                  t.identifier('line'),
                  t.numericLiteral(path.node.loc?.start.line || 0)
                ),
              ]),
            ]
          )
        );

        // Convert expression body to block statement if needed
        if (!t.isBlockStatement(path.node.body)) {
          const returnStatement = t.returnStatement(path.node.body);
          path.node.body = t.blockStatement([captureCall, returnStatement]);
        } else {
          path.node.body.body.unshift(captureCall);
        }
      },

      AssignmentExpression(path: NodePath<t.AssignmentExpression>) {
        if (!instrumentAssignments) return;

        const left = path.node.left;
        let variableName = 'unknown';

        // Get variable name
        if (t.isIdentifier(left)) {
          variableName = left.name;
        } else if (t.isMemberExpression(left)) {
          const obj = t.isIdentifier(left.object) ? left.object.name : 'obj';
          const prop = t.isIdentifier(left.property) ? left.property.name : 'prop';
          variableName = `${obj}.${prop}`;
        }

        // Create captureStateChange call
        const captureCall = t.callExpression(
          t.memberExpression(
            t.identifier(causewayInstance),
            t.identifier('captureStateChange')
          ),
          [
            t.stringLiteral(variableName),
            path.node.right, // new value
            t.identifier('undefined'), // old value (we don't track it here)
            t.stringLiteral(`${path.node.loc?.start.line || 0}`),
          ]
        );

        // Wrap assignment in sequence expression to capture the event
        path.replaceWith(
          t.sequenceExpression([
            captureCall,
            path.node,
          ])
        );
      },

      AwaitExpression(path: NodePath<t.AwaitExpression>) {
        if (!instrumentAsync) return;

        // Create captureCustom call for async await
        const captureCall = t.callExpression(
          t.memberExpression(
            t.identifier(causewayInstance),
            t.identifier('captureCustom')
          ),
          [
            t.stringLiteral('await'),
            t.objectExpression([
              t.objectProperty(
                t.identifier('location'),
                t.stringLiteral(`${path.node.loc?.start.line || 0}`)
              ),
            ]),
          ]
        );

        // Insert before await
        const parent = path.parentPath;
        if (parent.isExpressionStatement() || parent.isVariableDeclarator()) {
          path.insertBefore(t.expressionStatement(captureCall));
        }
      },
    },
  };
});
