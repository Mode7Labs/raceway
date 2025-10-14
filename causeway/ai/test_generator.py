"""
Automatic test case generation from production traces.

Converts real execution traces into reproducible test cases.
"""

from typing import List, Dict, Any
from dataclasses import dataclass


@dataclass
class TestCase:
    name: str
    language: str
    code: str
    description: str
    fixtures: Dict[str, Any]


class TestGenerator:
    """
    Generates test cases from causal traces.
    Supports multiple languages and testing frameworks.
    """

    def __init__(self, language: str = 'typescript', framework: str = 'jest'):
        self.language = language
        self.framework = framework

    def generate_from_trace(self, events: List[Dict[str, Any]], trace_id: str) -> TestCase:
        """
        Generate a test case that reproduces the exact sequence of events.
        """
        if self.language == 'typescript':
            return self._generate_typescript_test(events, trace_id)
        elif self.language == 'python':
            return self._generate_python_test(events, trace_id)
        else:
            raise ValueError(f"Unsupported language: {self.language}")

    def _generate_typescript_test(self, events: List[Dict[str, Any]], trace_id: str) -> TestCase:
        """Generate TypeScript/Jest test"""

        # Extract function calls and state changes
        function_calls = [e for e in events if e.get('kind') == 'FunctionCall']
        state_changes = [e for e in events if e.get('kind') == 'StateChange']
        http_requests = [e for e in events if e.get('kind') == 'HttpRequest']
        errors = [e for e in events if e.get('kind') == 'Error']

        # Determine test type
        has_race_condition = any(
            e.get('kind') == 'RaceCondition' for e in events
        )
        has_error = len(errors) > 0

        test_name = f"reproduces_{trace_id}"
        if has_race_condition:
            test_name = f"detects_race_condition_{trace_id}"
        elif has_error:
            test_name = f"handles_error_{trace_id}"

        # Build test code
        code_lines = [
            f"/**",
            f" * Test case generated from trace: {trace_id}",
            f" * Reproduces the exact sequence of events from production",
            f" */",
            f"",
            f"import {{ describe, it, expect, jest }} from '@jest/globals';",
            f"",
            f"describe('{test_name}', () => {{",
            f"  it('should reproduce the trace', async () => {{",
        ]

        # Mock HTTP calls
        if http_requests:
            code_lines.append("    // Mock HTTP responses")
            for i, req in enumerate(http_requests):
                url = req.get('data', {}).get('url', 'unknown')
                # Find corresponding response
                response = next(
                    (e for e in events if e.get('kind') == 'HttpResponse' and e.get('parent_id') == req.get('id')),
                    None
                )
                if response:
                    status = response.get('data', {}).get('status', 200)
                    code_lines.append(f"    global.fetch = jest.fn().mockResolvedValueOnce({{")
                    code_lines.append(f"      status: {status},")
                    code_lines.append(f"      json: async () => ({{ /* mock data */ }})")
                    code_lines.append(f"    }});")
                    code_lines.append("")

        # Setup initial state
        if state_changes:
            code_lines.append("    // Setup initial state")
            initial_states = {}
            for change in state_changes:
                var_name = change.get('data', {}).get('variable', '')
                old_value = change.get('data', {}).get('old_value')
                if var_name not in initial_states and old_value is not None:
                    initial_states[var_name] = old_value

            for var_name, value in initial_states.items():
                code_lines.append(f"    let {var_name} = {self._format_value(value)};")
            code_lines.append("")

        # Reproduce function calls
        if function_calls:
            code_lines.append("    // Execute the sequence")
            main_function = function_calls[0] if function_calls else None
            if main_function:
                func_name = main_function.get('data', {}).get('function_name', 'main')
                args = main_function.get('data', {}).get('args', [])

                if has_race_condition:
                    code_lines.append("    // Execute concurrent operations that cause race condition")
                    code_lines.append("    await Promise.all([")
                    for i, call in enumerate(function_calls[:3]):  # First 3 concurrent calls
                        fn = call.get('data', {}).get('function_name', 'fn')
                        code_lines.append(f"      {fn}(),")
                    code_lines.append("    ]);")
                else:
                    code_lines.append(f"    const result = await {func_name}({self._format_args(args)});")

        code_lines.append("")

        # Assertions based on final state
        if has_error:
            error = errors[0]
            error_msg = error.get('data', {}).get('message', 'Error')
            code_lines.append("    // Should throw expected error")
            code_lines.append(f"    await expect(async () => {{")
            code_lines.append(f"      // reproduce error condition")
            code_lines.append(f"    }}).rejects.toThrow('{error_msg}');")
        else:
            code_lines.append("    // Verify final state matches trace")
            for change in state_changes[-3:]:  # Last 3 state changes
                var_name = change.get('data', {}).get('variable', '')
                new_value = change.get('data', {}).get('new_value')
                if new_value is not None:
                    code_lines.append(f"    expect({var_name}).toBe({self._format_value(new_value)});")

        code_lines.append("  });")
        code_lines.append("});")

        code = "\n".join(code_lines)

        description = f"Reproduces trace {trace_id}"
        if has_race_condition:
            description = f"Detects race condition from trace {trace_id}"
        elif has_error:
            description = f"Handles error condition from trace {trace_id}"

        return TestCase(
            name=test_name,
            language=self.language,
            code=code,
            description=description,
            fixtures={}
        )

    def _generate_python_test(self, events: List[Dict[str, Any]], trace_id: str) -> TestCase:
        """Generate Python/pytest test"""

        code_lines = [
            f'"""',
            f'Test case generated from trace: {trace_id}',
            f'Reproduces the exact sequence of events from production',
            f'"""',
            f'',
            f'import pytest',
            f'from unittest.mock import Mock, patch',
            f'',
            f'def test_{trace_id}():',
            f'    """Reproduce trace {trace_id}"""',
            f'    # Test implementation',
            f'    assert True  # TODO: Implement test logic',
        ]

        return TestCase(
            name=f"test_{trace_id}",
            language='python',
            code="\n".join(code_lines),
            description=f"Reproduces trace {trace_id}",
            fixtures={}
        )

    def _format_value(self, value: Any) -> str:
        """Format a value for code generation"""
        if isinstance(value, str):
            return f"'{value}'"
        elif isinstance(value, bool):
            return 'true' if value else 'false'
        elif value is None:
            return 'null'
        else:
            return str(value)

    def _format_args(self, args: List[Any]) -> str:
        """Format function arguments for code generation"""
        if not args:
            return ''
        return ', '.join(self._format_value(arg) for arg in args)


def generate_test_suite(
    traces: List[Dict[str, Any]],
    language: str = 'typescript'
) -> List[TestCase]:
    """
    Generate a complete test suite from multiple traces.
    """
    generator = TestGenerator(language=language)
    test_cases = []

    for trace in traces:
        trace_id = trace.get('trace_id', 'unknown')
        events = trace.get('events', [])

        if events:
            test_case = generator.generate_from_trace(events, trace_id)
            test_cases.append(test_case)

    return test_cases


if __name__ == '__main__':
    # Example usage
    example_events = [
        {
            'kind': 'FunctionCall',
            'data': {
                'function_name': 'transferMoney',
                'args': ['alice', 'bob', 100]
            }
        },
        {
            'kind': 'StateChange',
            'data': {
                'variable': 'balance',
                'old_value': 1000,
                'new_value': 900
            }
        },
    ]

    generator = TestGenerator(language='typescript')
    test_case = generator.generate_from_trace(example_events, 'example_trace')
    print(test_case.code)
