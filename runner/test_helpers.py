"""Isolate runner logic from host gating, which has separate fixture-based tests."""
from pathlib import Path

def runner_source(path):
    return '\n'.join(line for line in Path(path).read_text().splitlines()
                     if 'scripts/lib/require-centos.sh' not in line
                     and not line.startswith('roboshop_require_centos '))+'\n'

def copy_runner(path, destination):
    target=Path(destination)/Path(path).name
    target.write_text(runner_source(path))
    return target


def python_runner_source(path):
    import ast
    source=Path(path).read_text()
    lines=source.splitlines(True)
    for statement in ast.parse(source).body:
        if isinstance(statement,ast.If) and '_host_gate' in ast.get_source_segment(source,statement):
            del lines[statement.lineno-1:statement.end_lineno]
            break
    return ''.join(lines)
