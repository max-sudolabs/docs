"""
Renders one Python package with pydoc-markdown, like `pydoc-markdown -p <package>`,
but also documents members a class inherits from a base class that is not rendered
on the same page (e.g. `Secret.fill` defined on `SecretBase`).

Usage: python pydoc_render.py <package>  (run from the SDK directory)
"""

import copy
import os
import sys
import typing as t

import docspec
import docspec_python
from pydoc_markdown import PydocMarkdown
from pydoc_markdown.contrib.loaders.python import PythonLoader

SEARCH_PATH = [os.getcwd(), os.path.join(os.getcwd(), "src")]

_module_cache: t.Dict[str, t.Optional[docspec.Module]] = {}


def load_module(name: str) -> t.Optional[docspec.Module]:
    if name not in _module_cache:
        try:
            modules = list(
                docspec_python.load_python_modules(
                    modules=[name], search_path=SEARCH_PATH
                )
            )
        except ImportError:
            modules = []
        _module_cache[name] = modules[0] if modules else None
    return _module_cache[name]


def resolve_target(target: str, depth: int = 0) -> t.Optional[t.Tuple[docspec.Class, docspec.Module]]:
    """Resolves a dotted path ("e2b.secret.base.SecretBase") to its class."""
    if depth > 10:
        return None
    parts = target.split(".")
    for i in range(len(parts) - 1, 0, -1):
        module = load_module(".".join(parts[:i]))
        if module is not None:
            if i != len(parts) - 1:
                return None
            return resolve_name(module, parts[-1], depth + 1)
    return None


def resolve_name(module: docspec.Module, name: str, depth: int = 0) -> t.Optional[t.Tuple[docspec.Class, docspec.Module]]:
    """Resolves a name used in *module* to the class it refers to."""
    name = name.split("[", 1)[0].strip()
    if "." in name:
        head, rest = name.split(".", 1)
        member = next((m for m in module.members if m.name == head), None)
        if isinstance(member, docspec.Indirection):
            return resolve_target(f"{member.target}.{rest}", depth + 1)
        return resolve_target(name, depth + 1)

    member = next((m for m in module.members if m.name == name), None)
    if isinstance(member, docspec.Class):
        return member, module
    if isinstance(member, docspec.Indirection):
        return resolve_target(member.target, depth + 1)
    return None


def add_inherited_members(modules: t.List[docspec.Module]) -> None:
    rendered = {
        f"{module.name}.{member.name}"
        for module in modules
        for member in module.members
        if isinstance(member, docspec.Class)
    }

    for module in modules:
        for cls in module.members:
            if not isinstance(cls, docspec.Class):
                continue

            names = {member.name for member in cls.members}
            seen: t.Set[str] = set()

            def inherit(owner: docspec.Class, owner_module: docspec.Module) -> None:
                for base in owner.bases or []:
                    resolved = resolve_name(owner_module, base)
                    if resolved is None:
                        continue
                    base_cls, base_module = resolved
                    qualified = f"{base_module.name}.{base_cls.name}"
                    # bases rendered on this page get their own inherited members
                    if qualified in seen or qualified in rendered:
                        continue
                    seen.add(qualified)

                    for member in base_cls.members:
                        if member.name in names:
                            continue
                        names.add(member.name)
                        cls.members.append(copy.deepcopy(member))

                    inherit(base_cls, base_module)

            inherit(cls, module)
            cls.sync_hierarchy(module)


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit("usage: pydoc_render.py <package>")

    config = PydocMarkdown(loaders=[PythonLoader(packages=[sys.argv[1]])])
    # the loader lists directories in filesystem order; sort for stable output
    modules = sorted(config.load_modules(), key=lambda module: module.name)
    add_inherited_members(modules)
    config.process(modules)
    config.render(modules)


if __name__ == "__main__":
    main()
