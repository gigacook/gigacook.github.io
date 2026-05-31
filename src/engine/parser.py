"""Parse the YAML-like matrix markdown files (04_matrix_*.md)."""
from __future__ import annotations
import re
from .models import MatrixEntity

_SCALAR = {'area', 'entity'}
_LIST = {
    'tags', 'when_to_suspect', 'discriminators',
    'investigation', 'initial_management', 'definitive_management',
    'complications', 'pitfalls', 'memory_hooks',
}
_FIELD = re.compile(r'^- (\w+):\s*(.*)')
_ITEM = re.compile(r'^\s{2}- (.+)')


def parse_matrix_file(text: str, specialty: str) -> list[MatrixEntity]:
    blocks = re.split(r'\n---', text)
    return [e for b in blocks if (e := _parse_block(b.strip(), specialty)) is not None]


def _parse_block(block: str, specialty: str) -> MatrixEntity | None:
    if not block:
        return None

    scalars: dict[str, str] = {k: '' for k in _SCALAR}
    lists: dict[str, list[str]] = {k: [] for k in _LIST}
    current: str | None = None

    for line in block.splitlines():
        m = _FIELD.match(line)
        if m:
            key, value = m.group(1), m.group(2).strip()
            current = key
            if key in _SCALAR:
                scalars[key] = value
            elif key in _LIST:
                lists[key] = [value] if value else []
            continue

        m = _ITEM.match(line)
        if m and current in _LIST:
            lists[current].append(m.group(1).strip())

    if not scalars.get('entity'):
        return None

    return MatrixEntity(
        area=scalars['area'],
        entity=scalars['entity'],
        tags=lists['tags'],
        when_to_suspect=lists['when_to_suspect'],
        discriminators=lists['discriminators'],
        investigation=lists['investigation'],
        initial_management=lists['initial_management'],
        definitive_management=lists['definitive_management'],
        complications=lists['complications'],
        pitfalls=lists['pitfalls'],
        memory_hooks=lists['memory_hooks'],
        specialty=specialty,
    )
