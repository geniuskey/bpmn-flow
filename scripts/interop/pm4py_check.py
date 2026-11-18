"""
Second independent interoperability check: import BPMN Flow exports with pm4py
(process-mining library with its own BPMN parser, AGPL-3.0, test tool only) and
convert each diagram to a Petri net, which requires every node and sequence flow
to be read and connected correctly.

Usage:  python pm4py_check.py <dir-with-.bpmn-files>
Setup:  .venv-interop/bin/pip install pm4py
"""
import sys
from pathlib import Path

import pm4py


def main() -> int:
    folder = Path(sys.argv[1])
    failures = 0
    for f in sorted(folder.glob("*.bpmn")):
        try:
            graph = pm4py.read_bpmn(str(f))
            nodes = graph.get_nodes()
            flows = graph.get_flows()
            net, _im, _fm = pm4py.convert_to_petri_net(graph)
            print(
                f"OK   {f.name}: {len(nodes)} nodes, {len(flows)} flows -> "
                f"Petri net with {len(net.places)} places, {len(net.transitions)} transitions"
            )
        except Exception as exc:
            text = f.read_text(encoding="utf-8")
            # pm4py's BPMN importer has no node types for these; flows touching them crash it.
            unsupported = [
                t
                for t in ("callActivity", "complexGateway", "transaction", "adHocSubProcess")
                if f"<bpmn:{t} " in text
            ]
            if unsupported:
                print(f"LIMIT {f.name}: pm4py does not implement {', '.join(unsupported)}")
                continue
            failures += 1
            print(f"FAIL {f.name}: {type(exc).__name__}: {exc}")
    print(f"{failures} file(s) failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
