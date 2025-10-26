// @ts-ignore - no types available for this package
import { declare } from '@babel/helper-plugin-utils';
import * as t from '@babel/types';
import type { NodePath } from '@babel/traverse';

interface PluginOptions {
  // Name of the raceway instance variable
  racewayInstance?: string;
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
 * Babel plugin to automatically instrument code with Raceway events
 */
export default declare((api: any, options: PluginOptions) => {
  api.assertVersion(7);

  const racewayInstance = options.racewayInstance || '__raceway';
  const instrumentFunctions = options.instrumentFunctions !== false;
  const instrumentAssignments = options.instrumentAssignments !== false;
  const instrumentAsync = options.instrumentAsync !== false;

  return {
    name: 'babel-plugin-raceway',

    visitor: {
      Program(path: NodePath<t.Program>, state: any) {
        // Check if file should be excluded
        const filename = state.filename || '';
        if (options.exclude?.some(pattern => filename.includes(pattern))) {
          return;
        }

        // Inject raceway import at top of file
        const importDeclaration = t.importDeclaration(
          [t.importDefaultSpecifier(t.identifier(racewayInstance))],
          t.stringLiteral('@mode-7/raceway-node/runtime')
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
              t.identifier(racewayInstance),
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
              t.identifier(racewayInstance),
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
              t.identifier(racewayInstance),
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
        let oldValueExpr: t.Expression | null = null;

        // Get variable name and create expression to read old value
        if (t.isIdentifier(left)) {
          variableName = left.name;
          oldValueExpr = t.identifier(left.name);
        } else if (t.isMemberExpression(left)) {
          const obj = t.isIdentifier(left.object) ? left.object.name : 'obj';
          const prop = t.isIdentifier(left.property) ? left.property.name : 'prop';
          variableName = `${obj}.${prop}`;
          // Clone the member expression to read old value
          oldValueExpr = t.cloneNode(left);
        }

        if (!oldValueExpr) return;

        // Create a unique temp variable name to store old value
        const tempVarName = path.scope.generateUidIdentifier('oldValue');

        // Create: const _oldValue = obj.prop;
        const oldValueDeclaration = t.variableDeclaration('const', [
          t.variableDeclarator(tempVarName, oldValueExpr),
        ]);

        // Create captureStateChange call with actual old value
        const captureCall = t.callExpression(
          t.memberExpression(
            t.identifier(racewayInstance),
            t.identifier('trackStateChange')
          ),
          [
            t.stringLiteral(variableName),
            tempVarName, // old value from temp var
            path.node.right, // new value
            t.stringLiteral('Write'),
          ]
        );

        // Replace the assignment with:
        // const _oldValue = obj.prop;
        // __raceway.trackStateChange('obj.prop', _oldValue, newValue, 'Write');
        // obj.prop = newValue;
        const parent = path.getStatementParent();
        if (parent) {
          parent.insertBefore(oldValueDeclaration);
          parent.insertBefore(t.expressionStatement(captureCall));
        }
      },

      MemberExpression(path: NodePath<t.MemberExpression>) {
        if (!instrumentAssignments) return;

        // Skip if this is the left side of an assignment (already handled)
        if (path.parent && t.isAssignmentExpression(path.parent) && path.parent.left === path.node) {
          return;
        }

        // Skip if this is part of our own instrumentation
        if (path.node.object && t.isIdentifier(path.node.object) && path.node.object.name === racewayInstance) {
          return;
        }

        // Skip method calls - we only care about property access
        if (path.parent && t.isCallExpression(path.parent) && path.parent.callee === path.node) {
          return;
        }

        // Skip if property is on the left side of update expression (++/--)
        if (path.parent && t.isUpdateExpression(path.parent)) {
          return;
        }

        // Only track reads in expression statements or variable declarations
        const parent = path.parent;
        if (!t.isExpressionStatement(parent) && !t.isVariableDeclarator(parent) && !t.isReturnStatement(parent) && !t.isBinaryExpression(parent) && !t.isConditionalExpression(parent)) {
          return;
        }

        const obj = t.isIdentifier(path.node.object) ? path.node.object.name : 'obj';
        const prop = t.isIdentifier(path.node.property) ? path.node.property.name :
                     t.isStringLiteral(path.node.property) ? path.node.property.value : 'prop';
        const variableName = `${obj}.${prop}`;

        // Create trackStateChange call for read
        const captureCall = t.callExpression(
          t.memberExpression(
            t.identifier(racewayInstance),
            t.identifier('trackStateChange')
          ),
          [
            t.stringLiteral(variableName),
            t.nullLiteral(), // no old value for reads
            t.cloneNode(path.node), // the value being read
            t.stringLiteral('Read'),
          ]
        );

        // Insert the tracking call before the current statement
        const statement = path.getStatementParent();
        if (statement) {
          statement.insertBefore(t.expressionStatement(captureCall));
        }
      },

      AwaitExpression(path: NodePath<t.AwaitExpression>) {
        if (!instrumentAsync) return;

        // Create captureCustom call for async await
        const captureCall = t.callExpression(
          t.memberExpression(
            t.identifier(racewayInstance),
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
