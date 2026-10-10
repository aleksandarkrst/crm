#!/usr/bin/env python3
"""Exercise backup failure handling with command stubs; no database or remote access."""
import os
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory() as directory:
    temp = Path(directory)
    backups = temp / "backups"
    backups.mkdir()
    commands = temp / "bin"
    commands.mkdir()
    log = temp / "commands.log"
    stub = commands / "stub"
    stub.write_text("""#!/usr/bin/env python3
import os, pathlib, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ['COMMAND_LOG'], 'a') as log:
    log.write(name + ' ' + ' '.join(args) + '\\n')
if name == 'pg_dump':
    pathlib.Path(next(a.split('=', 1)[1] for a in args if a.startswith('--file='))).write_text('dump')
if name == 'rclone' and args[0] == 'copy' and os.environ.get('FAIL_COPY'):
    sys.exit(1)
if name == 'timeout':
    assert args[:4] == ['-k', '5', '60', 'rclone']
    assert args[4] == 'delete'
    sys.exit(124 if os.environ.get('FAIL_CLEANUP') else 0)
""")
    stub.chmod(0o755)
    for name in ["pg_dump", "pg_restore", "rclone", "timeout"]:
        (commands / name).symlink_to(stub)
    script = temp / "backup.sh"
    script.write_text((root / "infra/backup/backup.sh").read_text().replace("/backups", str(backups)))
    base_env = {
        **os.environ, "PATH": str(commands) + ":" + os.environ["PATH"],
        "COMMAND_LOG": str(log), "PGDATABASE": "test",
        "BACKUP_RCLONE_REMOTE": "test-remote:backups",
        "BACKUP_STORAGE_DIR": str(temp / "no-storage"),
        "BACKUP_WEEKLY_DAY": "0", "BACKUP_HEARTBEAT_URL": "",
    }
    def run(**overrides):
        log.write_text("")
        result = subprocess.run(["sh", str(script), "once"], env={**base_env, **overrides}, capture_output=True, text=True)
        return result, log.read_text()

    result, calls = run(FAIL_CLEANUP="1")
    assert result.returncode == 0, result.stderr
    assert calls.count("timeout -k 5 60 rclone delete") == 2, calls
    assert "WARNING: offsite retention cleanup" in result.stdout
    assert "rclone copy" in calls
    print("PASS: timed-out retention preserves successful backup and warns")

    result, calls = run(FAIL_COPY="1")
    assert result.returncode != 0
    assert "timeout" not in calls
    assert "kept as" not in result.stdout
    print("PASS: required upload failure fails backup before cleanup")

    result, calls = run(BACKUP_RCLONE_REMOTE="")
    assert result.returncode == 0, result.stderr
    assert "rclone" not in calls
    assert list(backups.glob("*.dump"))
    print("PASS: local-only backup still creates and validates a dump")
