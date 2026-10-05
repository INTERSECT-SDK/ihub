"""Validate per-service coverage thresholds for ihub_server/services."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Iterable


def _iter_service_files(services_dir: Path) -> Iterable[Path]:
    return sorted(path for path in services_dir.glob("*.py") if path.is_file())


def _coverage_for_file(coverage_files: dict[str, dict], path: Path) -> float:
    coverage_entry = coverage_files.get(str(path))
    if not coverage_entry:
        try:
            coverage_entry = coverage_files.get(str(path.relative_to(Path.cwd())))
        except ValueError:
            coverage_entry = None
    if not coverage_entry:
        return 0.0
    summary = coverage_entry.get("summary", {})
    num_statements = summary.get("num_statements", 0)
    covered = summary.get("covered_lines", 0)
    if num_statements == 0:
        return 100.0
    return (covered / num_statements) * 100.0


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate per-service coverage thresholds.")
    parser.add_argument(
        "--coverage-file",
        default="coverage.json",
        help="Path to coverage JSON output.",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=90.0,
        help="Minimum coverage percentage required per service.",
    )
    parser.add_argument(
        "--services-dir",
        default=str(Path("ihub_server") / "services"),
        help="Path to the services directory.",
    )
    args = parser.parse_args()

    coverage_path = Path(args.coverage_file)
    if not coverage_path.exists():
        raise SystemExit(f"Coverage file not found: {coverage_path}")

    with coverage_path.open("r", encoding="utf-8") as handle:
        coverage_data = json.load(handle)

    coverage_files = coverage_data.get("files", {})
    services_dir = Path(args.services_dir).resolve()

    failures: list[str] = []
    report_lines: list[str] = []

    for service_file in _iter_service_files(services_dir):
        coverage_value = _coverage_for_file(coverage_files, service_file.resolve())
        report_lines.append(f"{service_file.name}: {coverage_value:.1f}%")
        if coverage_value < args.threshold:
            failures.append(service_file.name)

    report = "\n".join(report_lines)
    print(report)

    if failures:
        failure_list = ", ".join(sorted(failures))
        print(
            f"Per-service coverage below {args.threshold:.1f}% for: {failure_list}",
        )
        return 1

    print(f"All services meet the {args.threshold:.1f}% coverage threshold.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
