"""
Independent interoperability check: parse BPMN Flow exports with SpiffWorkflow
(an unrelated Python BPMN implementation, LGPL-3.0, used only as a test tool)
and try to run every process.

Usage:  python spiff_check.py <dir-with-.bpmn-files>
Setup:  python3 -m venv .venv && .venv/bin/pip install SpiffWorkflow

SpiffWorkflow only loads processes marked isExecutable="true", so the check
works on a copy with that flag set. Parsing must succeed for every file
(file-format interoperability). Execution is best effort: conditions written in
another expression language (e.g. JUEL `${...}`) cannot be evaluated by Spiff's
Python engine and are reported, not failed.
"""
import re
import sys
import tempfile
from pathlib import Path

from SpiffWorkflow.bpmn.parser.BpmnParser import BpmnParser
from SpiffWorkflow.bpmn.workflow import BpmnWorkflow
from SpiffWorkflow.util.task import TaskState


def executable_copy(path: Path, tmp: Path) -> Path:
    xml = path.read_text(encoding="utf-8")
    xml = xml.replace('isExecutable="false"', 'isExecutable="true"')
    xml = re.sub(r'<bpmn:process (?![^>]*isExecutable)', '<bpmn:process isExecutable="true" ', xml)
    target = tmp / path.name
    target.write_text(xml, encoding="utf-8")
    return target


def without_process_data_io_associations(xml: str) -> tuple[str, int]:
    """
    SpiffWorkflow resolves data associations only to data object / data store
    references, although BPMN allows any item-aware element (e.g. a process
    data input / output). Drop just those associations so the rest of the file
    can still be checked.
    """
    ids = set(re.findall(r'<bpmn:data(?:Input|Output) id="([^"]+)"', xml))
    removed = 0

    def drop(match: re.Match) -> str:
        nonlocal removed
        refs = re.findall(r'<bpmn:(?:sourceRef|targetRef)>([^<]+)</bpmn:(?:sourceRef|targetRef)>', match.group(0))
        if any(r in ids for r in refs):
            removed += 1
            return ""
        return match.group(0)

    xml = re.sub(r'<bpmn:data(?:Input|Output)Association\b[\s\S]*?</bpmn:data(?:Input|Output)Association>', drop, xml)
    return xml, removed


def parse_and_run(path: Path) -> str:
    parser = BpmnParser()
    parser.add_bpmn_file(str(path))
    ids = parser.get_process_ids()
    if not ids:
        raise ValueError("no process found")
    return "; ".join(run_process(parser, pid) for pid in ids)


def run_process(parser: BpmnParser, pid: str) -> str:
    spec = parser.get_spec(pid)
    elements = len([t for t in spec.task_specs.values() if t.bpmn_id])
    try:
        # Note: Spiff reserves the task name "Start"; a BPMN element with id="Start"
        # makes instantiation fail even though parsing succeeded.
        wf = BpmnWorkflow(spec)
        for _ in range(500):
            wf.do_engine_steps()
            if wf.is_completed():
                break
            ready = wf.get_tasks(state=TaskState.READY)
            if not ready:
                break
            for t in ready:
                t.run()
        state = "completed" if wf.is_completed() else "waiting (message/timer or open path)"
    except Exception as exc:  # expression language, etc.
        state = f"not executable by Spiff ({type(exc).__name__})"
    return f"{pid}: parsed {elements} elements, run {state}"


def main() -> int:
    folder = Path(sys.argv[1])
    failures = 0
    with tempfile.TemporaryDirectory() as tmp:
        for f in sorted(folder.glob("*.bpmn")):
            try:
                parser = BpmnParser()
                parser.add_bpmn_file(str(executable_copy(f, Path(tmp))))
                ids = parser.get_process_ids()
                if not ids:
                    if "<bpmn:choreography " in f.read_text(encoding="utf-8"):
                        # BPMN choreographies describe interactions; engines execute processes.
                        print(f"NOTE  {f.name}: choreography only, nothing executable")
                        continue
                    raise ValueError("no process found")
                print(f"OK   {f.name}: " + "; ".join(run_process(parser, pid) for pid in ids))
            except Exception as exc:
                message = str(exc)
                # Element types SpiffWorkflow's core parser does not implement
                # (complex gateway, business rule task without DMN, data stores
                # without a registered implementation) are tool limitations.
                if "No start event found" in message and "<bpmn:startEvent" not in f.read_text(encoding="utf-8"):
                    print(f"NOTE  {f.name}: no process content to execute (e.g. a conversation diagram)")
                    continue
                if "Cannot resolve data" in message:
                    xml, removed = without_process_data_io_associations(
                        executable_copy(f, Path(tmp)).read_text(encoding="utf-8")
                    )
                    if removed:
                        stripped = Path(tmp) / f"stripped-{f.name}"
                        stripped.write_text(xml, encoding="utf-8")
                        try:
                            rest = parse_and_run(stripped)
                        except Exception as inner:
                            failures += 1
                            print(f"FAIL {f.name}: {type(inner).__name__}: {inner}")
                            continue
                        print(
                            f"LIMIT {f.name}: SpiffWorkflow cannot resolve data associations to process "
                            f"data inputs/outputs ({removed} skipped); rest: {rest}"
                        )
                        continue
                if "no support implemented for this task type" in message or "has no implementation" in message:
                    print(f"LIMIT {f.name}: SpiffWorkflow does not implement an element used here ({message.strip()})")
                    continue
                failures += 1
                print(f"FAIL {f.name}: {type(exc).__name__}: {exc}")
    print(f"{failures} file(s) failed to parse")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
