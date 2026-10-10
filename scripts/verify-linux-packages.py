"""Check package rules and lifecycle hooks and require all Linux artifacts."""
import pathlib
import subprocess
import sys
import tempfile

bundle = pathlib.Path(sys.argv[1])
artifacts = {}
for kind, suffix in [("deb", ".deb"), ("rpm", ".rpm"), ("appimage", ".AppImage")]:
    matches = list((bundle / kind).glob(f"*{suffix}"))
    assert len(matches) == 1, f"Expected one {kind} artifact, found {matches}"
    artifacts[kind] = matches[0]

expected = pathlib.Path("src-tauri/linux/70-repriseos.rules").read_bytes()
with tempfile.TemporaryDirectory() as directory:
    subprocess.run(["dpkg-deb", "--extract", str(artifacts["deb"]), directory], check=True)
    rule = pathlib.Path(directory) / "usr/lib/udev/rules.d/70-repriseos.rules"
    assert rule.read_bytes() == expected, "Debian helper rule differs"
    subprocess.run(["dpkg-deb", "--control", str(artifacts["deb"]), directory + "/control"], check=True)
    for hook in ["postinst", "postrm"]:
        assert "udevadm control --reload-rules" in (pathlib.Path(directory) / "control" / hook).read_text()

rpm_files = subprocess.check_output(["rpm", "-qpl", str(artifacts["rpm"])], text=True)
assert "/usr/lib/udev/rules.d/70-repriseos.rules" in rpm_files.splitlines()
rpm_scripts = subprocess.check_output(["rpm", "-qp", "--scripts", str(artifacts["rpm"])], text=True)
assert rpm_scripts.count("udevadm control --reload-rules") == 2, "Missing RPM lifecycle hooks"
rpm_requires = subprocess.check_output(["rpm", "-qp", "--requires", str(artifacts["rpm"])], text=True)
assert "webkit2gtk4.1" in rpm_requires.splitlines(), "Missing RPM WebKit dependency"

print("Linux artifacts present; Debian/RPM helper rule and lifecycle hooks verified.")
