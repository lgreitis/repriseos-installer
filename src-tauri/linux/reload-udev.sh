#!/bin/sh
# Package installation also runs in containers without a running udev daemon.
if command -v udevadm >/dev/null 2>&1; then
    udevadm control --reload-rules || true
fi
exit 0
